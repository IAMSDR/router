// Chat persistence layer (fork addition): chatRepo CRUD/cascade + on-disk
// image storage. Follows the repo convention of pointing DATA_DIR at a temp
// dir and re-importing the DB modules per test so each gets a fresh adapter.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

const tick = () => new Promise((r) => setTimeout(r, 10));

async function boot() {
  delete global._dbAdapter;
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { db, adapter: await getAdapter() };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chat-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("chatRepo sessions", () => {
  it("creates, reads, updates and deletes sessions with JSON params round-trip", async () => {
    const { db } = await boot();

    const created = await db.createChatSession({
      title: "Hello",
      model: "gpt-4o",
      systemPrompt: "be nice",
      params: { temperature: 0.5, stop: ["\n"] },
    });
    expect(created.id).toBeTruthy();
    expect(created.title).toBe("Hello");
    expect(created.model).toBe("gpt-4o");
    expect(created.systemPrompt).toBe("be nice");
    expect(created.params).toEqual({ temperature: 0.5, stop: ["\n"] });
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBe(created.createdAt);

    expect(await db.getChatSession(created.id)).toEqual(created);

    const updated = await db.updateChatSession(created.id, { title: "Renamed", params: { temperature: 0.9 } });
    expect(updated.title).toBe("Renamed");
    expect(updated.params).toEqual({ temperature: 0.9 });
    // Unchanged fields survive and non-patchable fields are ignored.
    expect(updated.model).toBe("gpt-4o");
    expect(updated.systemPrompt).toBe("be nice");

    const ignored = await db.updateChatSession(created.id, { id: "hack", createdAt: "2000-01-01T00:00:00.000Z" });
    expect(ignored.id).toBe(created.id);
    expect(ignored.createdAt).toBe(created.createdAt);

    expect(await db.updateChatSession("missing", { title: "x" })).toBeNull();

    const res = await db.deleteChatSession(created.id);
    expect(res).toEqual({ deleted: true, relPaths: [] });
    expect(await db.getChatSession(created.id)).toBeNull();
    expect(await db.deleteChatSession(created.id)).toEqual({ deleted: false, relPaths: [] });
  });

  it("applies create defaults", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({});
    expect(session.title).toBe("New chat");
    expect(session.model).toBeNull();
    expect(session.systemPrompt).toBe("");
    expect(session.params).toEqual({});
  });

  it("lists sessions ordered by updatedAt DESC with counts and last-message preview", async () => {
    const { db } = await boot();
    const a = await db.createChatSession({ title: "A" });
    await tick();
    const b = await db.createChatSession({ title: "B" });
    await tick();

    let list = await db.listChatSessions();
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(list[0].messageCount).toBe(0);
    expect(list[0].lastMessagePreview).toBeNull();
    expect(list[0].lastMessageAt).toBeNull();

    await db.appendChatMessage({ sessionId: b.id, role: "user", content: { text: "  hello   there  " } });
    await tick();
    // A touched later → jumps to the top.
    await db.updateChatSession(a.id, { title: "A2" });

    list = await db.listChatSessions();
    expect(list.map((s) => s.id)).toEqual([a.id, b.id]);
    const bRow = list.find((s) => s.id === b.id);
    expect(bRow.messageCount).toBe(1);
    expect(bRow.lastMessagePreview).toBe("hello there");
    expect(bRow.lastMessageAt).toBeTruthy();
  });
});

describe("chatRepo messages", () => {
  it("appends, lists (createdAt ASC), updates and deletes messages", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({ title: "t" });

    const m1 = await db.appendChatMessage({ sessionId: session.id, role: "user", content: { text: "one" } });
    expect(m1.role).toBe("user");
    expect(m1.content).toEqual({ text: "one", attachments: [] });
    await tick();
    const m2 = await db.appendChatMessage({
      sessionId: session.id, role: "assistant", content: { text: "two" },
      reasoning: "because", model: "gpt-4o", provider: "openai",
      promptTokens: 5, completionTokens: 7, cost: 0.001, ttftMs: 100, latencyMs: 250, status: "ok",
    });

    const list = await db.listChatMessages(session.id);
    expect(list.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(list[1].promptTokens).toBe(5);
    expect(list[1].completionTokens).toBe(7);
    expect(list[1].cost).toBeCloseTo(0.001);
    expect(list[1].reasoning).toBe("because");
    expect(list[1].model).toBe("gpt-4o");

    // Appending bumps the session's updatedAt.
    expect((await db.getChatSession(session.id)).updatedAt).not.toBe(session.updatedAt);

    const updated = await db.updateChatMessage(m2.id, { status: "error", error: "boom", content: { text: "two edited" } });
    expect(updated.status).toBe("error");
    expect(updated.error).toBe("boom");
    expect(updated.content.text).toBe("two edited");
    expect(updated.promptTokens).toBe(5);
    expect(await db.updateChatMessage("missing", { status: "x" })).toBeNull();

    expect(await db.deleteChatMessage(m1.id)).toBe(true);
    expect((await db.listChatMessages(session.id)).map((m) => m.id)).toEqual([m2.id]);
    expect(await db.deleteChatMessage(m1.id)).toBe(false);
  });

  it("truncates a message and every later one", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({});
    const msgs = [];
    for (const role of ["user", "assistant", "user", "assistant"]) {
      msgs.push(await db.appendChatMessage({ sessionId: session.id, role, content: { text: `${role}-${msgs.length}` } }));
      await tick();
    }

    const res = await db.deleteChatMessagesFrom(session.id, msgs[2].id);
    expect(res.deleted).toBe(2);
    expect(res.relPaths).toEqual([]);
    expect((await db.listChatMessages(session.id)).map((m) => m.id)).toEqual([msgs[0].id, msgs[1].id]);

    // Unknown target is a no-op.
    expect(await db.deleteChatMessagesFrom(session.id, "missing")).toEqual({ deleted: 0, relPaths: [] });
  });

  it("resolves message attachments from attachment rows", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({});
    const msg = await db.appendChatMessage({ sessionId: session.id, role: "user", content: { text: "look" } });

    await db.createChatAttachment({
      id: "att1", messageId: msg.id, sessionId: session.id, filename: "a.png",
      mimeType: "image/png", size: 123, relPath: `${session.id}/att1.png`, width: 10, height: 20,
    });

    const list = await db.listChatMessages(session.id);
    expect(list[0].content.attachments).toEqual([
      { id: "att1", filename: "a.png", mimeType: "image/png", width: 10, height: 20 },
    ]);
  });
});

describe("chatRepo attachments", () => {
  it("creates, reads, lists and deletes attachment rows", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({});

    const att = await db.createChatAttachment({
      id: "att1", messageId: "m1", sessionId: session.id, filename: "a.png",
      mimeType: "image/png", size: 42, relPath: `${session.id}/att1.png`, width: 5, height: 6,
    });
    expect(att).toMatchObject({ id: "att1", size: 42, relPath: `${session.id}/att1.png` });
    expect(att.createdAt).toBeTruthy();

    expect(await db.getChatAttachment("att1")).toMatchObject({ filename: "a.png", width: 5, height: 6 });
    expect(await db.getChatAttachment("nope")).toBeNull();
    expect((await db.listChatAttachments(session.id)).map((a) => a.id)).toEqual(["att1"]);
    expect(await db.countChatAttachments(session.id)).toBe(1);
    expect(await db.countChatAttachments()).toBe(1);

    expect(await db.deleteChatAttachment("att1")).toBe(true);
    expect(await db.deleteChatAttachment("att1")).toBe(false);
  });

  it("links unlinked attachments to a message, ignoring linked/foreign ids", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({});
    const other = await db.createChatSession({});
    const msg = await db.appendChatMessage({ sessionId: session.id, role: "user", content: { text: "look" } });

    await db.createChatAttachment({ id: "u1", messageId: null, sessionId: session.id, filename: "1.png", mimeType: "image/png", size: 1, relPath: `${session.id}/u1.png`, width: 1, height: 1 });
    await db.createChatAttachment({ id: "u2", messageId: null, sessionId: session.id, filename: "2.png", mimeType: "image/png", size: 2, relPath: `${session.id}/u2.png`, width: 1, height: 1 });
    // Already linked: must never be re-pointed.
    await db.createChatAttachment({ id: "linked", messageId: msg.id, sessionId: session.id, filename: "3.png", mimeType: "image/png", size: 3, relPath: `${session.id}/3.png`, width: 1, height: 1 });
    // Belongs to a different session.
    await db.createChatAttachment({ id: "foreign", messageId: null, sessionId: other.id, filename: "4.png", mimeType: "image/png", size: 4, relPath: `${other.id}/4.png`, width: 1, height: 1 });

    // Empty list is a no-op.
    expect(await db.linkChatAttachmentsToMessage({ sessionId: session.id, messageId: msg.id, attachmentIds: [] })).toBe(0);

    // Only the two unlinked same-session rows link; linked/foreign/missing are ignored.
    const linked = await db.linkChatAttachmentsToMessage({
      sessionId: session.id, messageId: msg.id, attachmentIds: ["u1", "u2", "linked", "foreign", "missing"],
    });
    expect(linked).toBe(2);
    expect((await db.getChatAttachment("u1")).messageId).toBe(msg.id);
    expect((await db.getChatAttachment("u2")).messageId).toBe(msg.id);
    expect((await db.getChatAttachment("foreign")).messageId).toBeNull();

    // The linked rows now surface under the message.
    const message = (await db.listChatMessages(session.id))[0];
    expect(message.content.attachments.map((a) => a.id).sort()).toEqual(["linked", "u1", "u2"]);

    // Re-linking already-linked ids is a no-op.
    expect(await db.linkChatAttachmentsToMessage({ sessionId: session.id, messageId: msg.id, attachmentIds: ["u1", "u2"] })).toBe(0);
  });

  it("deleteChatAttachmentsBySession returns removed relPaths", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({});
    await db.createChatAttachment({ id: "a1", messageId: null, sessionId: session.id, filename: "1.png", mimeType: "image/png", size: 1, relPath: `${session.id}/a1.png`, width: 1, height: 1 });
    await db.createChatAttachment({ id: "a2", messageId: "m1", sessionId: session.id, filename: "2.png", mimeType: "image/png", size: 2, relPath: `${session.id}/a2.png`, width: 1, height: 1 });

    const res = await db.deleteChatAttachmentsBySession(session.id);
    expect(res.deleted).toBe(2);
    expect(res.relPaths.sort()).toEqual([`${session.id}/a1.png`, `${session.id}/a2.png`].sort());
    expect(await db.countChatAttachments(session.id)).toBe(0);
  });

  it("clearAllChatAttachments wipes every session's rows", async () => {
    const { db } = await boot();
    const s1 = await db.createChatSession({});
    const s2 = await db.createChatSession({});
    await db.createChatAttachment({ id: "x1", messageId: null, sessionId: s1.id, filename: "1.png", mimeType: "image/png", size: 1, relPath: `${s1.id}/x1.png`, width: 1, height: 1 });
    await db.createChatAttachment({ id: "x2", messageId: null, sessionId: s2.id, filename: "2.png", mimeType: "image/png", size: 2, relPath: `${s2.id}/x2.png`, width: 1, height: 1 });

    const res = await db.clearAllChatAttachments();
    expect(res.deleted).toBe(2);
    expect(res.relPaths).toHaveLength(2);
    expect(await db.countChatAttachments()).toBe(0);
    // Sessions themselves are untouched.
    expect(await db.getChatSession(s1.id)).not.toBeNull();
  });

  it("deleteChatAttachmentsByMessage removes only that message's rows", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({});
    const m1 = await db.appendChatMessage({ sessionId: session.id, role: "user", content: { text: "a" } });
    const m2 = await db.appendChatMessage({ sessionId: session.id, role: "assistant", content: { text: "b" } });
    await db.createChatAttachment({ id: "d1", messageId: m1.id, sessionId: session.id, filename: "1.png", mimeType: "image/png", size: 1, relPath: `${session.id}/d1.png`, width: 1, height: 1 });
    await db.createChatAttachment({ id: "d2", messageId: m2.id, sessionId: session.id, filename: "2.png", mimeType: "image/png", size: 2, relPath: `${session.id}/d2.png`, width: 1, height: 1 });

    const res = await db.deleteChatAttachmentsByMessage(m1.id);
    expect(res).toEqual({ deleted: 1, relPaths: [`${session.id}/d1.png`] });
    expect(await db.getChatAttachment("d1")).toBeNull();
    // The sibling message's attachment survives.
    expect((await db.getChatAttachment("d2")).messageId).toBe(m2.id);
    expect(await db.countChatAttachments(session.id)).toBe(1);
  });

  it("clearAllChatAttachments empties stored refs while keeping message text", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({});
    const msg = await db.appendChatMessage({
      sessionId: session.id, role: "user",
      content: { text: "keep me", attachments: [{ id: "r1", filename: "r.png", mimeType: "image/png", width: 3, height: 4 }] },
    });
    await db.createChatAttachment({ id: "r1", messageId: msg.id, sessionId: session.id, filename: "r.png", mimeType: "image/png", size: 9, relPath: `${session.id}/r1.png`, width: 3, height: 4 });

    const res = await db.clearAllChatAttachments();
    expect(res.deleted).toBe(1);
    expect(res.relPaths).toEqual([`${session.id}/r1.png`]);

    const message = (await db.listChatMessages(session.id))[0];
    expect(message.content.text).toBe("keep me");
    expect(message.content.attachments).toEqual([]);
  });

  it("cascade-deletes a session's messages + attachment rows and returns relPaths", async () => {
    const { db } = await boot();
    const session = await db.createChatSession({});
    const m1 = await db.appendChatMessage({ sessionId: session.id, role: "user", content: { text: "a" } });
    const m2 = await db.appendChatMessage({ sessionId: session.id, role: "assistant", content: { text: "b" } });
    await db.createChatAttachment({ id: "c1", messageId: m1.id, sessionId: session.id, filename: "1.png", mimeType: "image/png", size: 1, relPath: `${session.id}/c1.png`, width: 1, height: 1 });
    await db.createChatAttachment({ id: "c2", messageId: m2.id, sessionId: session.id, filename: "2.png", mimeType: "image/png", size: 2, relPath: `${session.id}/c2.png`, width: 1, height: 1 });
    // An orphan that only carries the sessionId must be cleared too.
    await db.createChatAttachment({ id: "c3", messageId: null, sessionId: session.id, filename: "3.png", mimeType: "image/png", size: 3, relPath: `${session.id}/c3.png`, width: 1, height: 1 });

    const res = await db.deleteChatSession(session.id);
    expect(res.deleted).toBe(true);
    expect(res.relPaths.sort()).toEqual([`${session.id}/c1.png`, `${session.id}/c2.png`, `${session.id}/c3.png`].sort());
    expect(await db.getChatSession(session.id)).toBeNull();
    expect(await db.listChatMessages(session.id)).toEqual([]);
    expect(await db.countChatAttachments(session.id)).toBe(0);
  });
});

describe("chat image storage", () => {
  it("relPathFor and save → stats → delete round-trip", async () => {
    const storage = await import("@/lib/chat/storage.js");

    expect(storage.relPathFor("sess1", "img1", "png")).toBe("sess1/img1.png");
    expect(storage.relPathFor("sess1", "img2", ".jpg")).toBe("sess1/img2.jpg");

    const saved = storage.saveChatUpload({ sessionId: "sess1", id: "img1", ext: "png", buffer: Buffer.from("hello") });
    expect(saved).toEqual({ relPath: "sess1/img1.png", size: 5 });
    expect(fs.existsSync(path.join(storage.CHAT_UPLOADS_DIR, "sess1", "img1.png"))).toBe(true);

    expect(storage.getChatUploadsStats()).toEqual({ count: 1, bytes: 5 });

    expect(storage.deleteChatUploadFile("sess1/img1.png")).toBe(true);
    expect(storage.deleteChatUploadFile("sess1/img1.png")).toBe(false);
    expect(storage.getChatUploadsStats()).toEqual({ count: 0, bytes: 0 });
  });

  it("chatUploadAbsPath rejects traversal and saveChatUpload refuses unsafe ids", async () => {
    const storage = await import("@/lib/chat/storage.js");

    expect(storage.chatUploadAbsPath("../evil.png")).toBeNull();
    expect(storage.chatUploadAbsPath("sess/../../evil.png")).toBeNull();
    expect(storage.chatUploadAbsPath("/etc/passwd")).toBeNull();
    expect(storage.chatUploadAbsPath("")).toBeNull();
    expect(storage.chatUploadAbsPath(null)).toBeNull();

    const ok = storage.chatUploadAbsPath("sess/img.png");
    expect(ok.startsWith(storage.CHAT_UPLOADS_DIR + path.sep)).toBe(true);

    expect(() => storage.saveChatUpload({ sessionId: "../evil", id: "x", ext: "png", buffer: Buffer.from("x") })).toThrow(/unsafe/);
  });

  it("clearChatUploadsDir removes files and keeps the dir; missing dir reports zeros", async () => {
    const storage = await import("@/lib/chat/storage.js");

    // Missing dir first.
    expect(fs.existsSync(storage.CHAT_UPLOADS_DIR)).toBe(false);
    expect(storage.clearChatUploadsDir()).toEqual({ deletedFiles: 0, bytes: 0 });
    expect(storage.getChatUploadsStats()).toEqual({ count: 0, bytes: 0 });

    storage.ensureChatUploadsDir();
    storage.saveChatUpload({ sessionId: "s1", id: "a", ext: "png", buffer: Buffer.from("aaa") });
    storage.saveChatUpload({ sessionId: "s2", id: "b", ext: "jpg", buffer: Buffer.from("bb") });

    const res = storage.clearChatUploadsDir();
    expect(res).toEqual({ deletedFiles: 2, bytes: 5 });
    expect(fs.existsSync(storage.CHAT_UPLOADS_DIR)).toBe(true);
    expect(storage.getChatUploadsStats()).toEqual({ count: 0, bytes: 0 });
  });
});
