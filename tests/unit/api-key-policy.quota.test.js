import { describe, expect, it, vi, beforeEach } from "vitest";

// The enforcement module reads usage/quota state through the DB driver. Mock it
// with a tiny in-memory fake so quota logic is tested without touching disk.
const dbState = { rows: [], fail: false };

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    get: (sql, params) => fakeGet(sql, params),
    all: () => [],
    run: () => ({ changes: 1 }),
    transaction: (fn) => fn(),
  }),
}));

function fakeGet(sql, params) {
  if (dbState.fail) throw new Error("db down");
  const apiKey = params?.[0];
  if (/COUNT\(\*\)/i.test(sql)) {
    const since = params?.[1];
    return { n: dbState.rows.filter((r) => r.apiKey === apiKey && (!since || r.timestamp >= since)).length };
  }
  if (/SUM\(promptTokens\)/i.test(sql)) {
    const since = params?.[1];
    const rows = dbState.rows.filter((r) => r.apiKey === apiKey && (!since || r.timestamp >= since));
    return {
      p: rows.reduce((s, r) => s + (r.promptTokens || 0), 0),
      c: rows.reduce((s, r) => s + (r.completionTokens || 0), 0),
    };
  }
  if (/ORDER BY timestamp ASC/i.test(sql)) {
    const since = params?.[1];
    const rows = dbState.rows
      .filter((r) => r.apiKey === params?.[0] && (!since || r.timestamp >= since))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return rows[0] ? { timestamp: rows[0].timestamp } : null;
  }
  return null;
}

// apiKeysRepo/apiKeyPolicyRepo/localDb are mocked to return a fixed key+policy.
let activePolicy = null;
let keysEnabled = true;
let keyIsActive = true;

vi.mock("../../src/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: async (key) => (key === "sk-test" ? { id: "k1", key: "sk-test", name: "Test Key", isActive: keyIsActive } : null),
}));

vi.mock("../../src/lib/db/repos/apiKeyPolicyRepo.js", () => ({
  getApiKeyPolicy: async (id) => (id === "k1" ? activePolicy : null),
}));

vi.mock("../../src/lib/localDb", () => ({
  getSettings: async () => ({ apiKeyPoliciesEnabled: keysEnabled }),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: (request) => request?.headers?.get("Authorization")?.replace("Bearer ", "") || null,
}));

const { guardRequest, guardCombo, acquireConcurrency, getInFlight, invalidateQuotaCache, withPolicyRelease, recordRpmRequest, rpmUsedInWindow, MAX_STREAM_LIFETIME_MS } =
  await import("../../src/sse/services/apiKeyPolicy/enforce.js");

function makeRequest() {
  return { headers: new Map([["Authorization", "Bearer sk-test"]]) };
}

/** Minimal fetch-like request whose headers support .get(). */
function req() {
  const r = makeRequest();
  return { headers: { get: (k) => r.headers.get(k) || null } };
}

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

beforeEach(() => {
  dbState.rows = [];
  dbState.fail = false;
  activePolicy = null;
  keysEnabled = true;
  keyIsActive = true;
  invalidateQuotaCache("sk-test");
  // RPM is an in-memory window keyed by key id; clear it in place (the module
  // holds a reference to the same Map, so rebinding would not reset it).
  global._policyRpmLog?.clear();
});

describe("guardRequest — no policy / no key", () => {
  it("passes through when no key is presented", async () => {
    const result = await guardRequest({ headers: { get: () => null } }, { modality: "chat", modelStr: "m" });
    expect(result.response).toBeNull();
    expect(result.policy).toBeNull();
  });

  it("passes through when the key has no policy", async () => {
    activePolicy = null;
    const result = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(result.response).toBeNull();
  });

  it("treats a deactivated key as no-policy (consistent regardless of requireApiKey)", async () => {
    keyIsActive = false;
    activePolicy = { enabled: true, models: { mode: "allow", list: ["only-this"] }, providers: null, combos: null, quotas: null };
    const result = await guardRequest(req(), { modality: "chat", modelStr: "other" });
    expect(result.response).toBeNull();
    expect(result.policy).toBeNull();
  });

  it("passes through when policies are globally disabled", async () => {
    keysEnabled = false;
    activePolicy = { enabled: true, quotas: { rpm: 1 }, models: null, providers: null, combos: null };
    dbState.rows = [{ apiKey: "sk-test", timestamp: nowIso(), promptTokens: 999999 }];
    const result = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(result.response).toBeNull();
  });
});

describe("guardRequest — rule denial is a 403 with a stable code", () => {
  it("returns 403 model_not_allowed", async () => {
    activePolicy = { enabled: true, models: { mode: "allow", list: ["only-this"] }, providers: null, combos: null, quotas: null };
    const result = await guardRequest(req(), { modality: "chat", modelStr: "other" });
    expect(result.response).toBeTruthy();
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.error.code).toBe("model_not_allowed");
  });
});

describe("checkQuotas — RPM (in-memory trailing 60s window)", () => {
  const policy = () => ({ enabled: true, models: null, providers: null, combos: null, quotas: { rpm: 2 } });

  it("allows while under the limit", async () => {
    activePolicy = policy();
    recordRpmRequest("k1", Date.now() - 1000);
    const result = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(result.response).toBeNull();
  });

  it("returns 429 with Retry-After once the limit is hit", async () => {
    activePolicy = policy();
    recordRpmRequest("k1", Date.now() - 5000);
    recordRpmRequest("k1", Date.now() - 1000);
    const result = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(result.response.status).toBe(429);
    expect(Number(result.response.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = await result.response.json();
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.type).toBe("rate_limit_error");
  });

  it("counts requests that never reach usageHistory (failed / zero-usage)", async () => {
    // No usageHistory rows are seeded — under the old DB-derived RPM these two
    // admissions would be invisible and the third request would be allowed.
    activePolicy = policy();
    expect((await guardRequest(req(), { modality: "chat", modelStr: "m" })).response).toBeNull();
    expect((await guardRequest(req(), { modality: "chat", modelStr: "m" })).response).toBeNull();
    const third = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(third.response.status).toBe(429);
  });

  it("ignores requests older than the 60s window", async () => {
    activePolicy = policy();
    recordRpmRequest("k1", Date.now() - 120000);
    recordRpmRequest("k1", Date.now() - 90000);
    expect(rpmUsedInWindow("k1")).toBe(0);
    const result = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(result.response).toBeNull();
  });
});

describe("checkQuotas — tokens per day", () => {
  it("returns 429 once today's token usage exceeds the cap", async () => {
    activePolicy = { enabled: true, models: null, providers: null, combos: null, quotas: { tokensPerDay: 100 } };
    dbState.rows = [{ apiKey: "sk-test", timestamp: nowIso(), promptTokens: 80, completionTokens: 40 }];
    const result = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(result.response.status).toBe(429);
    const body = await result.response.json();
    expect(body.error.code).toBe("quota_exceeded");
    // Retry-After points at local midnight.
    expect(Number(result.response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("allows while under the daily cap", async () => {
    activePolicy = { enabled: true, models: null, providers: null, combos: null, quotas: { tokensPerDay: 1000 } };
    dbState.rows = [{ apiKey: "sk-test", timestamp: nowIso(), promptTokens: 10, completionTokens: 10 }];
    const result = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(result.response).toBeNull();
  });
});

describe("concurrency", () => {
  it("returns 429 when the in-flight cap is reached", async () => {
    activePolicy = { enabled: true, models: null, providers: null, combos: null, quotas: { concurrency: 2 } };
    const key = { id: "k1", key: "sk-test", name: "Test Key" };
    const releaseA = acquireConcurrency(key, activePolicy);
    const releaseB = acquireConcurrency(key, activePolicy);
    expect(getInFlight("k1")).toBe(2);

    const result = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(result.response.status).toBe(429);
    const body = await result.response.json();
    expect(body.error.code).toBe("concurrency_limit");

    releaseA();
    releaseB();
    expect(getInFlight("k1")).toBe(0);
  });

  it("releases a slot exactly once even if called repeatedly", async () => {
    activePolicy = { enabled: true, models: null, providers: null, combos: null, quotas: { concurrency: 5 } };
    const key = { id: "k1", key: "sk-test", name: "Test Key" };
    const release = acquireConcurrency(key, activePolicy);
    release();
    release();
    expect(getInFlight("k1")).toBe(0);
  });
});

describe("guardCombo — hard-fail semantics", () => {
  it("strips blocked members and keeps the allowed ones", async () => {
    activePolicy = { enabled: true, providers: { mode: "deny", list: ["openai"] }, models: null, combos: null, quotas: null };
    const result = await guardCombo(req(), { comboName: "mix", members: ["openai/gpt-5", "kiro/x"] });
    expect(result.response).toBeNull();
    expect(result.members).toEqual(["kiro/x"]);
  });

  it("403s when every member is blocked", async () => {
    activePolicy = { enabled: true, providers: { mode: "deny", list: ["openai"] }, models: null, combos: null, quotas: null };
    const result = await guardCombo(req(), { comboName: "mix", members: ["openai/gpt-5"] });
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.error.code).toBe("model_not_allowed");
  });

  it("403s when the combo itself is not allowed", async () => {
    activePolicy = { enabled: true, combos: { mode: "allow", list: ["only-this"] }, models: null, providers: null, quotas: null };
    const result = await guardCombo(req(), { comboName: "nope", members: ["kiro/x"] });
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.error.code).toBe("combo_not_allowed");
  });
});

describe("fail-open behaviour", () => {
  it("denies on a rule violation even when the quota DB read fails (rules are in-memory)", async () => {
    dbState.fail = true;
    activePolicy = { enabled: true, models: { mode: "allow", list: ["only-this"] }, providers: null, combos: null, quotas: { rpm: 1 } };
    const result = await guardRequest(req(), { modality: "chat", modelStr: "other" });
    // The model rule is evaluated from memory and must still deny.
    expect(result.response.status).toBe(403);
  });

  it("does not fail the request when only the quota DB read throws", async () => {
    dbState.fail = true;
    // tokensPerDay is the DB-backed quota; RPM is in-memory and never reads the DB.
    activePolicy = { enabled: true, models: null, providers: null, combos: null, quotas: { tokensPerDay: 1000 } };
    const result = await guardRequest(req(), { modality: "chat", modelStr: "m" });
    expect(result.response).toBeNull();
  });
});

describe("withPolicyRelease — the slot is tied to the response lifetime", () => {
  it("releases immediately for a non-streaming JSON response", async () => {
    let released = false;
    const res = new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    const wrapped = withPolicyRelease(res, () => { released = true; });
    expect(wrapped.status).toBe(200);
    expect(released).toBe(true);
  });

  it("holds the slot for a streaming response until it flushes", async () => {
    let released = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: x\n\n"));
        controller.close();
      },
    });
    const res = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    const wrapped = withPolicyRelease(res, () => { released = true; });
    expect(released).toBe(false);
    const reader = wrapped.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    // flush fires on stream close
    await new Promise((r) => setTimeout(r, 0));
    expect(released).toBe(true);
  });

  it("releases when the consumer cancels a stream", async () => {
    let released = false;
    const stream = new ReadableStream({ start() { /* never closes */ } });
    const res = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    const wrapped = withPolicyRelease(res, () => { released = true; });
    await wrapped.body.cancel();
    await new Promise((r) => setTimeout(r, 0));
    expect(released).toBe(true);
  });

  it("force-releases a hung stream that never flushes or cancels", async () => {
    vi.useFakeTimers();
    try {
      let released = false;
      const stream = new ReadableStream({ start() { /* hangs: never enqueues, closes, or errors */ } });
      const res = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      withPolicyRelease(res, () => { released = true; });
      expect(released).toBe(false);
      await vi.advanceTimersByTimeAsync(MAX_STREAM_LIFETIME_MS + 1000);
      expect(released).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
