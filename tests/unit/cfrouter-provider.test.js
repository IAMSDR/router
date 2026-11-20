import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: getConnection,
  updateProviderConnection: vi.fn(),
  getProviderConnections: vi.fn(),
  getCombos: async () => [],
  getCustomModels: vi.fn(),
  getModelAliases: async () => ({}),
  getPricingForModel: async () => null,
  initModelCapabilities: async () => {},
  getSettings: async () => ({}),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/models", () => ({ getProviderConnectionById: getConnection, getProviderNodeById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));

import { getExecutor } from "../../open-sse/executors/index.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { parseModel } from "../../open-sse/services/model.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { APIKEY_PROVIDERS, USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { GET as getUsage } from "../../src/app/api/usage/[connectionId]/route.js";
import { GET as getModels } from "../../src/app/api/providers/[id]/models/route.js";
import { buildModelsList } from "../../src/app/api/v1/models/route.js";
import { getCustomModels, getProviderConnections } from "@/lib/localDb";
import { POST as validateProvider } from "../../src/app/api/providers/validate/route.js";
import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { getRemainingPercentage, parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const connection = { id: "c1", provider: "cfrouter", authType: "apikey", apiKey: "test-key" };
const usageUrl = "https://cfrouter.com/usage/api/all";
const modelsUrl = "https://api.cfrouter.com/v1/models";
const modelProbe = expect.objectContaining({
  headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
});
const emptyMetrics = {
  requests: 0, tokens_total: 0, tokens_in: 0, tokens_out: 0,
  tokens_cached: 0, cache_hit_pct: 0, cost: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  getConnection.mockResolvedValue(connection);
  getProviderConnections.mockResolvedValue([connection]);
  getCustomModels.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

describe("Cf Router", () => {
  it("registers an API-key provider and routes namespaced model IDs unchanged", () => {
    expect(APIKEY_PROVIDERS.cfrouter).toMatchObject({ name: "Cf Router", passthroughModels: true });
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("cfrouter");
    expect(USAGE_APIKEY_PROVIDERS).toContain("cfrouter");
    const { provider, model } = parseModel("cfrouter/vendor/model");
    expect({ provider, model }).toEqual({ provider: "cfrouter", model: "vendor/model" });
    const executor = getExecutor(provider);
    expect(executor.buildUrl(model, false, 0, connection)).toBe("https://api.cfrouter.com/v1/chat/completions");
    expect(executor.buildHeaders(connection, false)).toMatchObject({ Authorization: "Bearer test-key" });
    expect(executor.transformRequest(model, { model, messages: [] }, false, connection)).toMatchObject({ model });
  });

  it("discovers models server-side with the connection's Bearer key", async () => {
    const models = [{ id: "vendor/model", object: "model" }];
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [...models, { id: " " }, { name: "not-an-id" }] }));
    vi.stubGlobal("fetch", fetch);
    const response = await getModels(new Request("http://localhost/api/providers/c1/models"), {
      params: Promise.resolve({ id: connection.id }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provider: "cfrouter", models });
    expect(fetch).toHaveBeenCalledWith(modelsUrl, expect.objectContaining({
      method: "GET", headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
  });

  it("auto-fetches the authenticated catalog for the gateway without hardcoded models", async () => {
    expect(getProviderModels("cfrouter")).toEqual([]);
    getProviderConnections.mockResolvedValue([{
      ...connection, providerSpecificData: { baseUrl: "https://example.invalid/v1" },
    }]);
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{ id: "vendor/one" }, { id: "vendor/two" }] }));
    vi.stubGlobal("fetch", fetch);

    const models = await buildModelsList(["llm"]);
    expect(models.filter(({ owned_by }) => owned_by === "cfrouter").map(({ id }) => id))
      .toEqual(["cfrouter/vendor/one", "cfrouter/vendor/two"]);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(modelsUrl, expect.objectContaining({
      redirect: "error", headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
  });

  it("keeps imported models available if live discovery fails", async () => {
    getCustomModels.mockResolvedValue([{ providerAlias: "cfrouter", id: "vendor/saved" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const models = await buildModelsList(["llm"]);
    expect(models.filter(({ owned_by }) => owned_by === "cfrouter").map(({ id }) => id))
      .toEqual(["cfrouter/vendor/saved"]);
  });

  it("skips automatic discovery when the recursive fetch guard is set", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    expect(models.some(({ owned_by }) => owned_by === "cfrouter")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates a new key against the model endpoint without running inference", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    const response = await validateProvider(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({ provider: connection.provider, apiKey: connection.apiKey }),
    }));
    expect(await response.json()).toEqual({ valid: true, error: null });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(modelsUrl, modelProbe);
  });

  it("reports rejected keys from the saved connection test", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    expect(await testSingleConnection(connection.id)).toMatchObject({ valid: false, error: "Invalid API key" });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(modelsUrl, modelProbe);
  });

  it("returns an unused key's quota and zero metrics through the dashboard usage route", async () => {
    proxyAwareFetch.mockResolvedValue(Response.json({
      summary: {
        ...emptyMetrics,
        quota: { quota: 800000000, unlimited: false, used: 0, remaining: 800000000, pct: 0 },
      },
      me: { key_masked: "should-not-return" },
      recent: [{ prompt: "should-not-return" }],
    }));
    const response = await getUsage(new Request("http://localhost/api/usage/c1"), {
      params: Promise.resolve({ connectionId: connection.id }),
    });
    expect(response.status).toBe(200);
    const usage = await response.json();
    expect(usage).toEqual({
      plan: "Cf Router",
      quotas: {
        "Token quota": {
          used: 0, total: 800000000, remaining: 800000000, remainingPercentage: 100,
          unlimited: false, unit: "tokens", resetAt: null,
        },
      },
      metrics: emptyMetrics,
    });
    expect(proxyAwareFetch).toHaveBeenCalledWith(usageUrl, expect.objectContaining({
      method: "GET", redirect: "error", cache: "no-store",
      headers: { Accept: "application/json", "x-api-key": "test-key" },
    }), expect.any(Object));
  });

  it("preserves upstream usage totals separately from weighted quota consumption", async () => {
    const metrics = { requests: 4, tokens_total: 120, tokens_in: 90, tokens_out: 30, tokens_cached: 45, cache_hit_pct: 50, cost: 0.000012 };
    const proxyOptions = { connectionProxyEnabled: true };
    proxyAwareFetch.mockResolvedValue(Response.json({
      summary: { ...metrics, quota: { quota: 1000, unlimited: false, used: 250, remaining: 750, pct: 25 } },
    }));
    const usage = await getUsageForProvider(connection, proxyOptions);
    expect(proxyAwareFetch).toHaveBeenCalledWith(usageUrl, expect.any(Object), proxyOptions);
    expect(usage.metrics).toEqual(metrics);
    const [quota] = parseQuotaData("cfrouter", usage);
    expect(quota).toMatchObject({ used: 250, total: 1000, unit: "tokens", unlimited: false });
    expect(getRemainingPercentage(quota)).toBe(75);
  });

  it.each([
    [{ quota: null, unlimited: true, used: 500 }, { total: 0, used: 500, unlimited: true, remainingPercentage: 100 }],
    [{ quota: 0, unlimited: false, used: 0 }, { total: 0, used: 0, unlimited: false, remainingPercentage: 0 }],
    [{ quota: "1000", used: "250" }, { total: 1000, used: 250, unlimited: false, remainingPercentage: 75 }],
    [{ quota: 100, used: 150 }, { total: 100, used: 150, unlimited: false, remainingPercentage: 0 }],
  ])("normalizes quota %j", async (quota, expected) => {
    proxyAwareFetch.mockResolvedValue(Response.json({ summary: { quota } }));
    const usage = await getUsageForProvider(connection);
    expect(parseQuotaData("cfrouter", usage)).toEqual([expect.objectContaining(expected)]);
  });

  it("does not fetch usage without a key", async () => {
    const usage = await getUsageForProvider({ ...connection, apiKey: " " });
    expect(usage.message).toMatch(/API key not available/);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])("reports HTTP %s without reflecting the upstream body", async (status) => {
    proxyAwareFetch.mockResolvedValue(new Response(connection.apiKey, { status }));
    const usage = await getUsageForProvider(connection);
    expect(usage.message).toMatch(status === 503 ? /503/ : /authentication failed/);
    expect(usage.message).not.toContain(connection.apiKey);
  });

  it("handles malformed responses and connection failures", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response("<html>"));
    expect((await getUsageForProvider(connection)).message).toMatch(/no usage data/);
    proxyAwareFetch.mockRejectedValueOnce(new Error(connection.apiKey));
    expect(await getUsageForProvider(connection)).toEqual({
      message: "Could not reach the Cf Router usage API. Try refreshing.",
    });
  });
});
