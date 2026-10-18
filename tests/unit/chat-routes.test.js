// Route-level tests for the dashboard Chat HTTP API (fork addition).
//
// The routes sit on top of the chatRepo data layer, the on-disk upload storage
// and the real SSE chat pipeline. Every one of those is mocked here so the
// tests exercise only the routing/validation/persistence logic: the pipeline's
// own behaviour has its own coverage.
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  // chatRepo
  listChatSessions: vi.fn(),
  getChatSession: vi.fn(),
  createChatSession: vi.fn(),
  updateChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  listChatMessages: vi.fn(),
  appendChatMessage: vi.fn(),
  updateChatMessage: vi.fn(),
  deleteChatMessage: vi.fn(),
  deleteChatMessagesFrom: vi.fn(),
  createChatAttachment: vi.fn(),
  getChatAttachment: vi.fn(),
  listChatAttachments: vi.fn(),
  linkChatAttachmentsToMessage: vi.fn(),
  deleteChatAttachment: vi.fn(),
  deleteChatAttachmentsByMessage: vi.fn(),
  // settings / api keys
  getSettings: vi.fn(),
  getApiKeys: vi.fn(),
  // storage
  saveChatUpload: vi.fn(),
  deleteChatUploadFile: vi.fn(),
  chatUploadAbsPath: vi.fn(),
  // pipeline
  handleChat: vi.fn(),
  initTranslators: vi.fn(),
  getModelInfo: vi.fn(),
  getPricingForModel: vi.fn(),
  calculateCostFromTokens: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const chatRepoMock = () => ({
  listChatSessions: mocks.listChatSessions,
  getChatSession: mocks.getChatSession,
  createChatSession: mocks.createChatSession,
  updateChatSession: mocks.updateChatSession,
  deleteChatSession: mocks.deleteChatSession,
  listChatMessages: mocks.listChatMessages,
  appendChatMessage: mocks.appendChatMessage,
  updateChatMessage: mocks.updateChatMessage,
  deleteChatMessage: mocks.deleteChatMessage,
  deleteChatMessagesFrom: mocks.deleteChatMessagesFrom,
  createChatAttachment: mocks.createChatAttachment,
  getChatAttachment: mocks.getChatAttachment,
  listChatAttachments: mocks.listChatAttachments,
  linkChatAttachmentsToMessage: mocks.linkChatAttachmentsToMessage,
  deleteChatAttachment: mocks.deleteChatAttachment,
  deleteChatAttachmentsByMessage: mocks.deleteChatAttachmentsByMessage,
});

vi.mock("@/lib/db", () => ({
  ...chatRepoMock(),
  getSettings: mocks.getSettings,
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/lib/db/repos/chatRepo.js", () => chatRepoMock());

vi.mock("@/lib/chat/storage.js", () => ({
  saveChatUpload: mocks.saveChatUpload,
  deleteChatUploadFile: mocks.deleteChatUploadFile,
  chatUploadAbsPath: mocks.chatUploadAbsPath,
}));

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: mocks.initTranslators }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo }));
vi.mock("@/lib/db/repos/pricingRepo.js", () => ({ getPricingForModel: mocks.getPricingForModel }));
vi.mock("open-sse/providers/pricing.js", () => ({
  calculateCostFromTokens: mocks.calculateCostFromTokens,
}));

const { GET: listSessions, POST: createSession } = await import(
  "@/app/api/chat/sessions/route.js"
);
const { GET: getSession, PATCH: patchSession, DELETE: deleteSession } = await import(
  "@/app/api/chat/sessions/[id]/route.js"
);
const { POST: postMessage } = await import(
  "@/app/api/chat/sessions/[id]/messages/route.js"
);
const { DELETE: deleteMessage } = await import("@/app/api/chat/messages/[id]/route.js");
const { POST: truncateMessage } = await import(
  "@/app/api/chat/messages/[id]/truncate/route.js"
);
const { POST: postAttachment } = await import("@/app/api/chat/attachments/route.js");
const { GET: getAttachment } = await import("@/app/api/chat/attachments/[id]/route.js");
const { POST: postCompletion } = await import("@/app/api/chat/completions/route.js");

// ─── helpers ────────────────────────────────────────────────────────────

const jsonRequest = (url, method, body, signal) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

const params = (values) => ({ params: Promise.resolve(values) });

const encoder = new TextEncoder();
function sseResponse(frames) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}
function openSseResponse(frames) {
  // Emits frames but never closes — models a stream the client walks away from.
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

function pngBuffer(width = 5, height = 6) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function uploadRequest(file, sessionId = "s1") {
  const form = new FormData();
  form.append("file", file);
  if (sessionId) form.append("sessionId", sessionId);
  return new Request("http://localhost/api/chat/attachments", { method: "POST", body: form });
}

function completionRequest(body, signal) {
  return jsonRequest("http://localhost/api/chat/completions", "POST", body, signal);
}

describe("Chat routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initTranslators.mockResolvedValue(undefined);
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getApiKeys.mockResolvedValue([]);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o-mini" });
    mocks.getPricingForModel.mockResolvedValue({
      input: 1, output: 2, cached: 0, reasoning: 2, cache_creation: 1,
    });
    mocks.calculateCostFromTokens.mockReturnValue(0.001);
    mocks.listChatMessages.mockResolvedValue([]);
    mocks.listChatAttachments.mockResolvedValue([]);
    mocks.getChatSession.mockResolvedValue({ id: "s1", title: "t", model: "m", systemPrompt: "", params: {} });
    mocks.appendChatMessage.mockResolvedValue({ id: "m-new", sessionId: "s1", role: "assistant", content: { text: "", attachments: [] } });
    mocks.updateChatMessage.mockImplementation(async (id, patch) => ({
      id, sessionId: "s1", role: "assistant", content: patch.content,
    }));
    mocks.linkChatAttachmentsToMessage.mockResolvedValue(1);
    mocks.deleteChatAttachmentsByMessage.mockResolvedValue({ deleted: 0, relPaths: [] });
    mocks.deleteChatUploadFile.mockReturnValue(true);
    mocks.chatUploadAbsPath.mockReturnValue(null);
    mocks.handleChat.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
  });

  // ─── sessions ────────────────────────────────────────────────────────

  describe("sessions", () => {
    it("GET lists sessions", async () => {
      mocks.listChatSessions.mockResolvedValue([{ id: "s1", title: "One" }]);
      const res = await listSessions();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sessions: [{ id: "s1", title: "One" }] });
    });

    it("POST creates a session with the default title", async () => {
      mocks.createChatSession.mockResolvedValue({ id: "s2", title: "New chat" });
      const res = await createSession();
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ session: { id: "s2", title: "New chat" } });
      expect(mocks.createChatSession).toHaveBeenCalledWith({ title: "New chat" });
    });
  });

  // ─── session detail ──────────────────────────────────────────────────

  describe("session detail", () => {
    it("GET 404s for an unknown session", async () => {
      mocks.getChatSession.mockResolvedValue(null);
      const res = await getSession(new Request("http://localhost/api/chat/sessions/missing"), params({ id: "missing" }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Session not found" });
      expect(mocks.listChatMessages).not.toHaveBeenCalled();
    });

    it("GET returns session and messages with attachment urls", async () => {
      mocks.listChatMessages.mockResolvedValue([
        {
          id: "m1", role: "user",
          content: { text: "look", attachments: [{ id: "a1", filename: "a.png", mimeType: "image/png", width: 5, height: 6 }] },
        },
      ]);
      const res = await getSession(new Request("http://localhost/api/chat/sessions/s1"), params({ id: "s1" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.session.id).toBe("s1");
      expect(data.messages[0].content.attachments[0].url).toBe("/api/chat/attachments/a1");
    });

    it("PATCH rejects a non-object body with 400", async () => {
      const res = await patchSession(
        jsonRequest("http://localhost/api/chat/sessions/s1", "PATCH", []),
        params({ id: "s1" })
      );
      expect(res.status).toBe(400);
      expect(mocks.updateChatSession).not.toHaveBeenCalled();
    });

    it("PATCH forwards only the patchable fields", async () => {
      mocks.updateChatSession.mockResolvedValue({ id: "s1", title: "Renamed" });
      const res = await patchSession(
        jsonRequest("http://localhost/api/chat/sessions/s1", "PATCH", { title: "Renamed", bogus: 1 }),
        params({ id: "s1" })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ session: { id: "s1", title: "Renamed" } });
      expect(mocks.updateChatSession).toHaveBeenCalledWith("s1", { title: "Renamed" });
    });

    it("PATCH 404s when the session is missing", async () => {
      mocks.updateChatSession.mockResolvedValue(null);
      const res = await patchSession(
        jsonRequest("http://localhost/api/chat/sessions/gone", "PATCH", { title: "x" }),
        params({ id: "gone" })
      );
      expect(res.status).toBe(404);
    });

    it("DELETE unlinks every returned relPath", async () => {
      mocks.deleteChatSession.mockResolvedValue({ deleted: true, relPaths: ["s1/a.png", "s1/b.png"] });
      const res = await deleteSession(
        new Request("http://localhost/api/chat/sessions/s1", { method: "DELETE" }),
        params({ id: "s1" })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(mocks.deleteChatUploadFile).toHaveBeenCalledWith("s1/a.png");
      expect(mocks.deleteChatUploadFile).toHaveBeenCalledWith("s1/b.png");
    });

    it("DELETE still succeeds when unlinking a file throws", async () => {
      mocks.deleteChatSession.mockResolvedValue({ deleted: true, relPaths: ["s1/a.png"] });
      mocks.deleteChatUploadFile.mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await deleteSession(
        new Request("http://localhost/api/chat/sessions/s1", { method: "DELETE" }),
        params({ id: "s1" })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    });
  });

  // ─── message POST ────────────────────────────────────────────────────

  describe("message POST", () => {
    it("400s for an unknown session", async () => {
      mocks.getChatSession.mockResolvedValue(null);
      const res = await postMessage(
        jsonRequest("http://localhost/api/chat/sessions/x/messages", "POST", { role: "user", content: { text: "hi" } }),
        params({ id: "x" })
      );
      expect(res.status).toBe(400);
      expect(mocks.appendChatMessage).not.toHaveBeenCalled();
    });

    it("400s for a role other than user/assistant", async () => {
      const res = await postMessage(
        jsonRequest("http://localhost/api/chat/sessions/s1/messages", "POST", { role: "system", content: { text: "hi" } }),
        params({ id: "s1" })
      );
      expect(res.status).toBe(400);
      expect(mocks.appendChatMessage).not.toHaveBeenCalled();
    });

    it("400s when there is neither text nor attachments", async () => {
      const res = await postMessage(
        jsonRequest("http://localhost/api/chat/sessions/s1/messages", "POST", { role: "user", content: { text: "   ", attachmentIds: [] } }),
        params({ id: "s1" })
      );
      expect(res.status).toBe(400);
      expect(mocks.appendChatMessage).not.toHaveBeenCalled();
    });

    it("links attachments and returns refs with urls", async () => {
      mocks.appendChatMessage.mockResolvedValue({ id: "m1", sessionId: "s1", role: "user", content: { text: "look", attachments: [] } });
      mocks.listChatAttachments.mockResolvedValue([
        { id: "a1", messageId: "m1", filename: "a.png", mimeType: "image/png", width: 5, height: 6, relPath: "s1/a1.png" },
      ]);

      const res = await postMessage(
        jsonRequest("http://localhost/api/chat/sessions/s1/messages", "POST", { role: "user", content: { text: "look", attachmentIds: ["a1"] } }),
        params({ id: "s1" })
      );

      expect(res.status).toBe(201);
      expect(mocks.linkChatAttachmentsToMessage).toHaveBeenCalledWith({
        sessionId: "s1",
        messageId: "m1",
        attachmentIds: ["a1"],
      });
      const { message } = await res.json();
      expect(message.content.attachments).toEqual([
        { id: "a1", filename: "a.png", mimeType: "image/png", width: 5, height: 6, url: "/api/chat/attachments/a1" },
      ]);
      expect(mocks.updateChatMessage).toHaveBeenCalledWith("m1", {
        content: {
          text: "look",
          attachments: [{ id: "a1", filename: "a.png", mimeType: "image/png", width: 5, height: 6 }],
        },
      });
    });
  });

  // ─── message delete / truncate ───────────────────────────────────────

  describe("message delete and truncate", () => {
    it("DELETE 404s for an unknown message and destroys no attachments", async () => {
      mocks.deleteChatMessage.mockResolvedValue(false);
      const res = await deleteMessage(
        new Request("http://localhost/api/chat/messages/m1", { method: "DELETE" }),
        params({ id: "m1" })
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Message not found" });
      expect(mocks.deleteChatAttachmentsByMessage).not.toHaveBeenCalled();
      expect(mocks.deleteChatUploadFile).not.toHaveBeenCalled();
    });

    it("DELETE removes the message, its attachment rows and their files", async () => {
      mocks.deleteChatMessage.mockResolvedValue(true);
      mocks.deleteChatAttachmentsByMessage.mockResolvedValue({
        deleted: 2,
        relPaths: ["s1/a1.png", "s1/a2.png"],
      });

      const res = await deleteMessage(
        new Request("http://localhost/api/chat/messages/m1", { method: "DELETE" }),
        params({ id: "m1" })
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(mocks.deleteChatMessage).toHaveBeenCalledWith("m1");
      expect(mocks.deleteChatAttachmentsByMessage).toHaveBeenCalledWith("m1");
      expect(mocks.deleteChatUploadFile).toHaveBeenCalledWith("s1/a1.png");
      expect(mocks.deleteChatUploadFile).toHaveBeenCalledWith("s1/a2.png");
    });

    it("DELETE ignores a legacy sessionId and still cleans up", async () => {
      mocks.deleteChatMessage.mockResolvedValue(true);
      mocks.deleteChatAttachmentsByMessage.mockResolvedValue({ deleted: 1, relPaths: ["s1/a1.png"] });

      const res = await deleteMessage(
        jsonRequest("http://localhost/api/chat/messages/m1?sessionId=s1", "DELETE", { sessionId: "s1" }),
        params({ id: "m1" })
      );

      expect(res.status).toBe(200);
      expect(mocks.deleteChatAttachmentsByMessage).toHaveBeenCalledWith("m1");
      // The session lookup the old implementation used is gone.
      expect(mocks.listChatMessages).not.toHaveBeenCalled();
      expect(mocks.getChatAttachment).not.toHaveBeenCalled();
    });

    it("DELETE still succeeds when unlinking a file throws", async () => {
      mocks.deleteChatMessage.mockResolvedValue(true);
      mocks.deleteChatAttachmentsByMessage.mockResolvedValue({ deleted: 1, relPaths: ["s1/a1.png"] });
      mocks.deleteChatUploadFile.mockImplementation(() => {
        throw new Error("boom");
      });

      const res = await deleteMessage(
        new Request("http://localhost/api/chat/messages/m1", { method: "DELETE" }),
        params({ id: "m1" })
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    });

    it("truncate removes the tail and unlinks returned files", async () => {
      mocks.deleteChatMessagesFrom.mockResolvedValue({ deleted: 2, relPaths: ["s1/a.png"] });
      const res = await truncateMessage(
        jsonRequest("http://localhost/api/chat/messages/m1/truncate", "POST", { sessionId: "s1" }),
        params({ id: "m1" })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(mocks.deleteChatMessagesFrom).toHaveBeenCalledWith("s1", "m1");
      expect(mocks.deleteChatUploadFile).toHaveBeenCalledWith("s1/a.png");
    });

    it("truncate requires a sessionId", async () => {
      const res = await truncateMessage(
        jsonRequest("http://localhost/api/chat/messages/m1/truncate", "POST", {}),
        params({ id: "m1" })
      );
      expect(res.status).toBe(400);
      expect(mocks.deleteChatMessagesFrom).not.toHaveBeenCalled();
    });
  });

  // ─── attachments ─────────────────────────────────────────────────────

  describe("attachments", () => {
    it("rejects an unsupported mime type", async () => {
      const res = await postAttachment(uploadRequest(new File([Buffer.from("hi")], "a.txt", { type: "text/plain" })));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Unsupported image type/);
      expect(mocks.saveChatUpload).not.toHaveBeenCalled();
    });

    it("rejects an image larger than 5 MB", async () => {
      const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
      const res = await postAttachment(uploadRequest(big));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/5 MB/);
      expect(mocks.saveChatUpload).not.toHaveBeenCalled();
    });

    it("requires a sessionId", async () => {
      const res = await postAttachment(uploadRequest(new File([pngBuffer()], "a.png", { type: "image/png" }), ""));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/sessionId/);
      expect(mocks.saveChatUpload).not.toHaveBeenCalled();
    });

    it("persists a valid image, sniffing its dimensions", async () => {
      mocks.saveChatUpload.mockReturnValue({ relPath: "s1/abc.png", size: 24 });
      mocks.createChatAttachment.mockResolvedValue({ id: "abc" });

      const res = await postAttachment(uploadRequest(new File([pngBuffer(5, 6)], "pic.png", { type: "image/png" })));

      expect(res.status).toBe(201);
      const { attachment } = await res.json();
      expect(attachment).toMatchObject({ filename: "pic.png", mimeType: "image/png", width: 5, height: 6 });
      expect(attachment.url).toBe(`/api/chat/attachments/${attachment.id}`);
      expect(mocks.saveChatUpload).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "s1", ext: "png" })
      );
      expect(mocks.createChatAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "s1", messageId: null, mimeType: "image/png", width: 5, height: 6 })
      );
    });

    it("rejects an over-large declared body with 413 before parsing", async () => {
      const form = new FormData();
      form.append("file", new File([pngBuffer()], "a.png", { type: "image/png" }));
      form.append("sessionId", "s1");
      const req = new Request("http://localhost/api/chat/attachments", {
        method: "POST",
        body: form,
        headers: { "content-length": String(9 * 1024 * 1024) },
      });

      const res = await postAttachment(req);

      expect(res.status).toBe(413);
      expect((await res.json()).error).toMatch(/too large/i);
      expect(mocks.saveChatUpload).not.toHaveBeenCalled();
    });

    it("unlinks the file when the attachment row insert fails", async () => {
      mocks.saveChatUpload.mockReturnValue({ relPath: "s1/abc.png", size: 24 });
      mocks.createChatAttachment.mockRejectedValue(new Error("db down"));

      const res = await postAttachment(
        uploadRequest(new File([pngBuffer()], "pic.png", { type: "image/png" }))
      );

      expect(res.status).toBe(500);
      expect(mocks.deleteChatUploadFile).toHaveBeenCalledWith("s1/abc.png");
    });

    it("GET 404s for an unknown attachment", async () => {
      mocks.getChatAttachment.mockResolvedValue(null);
      const res = await getAttachment(
        new Request("http://localhost/api/chat/attachments/nope"),
        params({ id: "nope" })
      );
      expect(res.status).toBe(404);
    });

    it("GET 404s when the file is gone", async () => {
      mocks.getChatAttachment.mockResolvedValue({ id: "a1", mimeType: "image/png", relPath: "s1/a1.png" });
      mocks.chatUploadAbsPath.mockReturnValue(null);
      const res = await getAttachment(
        new Request("http://localhost/api/chat/attachments/a1"),
        params({ id: "a1" })
      );
      expect(res.status).toBe(404);
    });

    it("GET streams the bytes with the stored mime type and cache headers", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-att-"));
      const filePath = path.join(dir, "a1.png");
      fs.writeFileSync(filePath, Buffer.from([1, 2, 3, 4]));

      mocks.getChatAttachment.mockResolvedValue({ id: "a1", mimeType: "image/png", relPath: "s1/a1.png" });
      mocks.chatUploadAbsPath.mockReturnValue(filePath);

      const res = await getAttachment(
        new Request("http://localhost/api/chat/attachments/a1"),
        params({ id: "a1" })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
      expect([...Buffer.from(await res.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    });

    it("serves a non-allowlisted stored mime type as application/octet-stream", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-att-"));
      const filePath = path.join(dir, "a1.html");
      fs.writeFileSync(filePath, Buffer.from("<script>alert(1)</script>"));

      // A row planted by an import could carry active content at the origin.
      mocks.getChatAttachment.mockResolvedValue({ id: "a1", mimeType: "text/html", relPath: "s1/a1.html" });
      mocks.chatUploadAbsPath.mockReturnValue(filePath);

      const res = await getAttachment(
        new Request("http://localhost/api/chat/attachments/a1"),
        params({ id: "a1" })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    });
  });

  // ─── completions bridge ──────────────────────────────────────────────

  describe("completions bridge", () => {
    it("404s before doing any work when the session is unknown", async () => {
      mocks.getChatSession.mockResolvedValue(null);
      const res = await postCompletion(completionRequest({ sessionId: "missing", model: "m" }));
      expect(res.status).toBe(404);
      expect(mocks.listChatMessages).not.toHaveBeenCalled();
      expect(mocks.handleChat).not.toHaveBeenCalled();
    });

    it("400s when requireApiKey is on but there is no active key", async () => {
      mocks.getSettings.mockResolvedValue({ requireApiKey: true });
      mocks.getApiKeys.mockResolvedValue([{ id: "k1", key: "sk-off", isActive: false }]);
      const res = await postCompletion(completionRequest({ sessionId: "s1", model: "m" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/API key/i);
      expect(mocks.handleChat).not.toHaveBeenCalled();
    });

    it("sends the first active key as Bearer when requireApiKey is on", async () => {
      mocks.getSettings.mockResolvedValue({ requireApiKey: true });
      mocks.getApiKeys.mockResolvedValue([
        { id: "k0", key: "sk-off", isActive: false },
        { id: "k1", key: "sk-live", isActive: true },
      ]);
      const res = await postCompletion(completionRequest({ sessionId: "s1", model: "m" }));
      await res.text();
      expect(mocks.handleChat).toHaveBeenCalledTimes(1);
      expect(mocks.handleChat.mock.calls[0][0].headers.get("Authorization")).toBe("Bearer sk-live");
    });

    it("sends no Authorization header when requireApiKey is off", async () => {
      mocks.getSettings.mockResolvedValue({ requireApiKey: false });
      mocks.getApiKeys.mockResolvedValue([{ id: "k1", key: "sk-live", isActive: true }]);
      const res = await postCompletion(completionRequest({ sessionId: "s1", model: "m" }));
      await res.text();
      expect(mocks.handleChat.mock.calls[0][0].headers.get("Authorization")).toBeNull();
    });

    it("forces stream:true and stream_options over conflicting caller params", async () => {
      mocks.listChatMessages.mockResolvedValue([
        { id: "u1", sessionId: "s1", role: "user", content: { text: "hi", attachments: [] } },
      ]);
      const res = await postCompletion(
        completionRequest({
          sessionId: "s1",
          model: "gpt-4o-mini",
          params: { stream: false, stream_options: { include_usage: false }, temperature: 0.5 },
        })
      );
      await res.text();

      const upstreamBody = JSON.parse(await mocks.handleChat.mock.calls[0][0].text());
      expect(upstreamBody.stream).toBe(true);
      expect(upstreamBody.stream_options).toEqual({ include_usage: true });
      // Non-conflicting caller params survive.
      expect(upstreamBody.temperature).toBe(0.5);
    });

    it("persists one assistant message with accumulated content, reasoning and usage", async () => {
      mocks.listChatMessages.mockResolvedValue([
        { id: "u1", sessionId: "s1", role: "user", content: { text: "hi", attachments: [] } },
      ]);
      mocks.handleChat.mockResolvedValue(
        sseResponse([
          'data: {"model":"openai/gpt-4o-mini","choices":[{"delta":{"reasoning_content":"think "}}]}\n\n',
          'data: {"model":"openai/gpt-4o-mini","choices":[{"delta":{"content":"Hello "}}]}\n\n',
          'data: {"model":"openai/gpt-4o-mini","choices":[{"delta":{"content":"world"}}]}\n\n',
          'data: {"model":"openai/gpt-4o-mini","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
          "data: [DONE]\n\n",
        ])
      );

      const res = await postCompletion(
        completionRequest({ sessionId: "s1", model: "gpt-4o-mini", systemPrompt: "Be terse" })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
      expect(res.headers.get("Connection")).toBe("keep-alive");
      const forwarded = await res.text();
      expect(forwarded).toContain('"content":"Hello "');

      // The pipeline was handed a rebuilt request, not the browser's history.
      const upstream = mocks.handleChat.mock.calls[0][0];
      expect(upstream.url).toBe("http://localhost/api/v1/chat/completions");
      const upstreamBody = JSON.parse(await upstream.text());
      expect(upstreamBody).toMatchObject({
        model: "gpt-4o-mini",
        stream: true,
        stream_options: { include_usage: true },
      });
      expect(upstreamBody.messages).toEqual([
        { role: "system", content: "Be terse" },
        { role: "user", content: "hi" },
      ]);

      expect(mocks.appendChatMessage).toHaveBeenCalledTimes(1);
      const saved = mocks.appendChatMessage.mock.calls[0][0];
      expect(saved).toMatchObject({
        sessionId: "s1",
        role: "assistant",
        content: { text: "Hello world", attachments: [] },
        reasoning: "think ",
        model: "gpt-4o-mini",
        provider: "openai",
        promptTokens: 10,
        completionTokens: 5,
        cost: 0.001,
        status: "success",
        error: null,
      });
      expect(typeof saved.ttftMs).toBe("number");
      expect(typeof saved.latencyMs).toBe("number");
    });

    it("caps accumulated text but forwards the upstream bytes untouched", async () => {
      mocks.listChatMessages.mockResolvedValue([
        { id: "u1", sessionId: "s1", role: "user", content: { text: "hi", attachments: [] } },
      ]);
      const big = "x".repeat(1_050_000);
      mocks.handleChat.mockResolvedValue(
        sseResponse([
          `data: ${JSON.stringify({ model: "openai/gpt-4o-mini", choices: [{ delta: { content: big } }] })}\n\n`,
          "data: [DONE]\n\n",
        ])
      );

      const res = await postCompletion(completionRequest({ sessionId: "s1", model: "gpt-4o-mini" }));
      const forwarded = await res.text();

      // The UI keeps receiving every byte the provider produced.
      expect(forwarded).toContain(big);

      const saved = mocks.appendChatMessage.mock.calls[0][0];
      expect(saved.content.text.length).toBe(1_000_000);
      expect(saved.status).toBe("truncated");
      expect(saved.error).toMatch(/truncated/i);
    });

    it("persists partial content when the client aborts mid-stream", async () => {
      mocks.listChatMessages.mockResolvedValue([
        { id: "u1", sessionId: "s1", role: "user", content: { text: "hi", attachments: [] } },
      ]);
      mocks.handleChat.mockResolvedValue(
        openSseResponse([
          'data: {"model":"openai/gpt-4o-mini","choices":[{"delta":{"content":"partial"}}]}\n\n',
        ])
      );

      const res = await postCompletion(completionRequest({ sessionId: "s1", model: "gpt-4o-mini" }));
      const reader = res.body.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      await reader.cancel();

      await vi.waitFor(() => expect(mocks.appendChatMessage).toHaveBeenCalledTimes(1));
      const saved = mocks.appendChatMessage.mock.calls[0][0];
      expect(saved).toMatchObject({
        content: { text: "partial", attachments: [] },
        status: "aborted",
      });
    });

    it("passes a non-2xx pipeline response straight through without persisting", async () => {
      mocks.handleChat.mockResolvedValue(
        new Response(JSON.stringify({ error: "bad model" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      );
      const res = await postCompletion(completionRequest({ sessionId: "s1", model: "m" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad model" });
      expect(mocks.appendChatMessage).not.toHaveBeenCalled();
    });
  });
});
