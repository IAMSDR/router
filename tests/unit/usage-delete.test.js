// Time-based deletion for usageHistory (+ usageDaily rebuild) and requestDetails.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;

function isoDaysAgo(n, h = 12) {
  const d = new Date(Date.now() - n * 86400000);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-delete-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("usageHistory time-based delete", () => {
  it("validation rejects unbounded filter", async () => {
    await expect(db.deleteUsageHistory({})).rejects.toThrow(/time bound/i);
    await expect(db.countUsageHistory({})).rejects.toThrow(/time bound/i);
  });

  it("validation rejects invalid dates", async () => {
    await expect(db.countUsageHistory({ before: "not-a-date" })).rejects.toThrow(/invalid/i);
  });

  it("before-filter deletes old rows and rebuilds daily aggregates", async () => {
    const oldTs = isoDaysAgo(10);
    const newTs = isoDaysAgo(1);
    await db.saveRequestUsage({ timestamp: oldTs, provider: "openai", model: "gpt-4", tokens: { prompt_tokens: 100, completion_tokens: 50 } });
    await db.saveRequestUsage({ timestamp: newTs, provider: "openai", model: "gpt-4", tokens: { prompt_tokens: 10, completion_tokens: 5 } });

    const before = new Date(Date.now() - 5 * 86400000).toISOString();
    expect(await db.countUsageHistory({ before })).toBe(1);

    const { deleted } = await db.deleteUsageHistory({ before });
    expect(deleted).toBe(1);

    // New row survives; old daily bucket is gone, new one intact.
    const left = adapter.all(`SELECT timestamp FROM usageHistory`);
    expect(left.map((r) => r.timestamp)).toEqual([newTs]);

    const days = adapter.all(`SELECT dateKey FROM usageDaily`);
    const dayKeys = days.map((r) => r.dateKey);
    const d = new Date(oldTs);
    const oldKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(dayKeys).not.toContain(oldKey);

    // Lifetime counter matches surviving rows.
    const meta = adapter.get(`SELECT value FROM _meta WHERE key='totalRequestsLifetime'`);
    expect(meta.value).toBe("1");
  });

  it("custom range + all=true work", async () => {
    const ts = isoDaysAgo(3);
    await db.saveRequestUsage({ timestamp: ts, provider: "x", model: "m", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    const start = new Date(Date.now() - 4 * 86400000).toISOString();
    const end = new Date(Date.now() - 2 * 86400000).toISOString();
    expect(await db.countUsageHistory({ startDate: start, endDate: end })).toBeGreaterThanOrEqual(1);
    await db.deleteUsageHistory({ startDate: start, endDate: end });

    // Wipe everything remaining.
    const total = await db.countUsageHistory({ all: true });
    expect(total).toBeGreaterThanOrEqual(0);
    await db.deleteUsageHistory({ all: true });
    expect(await db.countUsageHistory({ all: true })).toBe(0);
    expect(adapter.all(`SELECT dateKey FROM usageDaily`)).toEqual([]);
  });
});

describe("requestDetails time-based delete", () => {
  it("validation rejects unbounded filter", async () => {
    await expect(db.deleteRequestDetails({})).rejects.toThrow(/time bound/i);
  });

  it("single-row delete by id", async () => {
    const ts = new Date().toISOString();
    adapter.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["del-one", ts, "openai", "gpt-4", null, "ok", JSON.stringify({ id: "del-one" })]
    );
    expect(await db.countRequestDetails({ id: "del-one" })).toBe(1);
    const { deleted } = await db.deleteRequestDetails({ id: "del-one" });
    expect(deleted).toBe(1);
    expect(await db.getRequestDetailById("del-one")).toBeNull();
  });

  it("before-filter bulk delete keeps new rows", async () => {
    adapter.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["del-old", isoDaysAgo(20), "openai", "gpt-4", null, "ok", JSON.stringify({ id: "del-old" })]
    );
    adapter.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["del-new", new Date().toISOString(), "openai", "gpt-4", null, "ok", JSON.stringify({ id: "del-new" })]
    );
    const before = new Date(Date.now() - 5 * 86400000).toISOString();
    const count = await db.countRequestDetails({ before });
    expect(count).toBeGreaterThanOrEqual(1);
    const { deleted } = await db.deleteRequestDetails({ before });
    expect(deleted).toBe(count);
    expect(await db.getRequestDetailById("del-old")).toBeNull();
    expect(await db.getRequestDetailById("del-new")).not.toBeNull();
    // Cleanup
    await db.deleteRequestDetails({ all: true });
    expect(await db.countRequestDetails({ all: true })).toBe(0);
  });
});
