import { describe, it, expect, vi } from "vitest";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { testRelayUrl } from "@/lib/network/proxyTest.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(async (id) => {
    if (id === "pool-custom-1") {
      return {
        id: "pool-custom-1",
        name: "My Custom Relay",
        proxyUrl: "https://relay.example.com",
        type: "custom",
        relayKey: "super-secret-key-123",
        isActive: true,
        strictProxy: true,
      };
    }
    return null;
  }),
  createProxyPool: vi.fn(async (data) => ({
    id: "pool-new-1",
    ...data,
  })),
  getProviderConnections: vi.fn(async () => []),
  getProxyPools: vi.fn(async () => []),
}));

describe("Custom Relay Unit Tests", () => {
  it("resolveConnectionProxyConfig resolves custom relay with relayKey and vercelRelayUrl", async () => {
    const config = await resolveConnectionProxyConfig({ proxyPoolId: "pool-custom-1" });
    expect(config.source).toBe("custom");
    expect(config.vercelRelayUrl).toBe("https://relay.example.com");
    expect(config.relayKey).toBe("super-secret-key-123");
    expect(config.strictProxy).toBe(true);
    expect(config.connectionProxyEnabled).toBe(false);
  });

  it("testRelayUrl fails with 400 when relayUrl is missing", async () => {
    const res = await testRelayUrl({ relayUrl: "" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/Relay URL is required/);
  });

  it("testRelayUrl sends correct headers including x-relay-target and x-relay-key", async () => {
    let capturedHeaders = null;

    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      if (req.headers["x-relay-key"] !== "test-key-456") {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Unauthorized" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const relayUrl = `http://127.0.0.1:${port}`;

    try {
      const successRes = await testRelayUrl({
        relayUrl,
        relayKey: "test-key-456",
        timeoutMs: 3000,
      });

      expect(successRes.ok).toBe(true);
      expect(successRes.status).toBe(200);
      expect(capturedHeaders["x-relay-target"]).toBe("https://httpbin.org");
      expect(capturedHeaders["x-relay-path"]).toBe("/get");
      expect(capturedHeaders["x-relay-key"]).toBe("test-key-456");

      // Test with wrong key
      const failRes = await testRelayUrl({
        relayUrl,
        relayKey: "wrong-key",
        timeoutMs: 3000,
      });

      expect(failRes.ok).toBe(false);
      expect(failRes.status).toBe(401);
      expect(failRes.error).toMatch(/Unauthorized/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("proxyAwareFetch forwards x-relay-key when relayKey is provided in proxyOptions", async () => {
    let capturedHeaders = null;

    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "test-model" }));
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const relayUrl = `http://127.0.0.1:${port}`;

    try {
      const res = await proxyAwareFetch(
        "https://api.openai.com/v1/chat/completions?test=1",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer sk-test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: "hi" }),
        },
        {
          vercelRelayUrl: relayUrl,
          relayKey: "secret-relay-pass",
        }
      );

      expect(res.status).toBe(200);
      expect(capturedHeaders["x-relay-target"]).toBe("https://api.openai.com");
      expect(capturedHeaders["x-relay-path"]).toBe("/v1/chat/completions?test=1");
      expect(capturedHeaders["x-relay-key"]).toBe("secret-relay-pass");
      expect(capturedHeaders["authorization"]).toBe("Bearer sk-test");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("POST /api/proxy-pools rejects custom relay when relayKey is missing", async () => {
    const { POST } = await import("@/app/api/proxy-pools/route.js");
    const req = new Request("http://localhost/api/proxy-pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Custom Relay",
        proxyUrl: "https://relay.example.com",
        type: "custom",
        relayKey: "",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Relay key is required/);
  });

  it("POST /api/proxy-pools creates custom relay when relayKey is provided", async () => {
    const { POST } = await import("@/app/api/proxy-pools/route.js");
    const req = new Request("http://localhost/api/proxy-pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Custom Relay",
        proxyUrl: "https://relay.example.com",
        type: "custom",
        relayKey: "my-relay-key",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.proxyPool.type).toBe("custom");
    expect(data.proxyPool.relayKey).toBe("my-relay-key");
  });

  it("POST /api/proxy-pools/test probes relay URL without creating a pool", async () => {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      if (req.headers["x-relay-key"] === "valid-test-key") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
      }
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const probeUrl = `http://127.0.0.1:${port}`;

    try {
      const { POST: testPost } = await import("@/app/api/proxy-pools/test/route.js");
      const req = new Request("http://localhost/api/proxy-pools/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxyUrl: probeUrl,
          relayKey: "valid-test-key",
          type: "custom",
        }),
      });

      const res = await testPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
