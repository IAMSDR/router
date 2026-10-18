// End-to-end integration test for the dashboard Chat feature (fork addition).
//
// Unlike tests/unit/chat-routes.test.js (which mocks the repo, the storage module
// and the pipeline) this file drives the real route handlers against a real
// SQLite database and real files under a temp DATA_DIR. The only thing mocked is
// the SSE pipeline entrypoint handleChat, which the completions bridge forwards
// to; everything else — chatRepo, storage, settings, pricing, translators — is
// the real module.
//
// Isolation is per FILE, not per test. src/lib/db/driver.js caches its adapter on
// globalThis (deliberately, to survive Next.js hot-reload), and the routes hold a
// module-level reference to the shared db barrel, so swapping the adapter per test
// would not be observed. All tests share one clean temp DATA_DIR and one database;
// each test creates its own sessions so they do not collide.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ handleChat: vi.fn() }));

// Mock ONLY the pipeline entrypoint — the bridge's job is to rebuild a request
// and forward SSE bytes, not to run a provider.
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));

// DATA_DIR is read at import time by src/lib/dataDir.js, so point it at a fresh
// temp dir before any project module is imported (all project imports below are
// dynamic, inside beforeAll).
const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chat-integration-"));
process.env.DATA_DIR = tempDir;

// A real, complete 1x1 PNG so both the header sniff and the byte-for-byte serve
// assertions run against genuine image bytes.
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const API = "http://localhost";
const encoder = new TextEncoder();

let db;
let adapter;
let storage;

let listSessions;
let createSessionRoute;
let getSession;
let patchSession;
let deleteSession;
let postMessage;
let deleteMessage;
let truncateMessage;
let postAttachment;
let getAttachment;
let postCompletion;
let getCacheStats;
let clearCache;

beforeAll(async () => {
  // Defensive: a stale adapter from another file in the same worker must not be
  // reused, since it would point at that file's database.
  delete global._dbAdapter;

  db = await import("@/lib/db/index.js");
  await db.initDb();
  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
  storage = await import("@/lib/chat/storage.js");

  ({ GET: listSessions, POST: createSessionRoute } = await import(
    "@/app/api/chat/sessions/route.js"
  ));
  ({ GET: getSession, PATCH: patchSession, DELETE: deleteSession } = await import(
    "@/app/api/chat/sessions/[id]/route.js"
  ));
  ({ POST: postMessage } = await import(
    "@/app/api/chat/sessions/[id]/messages/route.js"
  ));
  ({ DELETE: deleteMessage } = await import("@/app/api/chat/messages/[id]/route.js"));
  ({ POST: truncateMessage } = await import(
    "@/app/api/chat/messages/[id]/truncate/route.js"
  ));
  ({ POST: postAttachment } = await import("@/app/api/chat/attachments/route.js"));
  ({ GET: getAttachment } = await import("@/app/api/chat/attachments/[id]/route.js"));
  ({ POST: postCompletion } = await import("@/app/api/chat/completions/route.js"));
  ({ GET: getCacheStats, DELETE: clearCache } = await import(
    "@/app/api/settings/chat-cache/route.js"
  ));
});

afterAll(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {
    // best effort — the temp dir is about to be removed anyway
  }
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// ─── helpers ────────────────────────────────────────────────────────────

const params = (id) => ({ params: Promise.resolve({ id }) });

const jsonRequest = (url, method, body) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function uploadRequest(bytes, { sessionId, filename = "pic.png", type = "image/png" } = {}) {
  const form = new FormData();
  form.append("file", new File([bytes], filename, { type }));
  if (sessionId !== undefined) form.append("sessionId", sessionId);
  return new Request(`${API}/api/chat/attachments`, { method: "POST", body: form });
}

async function newSession() {
  const res = await createSessionRoute();
  expect(res.status).toBe(201);
  const { session } = await res.json();
  return session;
}

async function uploadPng(sessionId, bytes = ONE_BY_ONE_PNG) {
  const res = await postAttachment(uploadRequest(bytes, { sessionId }));
  const body = await res.json();
  return { res, attachment: body.attachment };
}

async function sendMessage(sessionId, { role = "user", text = "", attachmentIds = [] } = {}) {
  const res = await postMessage(
    jsonRequest(`${API}/api/chat/sessions/${sessionId}/messages`, "POST", {
      role,
      content: { text, attachmentIds },
    }),
    params(sessionId)
  );
  return res;
}

async function readSession(id) {
  const res = await getSession(new Request(`${API}/api/chat/sessions/${id}`), params(id));
  return { res, body: await res.json() };
}

function sseResponse(frames) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

function completionRequest(sessionId, model) {
  return jsonRequest(`${API}/api/chat/completions`, "POST", { sessionId, model });
}

// ─── 1. session lifecycle ───────────────────────────────────────────────

describe("chat integration — sessions", () => {
  it("creates, lists, patches and reads a session and 404s unknown ids", async () => {
    const session = await newSession();
    expect(session.title).toBe("New chat");

    const list = await listSessions();
    expect(list.status).toBe(200);
    const { sessions } = await list.json();
    expect(sessions.map((s) => s.id)).toContain(session.id);
    expect(sessions.find((s) => s.id === session.id).messageCount).toBe(0);

    const patchRes = await patchSession(
      jsonRequest(`${API}/api/chat/sessions/${session.id}`, "PATCH", {
        title: "Renamed",
        model: "acme/echo-1",
        systemPrompt: "Be terse",
        params: { temperature: 0.3, top_p: 0.9 },
        bogus: "ignored",
      }),
      params(session.id)
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()).session;
    expect(patched).toMatchObject({
      id: session.id,
      title: "Renamed",
      model: "acme/echo-1",
      systemPrompt: "Be terse",
    });
    expect(patched.params).toEqual({ temperature: 0.3, top_p: 0.9 });

    const read = await readSession(session.id);
    expect(read.res.status).toBe(200);
    expect(read.body.session).toMatchObject({
      id: session.id,
      title: "Renamed",
      model: "acme/echo-1",
      systemPrompt: "Be terse",
    });
    expect(read.body.session.params).toEqual({ temperature: 0.3, top_p: 0.9 });
    expect(read.body.messages).toEqual([]);

    const missingGet = await getSession(
      new Request(`${API}/api/chat/sessions/does-not-exist`),
      params("does-not-exist")
    );
    expect(missingGet.status).toBe(404);

    const missingPatch = await patchSession(
      jsonRequest(`${API}/api/chat/sessions/does-not-exist`, "PATCH", { title: "x" }),
      params("does-not-exist")
    );
    expect(missingPatch.status).toBe(404);
  });
});

// ─── 2. upload → message → link ─────────────────────────────────────────

describe("chat integration — upload and link", () => {
  it("stores a real PNG on disk and links it to a message", async () => {
    const session = await newSession();

    const { res: uploadRes, attachment } = await uploadPng(session.id);
    expect(uploadRes.status).toBe(201);
    expect(attachment.url).toBe(`/api/chat/attachments/${attachment.id}`);
    expect(attachment).toMatchObject({ mimeType: "image/png", width: 1, height: 1 });

    const row = await db.getChatAttachment(attachment.id);
    expect(row).not.toBeNull();
    expect(row.sessionId).toBe(session.id);

    const absPath = storage.chatUploadAbsPath(row.relPath);
    expect(absPath).not.toBeNull();
    expect(absPath.startsWith(path.join(tempDir, "chat-uploads") + path.sep)).toBe(true);
    expect(fs.existsSync(absPath)).toBe(true);
    expect(fs.readFileSync(absPath).equals(ONE_BY_ONE_PNG)).toBe(true);

    const msgRes = await sendMessage(session.id, { text: "look", attachmentIds: [attachment.id] });
    expect(msgRes.status).toBe(201);
    const { message } = await msgRes.json();
    expect(message.content.text).toBe("look");
    expect(message.content.attachments).toHaveLength(1);
    expect(message.content.attachments[0]).toMatchObject({
      id: attachment.id,
      url: `/api/chat/attachments/${attachment.id}`,
    });

    // A fresh session read resolves the ref from the attachment row and adds a url.
    const read = await readSession(session.id);
    const reread = read.body.messages.find((m) => m.id === message.id);
    expect(reread.content.attachments).toHaveLength(1);
    expect(reread.content.attachments[0].id).toBe(attachment.id);
    expect(reread.content.attachments[0].url).toBe(`/api/chat/attachments/${attachment.id}`);

    // The stored refs pin the id (and deliberately omit the derived url).
    const raw = adapter.get(`SELECT content FROM chatMessages WHERE id = ?`, [message.id]);
    const stored = JSON.parse(raw.content);
    expect(stored.attachments).toEqual([
      { id: attachment.id, filename: "pic.png", mimeType: "image/png", width: 1, height: 1 },
    ]);
    expect(stored.attachments[0].url).toBeUndefined();
  });
});

// ─── 3. serving the bytes ───────────────────────────────────────────────

describe("chat integration — serving attachment bytes", () => {
  it("returns the uploaded PNG bytes and 404s an unknown id", async () => {
    const session = await newSession();
    const { attachment } = await uploadPng(session.id);

    const served = await getAttachment(
      new Request(`${API}/api/chat/attachments/${attachment.id}`),
      params(attachment.id)
    );
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await served.arrayBuffer());
    expect(bytes.equals(ONE_BY_ONE_PNG)).toBe(true);

    const missing = await getAttachment(
      new Request(`${API}/api/chat/attachments/does-not-exist`),
      params("does-not-exist")
    );
    expect(missing.status).toBe(404);
  });
});

// ─── 4. upload rejections ───────────────────────────────────────────────

describe("chat integration — upload rejections", () => {
  it("rejects a non-image mime type and an over-5MB buffer", async () => {
    const session = await newSession();

    const textRes = await postAttachment(
      uploadRequest(Buffer.from("not an image"), {
        sessionId: session.id,
        filename: "note.txt",
        type: "text/plain",
      })
    );
    expect(textRes.status).toBeGreaterThanOrEqual(400);
    expect(textRes.status).toBeLessThan(500);
    expect((await textRes.json()).error).toMatch(/Unsupported image type/);

    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const bigRes = await postAttachment(
      uploadRequest(big, { sessionId: session.id, filename: "big.png" })
    );
    expect(bigRes.status).toBeGreaterThanOrEqual(400);
    expect(bigRes.status).toBeLessThan(500);
    expect((await bigRes.json()).error).toMatch(/5 MB/);

    // Neither rejected upload wrote a row (or a file).
    expect(await db.countChatAttachments(session.id)).toBe(0);
  });
});

// ─── 5. truncate ────────────────────────────────────────────────────────

describe("chat integration — truncate", () => {
  it("removes the target message and every later one with their attachments", async () => {
    const session = await newSession();
    const first = (await (await sendMessage(session.id, { text: "zero" })).json()).message;

    const att1 = (await uploadPng(session.id)).attachment;
    const target = (
      await (await sendMessage(session.id, { text: "one", attachmentIds: [att1.id] })).json()
    ).message;

    const att2 = (await uploadPng(session.id)).attachment;
    await sendMessage(session.id, { text: "two", attachmentIds: [att2.id] });

    const abs1 = storage.chatUploadAbsPath((await db.getChatAttachment(att1.id)).relPath);
    const abs2 = storage.chatUploadAbsPath((await db.getChatAttachment(att2.id)).relPath);
    expect(fs.existsSync(abs1)).toBe(true);
    expect(fs.existsSync(abs2)).toBe(true);

    const truncRes = await truncateMessage(
      jsonRequest(`${API}/api/chat/messages/${target.id}/truncate`, "POST", {
        sessionId: session.id,
      }),
      params(target.id)
    );
    expect(truncRes.status).toBe(200);
    expect(await truncRes.json()).toEqual({ success: true });

    const read = await readSession(session.id);
    expect(read.body.messages.map((m) => m.id)).toEqual([first.id]);
    expect(await db.getChatAttachment(att1.id)).toBeNull();
    expect(await db.getChatAttachment(att2.id)).toBeNull();
    expect(fs.existsSync(abs1)).toBe(false);
    expect(fs.existsSync(abs2)).toBe(false);
  });
});

// ─── 6. delete a message ────────────────────────────────────────────────

describe("chat integration — delete a message", () => {
  it("removes the message row, its attachment row and its file", async () => {
    const session = await newSession();
    const att = (await uploadPng(session.id)).attachment;
    const msg = (
      await (await sendMessage(session.id, { text: "with image", attachmentIds: [att.id] })).json()
    ).message;

    const absPath = storage.chatUploadAbsPath((await db.getChatAttachment(att.id)).relPath);
    expect(fs.existsSync(absPath)).toBe(true);

    const delRes = await deleteMessage(
      new Request(`${API}/api/chat/messages/${msg.id}`, { method: "DELETE" }),
      params(msg.id)
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ success: true });

    expect((await readSession(session.id)).body.messages).toEqual([]);
    expect(await db.getChatAttachment(att.id)).toBeNull();
    expect(fs.existsSync(absPath)).toBe(false);

    const missing = await deleteMessage(
      new Request(`${API}/api/chat/messages/does-not-exist`, { method: "DELETE" }),
      params("does-not-exist")
    );
    expect(missing.status).toBe(404);
  });
});

// ─── 7. delete a session ────────────────────────────────────────────────

describe("chat integration — delete a session", () => {
  it("removes its messages, attachment rows and image files", async () => {
    const session = await newSession();

    const att1 = (await uploadPng(session.id)).attachment;
    await sendMessage(session.id, { text: "first", attachmentIds: [att1.id] });
    const att2 = (await uploadPng(session.id)).attachment;
    await sendMessage(session.id, { role: "assistant", text: "second", attachmentIds: [att2.id] });

    const abs1 = storage.chatUploadAbsPath((await db.getChatAttachment(att1.id)).relPath);
    const abs2 = storage.chatUploadAbsPath((await db.getChatAttachment(att2.id)).relPath);
    expect(fs.existsSync(abs1)).toBe(true);
    expect(fs.existsSync(abs2)).toBe(true);

    const delRes = await deleteSession(
      new Request(`${API}/api/chat/sessions/${session.id}`, { method: "DELETE" }),
      params(session.id)
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ success: true });

    expect((await readSession(session.id)).res.status).toBe(404);
    expect(await db.listChatMessages(session.id)).toEqual([]);
    expect(await db.getChatAttachment(att1.id)).toBeNull();
    expect(await db.getChatAttachment(att2.id)).toBeNull();
    expect(fs.existsSync(abs1)).toBe(false);
    expect(fs.existsSync(abs2)).toBe(false);
  });
});

// ─── 8. settings cache clear ────────────────────────────────────────────

describe("chat integration — settings chat-cache clear", () => {
  it("reports on-disk files then clears them and the rows, keeping message text", async () => {
    const s1 = await newSession();
    const s2 = await newSession();

    const att1 = (await uploadPng(s1.id)).attachment;
    const att2 = (await uploadPng(s2.id)).attachment;
    const msg1 = (
      await (await sendMessage(s1.id, { text: "keep this text", attachmentIds: [att1.id] })).json()
    ).message;
    await sendMessage(s2.id, { text: "other text", attachmentIds: [att2.id] });

    const statsRes = await getCacheStats();
    expect(statsRes.status).toBe(200);
    const stats = await statsRes.json();
    // Other tests also leave files around, so only assert the cache is non-empty.
    expect(stats.count).toBeGreaterThan(0);
    expect(stats.bytes).toBeGreaterThan(0);

    const delRes = await clearCache();
    expect(delRes.status).toBe(200);
    const cleared = await delRes.json();
    expect(cleared.deletedFiles).toBeGreaterThan(0);
    expect(cleared.deletedRows).toBeGreaterThan(0);

    expect(await db.getChatAttachment(att1.id)).toBeNull();
    expect(await db.getChatAttachment(att2.id)).toBeNull();
    expect(await storage.getChatUploadsStats()).toEqual({ count: 0, bytes: 0 });

    // The message survives with its text; its attachments read back empty because
    // the rows are gone and the stored refs were blanked.
    const read = await readSession(s1.id);
    const reread = read.body.messages.find((m) => m.id === msg1.id);
    expect(reread).toBeTruthy();
    expect(reread.content.text).toBe("keep this text");
    expect(reread.content.attachments).toEqual([]);
  });
});

// ─── 9. completions bridge ──────────────────────────────────────────────

describe("chat integration — completions bridge", () => {
  beforeEach(() => {
    mocks.handleChat.mockReset();
    // No active keys: the requireApiKey branch must find none.
    adapter.run(`DELETE FROM apiKeys`);
  });

  it("streams the SSE bytes and persists the accumulated assistant turn", async () => {
    await db.updateSettings({ requireApiKey: false });
    const session = await newSession();
    await sendMessage(session.id, { text: "hi" });

    mocks.handleChat.mockResolvedValue(
      sseResponse([
        'data: {"model":"acme/echo-1","choices":[{"delta":{"reasoning_content":"think "}}]}\n\n',
        'data: {"model":"acme/echo-1","choices":[{"delta":{"content":"Hello "}}]}\n\n',
        'data: {"model":"acme/echo-1","choices":[{"delta":{"content":"world"}}]}\n\n',
        'data: {"model":"acme/echo-1","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n',
        "data: [DONE]\n\n",
      ])
    );

    const res = await postCompletion(completionRequest(session.id, "acme/echo-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const forwarded = await res.text();
    expect(forwarded).toContain('"content":"Hello "');
    expect(forwarded).toContain('"content":"world"');
    expect(forwarded).toContain("data: [DONE]");

    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
    const upstream = mocks.handleChat.mock.calls[0][0];
    expect(upstream.headers.get("Authorization")).toBeNull();

    const messages = await db.listChatMessages(session.id);
    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.content.text).toBe("Hello world");
    expect(assistant.reasoning).toBe("think ");
    expect(assistant.promptTokens).toBe(11);
    expect(assistant.completionTokens).toBe(7);
    expect(assistant.model).toBe("echo-1");
    expect(assistant.provider).toBe("acme");
    expect(assistant.status).toBe("success");
  });

  it("400s and never calls handleChat when requireApiKey is on and no key is active", async () => {
    await db.updateSettings({ requireApiKey: true });
    const session = await newSession();

    const res = await postCompletion(completionRequest(session.id, "acme/echo-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/API key/i);
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });

  it("calls handleChat with no Authorization header when requireApiKey is off", async () => {
    await db.updateSettings({ requireApiKey: false });
    const session = await newSession();

    mocks.handleChat.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    const res = await postCompletion(completionRequest(session.id, "acme/echo-1"));
    await res.text();

    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
    expect(mocks.handleChat.mock.calls[0][0].headers.get("Authorization")).toBeNull();
  });
});
