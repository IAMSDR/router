import { describe, expect, it, beforeEach } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { setUserCapabilityOverrides } from "../../open-sse/providers/modelOverrides.js";

describe("user capability overrides", () => {
  beforeEach(() => {
    setUserCapabilityOverrides({});
  });

  it("returns default / pattern capabilities when no override exists", () => {
    const caps = getCapabilitiesForModel("tt", "unoverridden-deepseek-model");
    expect(caps.vision).toBe(false);
  });

  it("applies user override when specified by provider/model", () => {
    setUserCapabilityOverrides({
      "tt/deepseek-v4-flash-free": {
        vision: true,
        tools: true,
        reasoning: true,
        contextWindow: 1000000,
        maxOutput: 65536,
      },
    });

    const caps = getCapabilitiesForModel("tt", "deepseek-v4-flash-free");
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(65536);
  });

  it("applies user override when specified by model id alone", () => {
    setUserCapabilityOverrides({
      "custom-unknown-model": {
        vision: true,
        pdf: true,
        audioInput: true,
        contextWindow: 500000,
      },
    });

    const caps = getCapabilitiesForModel("any-provider", "custom-unknown-model");
    expect(caps.vision).toBe(true);
    expect(caps.pdf).toBe(true);
    expect(caps.audioInput).toBe(true);
    expect(caps.contextWindow).toBe(500000);
  });

  it("can turn off capabilities on built-in models", () => {
    // By default gpt-4o has vision: true
    expect(getCapabilitiesForModel("openai", "gpt-4o").vision).toBe(true);

    // Override to false
    setUserCapabilityOverrides({
      "gpt-4o": {
        vision: false,
        tools: false,
      },
    });

    const overridden = getCapabilitiesForModel("openai", "gpt-4o");
    expect(overridden.vision).toBe(false);
    expect(overridden.tools).toBe(false);
  });
});
