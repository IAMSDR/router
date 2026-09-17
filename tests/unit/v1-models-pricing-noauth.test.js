import { describe, expect, it, vi } from "vitest";

describe("/v1/models pricing and noAuth provider inclusion", () => {
  it("formats pricing with both per-token strings and $/1M numbers", async () => {
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
    const list = await buildModelsList(["llm"]);

    // Find any model that has pricing
    const modelWithPrice = list.find((m) => m.pricing);
    expect(modelWithPrice).toBeDefined();
    expect(modelWithPrice.pricing).toHaveProperty("prompt");
    expect(modelWithPrice.pricing).toHaveProperty("completion");
    expect(modelWithPrice.pricing).toHaveProperty("input");
    expect(modelWithPrice.pricing).toHaveProperty("output");

    // Check OpenCode free model is present
    const opencodeModel = list.find((m) => m.id.startsWith("oc/"));
    expect(opencodeModel).toBeDefined();

    // Check user capability override is applied to tt/deepseek-v4-flash-free
    const ttModel = list.find((m) => m.id === "tt/deepseek-v4-flash-free");
    expect(ttModel).toBeDefined();
    expect(ttModel.capabilities.vision).toBe(true);
  });
});
