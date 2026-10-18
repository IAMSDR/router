import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getChatUploadsStats: vi.fn(),
  clearChatUploadsDir: vi.fn(),
  clearAllChatAttachments: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      });
    },
  },
}));

vi.mock("@/lib/chat/storage.js", () => ({
  getChatUploadsStats: mocks.getChatUploadsStats,
  clearChatUploadsDir: mocks.clearChatUploadsDir,
}));

vi.mock("@/lib/db", () => ({
  clearAllChatAttachments: mocks.clearAllChatAttachments,
}));

const { GET, DELETE } = await import("@/app/api/settings/chat-cache/route.js");

describe("/api/settings/chat-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET reports an empty cache without touching disk", async () => {
    mocks.getChatUploadsStats.mockReturnValue({ count: 0, bytes: 0 });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 0, bytes: 0 });
    expect(mocks.getChatUploadsStats).toHaveBeenCalledTimes(1);
  });

  it("GET returns on-disk file count and byte total", async () => {
    mocks.getChatUploadsStats.mockReturnValue({ count: 3, bytes: 2048 });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 3, bytes: 2048 });
  });

  it("DELETE clears both the files and the attachment rows", async () => {
    mocks.clearChatUploadsDir.mockReturnValue({ deletedFiles: 2, bytes: 1536 });
    mocks.clearAllChatAttachments.mockResolvedValue({ deleted: 2, relPaths: ["s1/a.png", "s1/b.png"] });

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedFiles: 2, bytes: 1536, deletedRows: 2 });
    expect(mocks.clearChatUploadsDir).toHaveBeenCalledTimes(1);
    expect(mocks.clearAllChatAttachments).toHaveBeenCalledTimes(1);
  });

  it("DELETE on an empty cache is a clean no-op", async () => {
    mocks.clearChatUploadsDir.mockReturnValue({ deletedFiles: 0, bytes: 0 });
    mocks.clearAllChatAttachments.mockResolvedValue({ deleted: 0, relPaths: [] });

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedFiles: 0, bytes: 0, deletedRows: 0 });
  });

  it("DELETE surfaces a failure from the row clear as a 500", async () => {
    mocks.clearChatUploadsDir.mockReturnValue({ deletedFiles: 0, bytes: 0 });
    mocks.clearAllChatAttachments.mockRejectedValue(new Error("db down"));

    const res = await DELETE();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
  });
});
