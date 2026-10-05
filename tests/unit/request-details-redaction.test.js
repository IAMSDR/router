import { describe, it, expect } from "vitest";
import { canSeePayloads } from "@/app/api/usage/request-details/route.js";

// Mirror the redaction logic from src/app/api/usage/request-details/route.js
// so we can test it in isolation.
function redactDetails(details) {
  return (details || []).map((d) => {
    const redacted = { ...d };
    for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
      if (redacted[key] !== undefined) {
        redacted[key] = { redacted: true };
      }
    }
    return redacted;
  });
}

describe("request-details redaction", () => {
  it("removes conversation payloads but keeps metadata", () => {
    const details = [{
      id: "abc",
      provider: "opencode",
      model: "deepseek-v4-flash-free",
      timestamp: "2026-08-05T00:00:00Z",
      status: "success",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      request: { messages: [{ role: "user", content: "secret prompt" }] },
      providerRequest: { messages: [{ role: "user", content: "secret prompt" }] },
      providerResponse: { choices: [{ message: { content: "secret answer" } }] },
      response: { content: "secret answer" },
    }];
    const out = redactDetails(details)[0];
    expect(out.id).toBe("abc");
    expect(out.provider).toBe("opencode");
    expect(out.model).toBe("deepseek-v4-flash-free");
    expect(out.tokens).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(out.request).toEqual({ redacted: true });
    expect(out.providerRequest).toEqual({ redacted: true });
    expect(out.providerResponse).toEqual({ redacted: true });
    expect(out.response).toEqual({ redacted: true });
  });

  it("handles empty details", () => {
    expect(redactDetails([])).toEqual([]);
    expect(redactDetails(null)).toEqual([]);
  });

  it("keeps non-sensitive fields untouched", () => {
    const details = [{ id: "x", status: "error", latency: { total: 100 } }];
    const out = redactDetails(details)[0];
    expect(out.id).toBe("x");
    expect(out.status).toBe("error");
    expect(out.latency).toEqual({ total: 100 });
  });
});

describe("request-details payload gate (option B)", () => {
  it("allows full payloads for authenticated owner when login required", () => {
    expect(canSeePayloads({ requireLogin: true, authenticated: true })).toBe(true);
    expect(canSeePayloads({ requireLogin: undefined, authenticated: true })).toBe(true);
  });

  it("redacts when login disabled, even with a token", () => {
    expect(canSeePayloads({ requireLogin: false, authenticated: true })).toBe(false);
    expect(canSeePayloads({ requireLogin: false, authenticated: false })).toBe(false);
  });

  it("redacts unauthenticated callers when login required", () => {
    expect(canSeePayloads({ requireLogin: true, authenticated: false })).toBe(false);
  });
});
