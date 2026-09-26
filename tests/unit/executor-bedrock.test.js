import { describe, it, expect } from "vitest";
import { BedrockExecutor, openAIToBedrockConverse } from "open-sse/executors/bedrock.js";
import { PROVIDERS, PROVIDER_MODELS } from "open-sse/providers/index.js";
import { getExecutor, hasSpecializedExecutor } from "open-sse/executors/index.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";
import {
  BEDROCK_DEFAULT_REGION,
  BEDROCK_REGIONS,
  normalizeBedrockRegion,
  resolveBedrockRegion,
  extractBedrockRegionFromBaseUrl,
  buildBedrockRuntimeBaseUrl,
  buildBedrockNativeConverseUrl,
  resolveModelID,
  getBedrockKnownModelLimits,
} from "open-sse/config/bedrock.js";
import { probeBedrockRuntime, BedrockNativeApiError } from "open-sse/services/bedrock.js";

function credentials(region = "eu-west-2") {
  return {
    apiKey: "bedrock-key",
    providerSpecificData: { region },
  };
}

describe("BedrockExecutor", () => {
  it("is registered in executors and has specialized executor", () => {
    expect(hasSpecializedExecutor("bedrock")).toBe(true);
    const executor = getExecutor("bedrock");
    expect(executor).toBeInstanceOf(BedrockExecutor);
  });

  it("registers in PROVIDERS and PROVIDER_MODELS", () => {
    expect(PROVIDERS.bedrock).toBeTruthy();
    expect(PROVIDERS.bedrock.format).toBe("openai");
    expect(PROVIDER_MODELS.bedrock?.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.bedrock.some((m) => m.id === "anthropic.claude-sonnet-4-6")).toBe(true);
    expect(resolveProviderAlias("aws-bedrock")).toBe("bedrock");
    expect(resolveProviderAlias("amazon-bedrock")).toBe("bedrock");
  });

  it("builds regional native Converse URLs with resolved cross-region model IDs", () => {
    const executor = new BedrockExecutor();

    // EU region: claude model gets eu. prefix
    expect(
      executor.buildUrl("anthropic.claude-sonnet-4-6", false, 0, credentials("eu-west-2"))
    ).toBe(
      "https://bedrock-runtime.eu-west-2.amazonaws.com/model/eu.anthropic.claude-sonnet-4-6/converse"
    );
    expect(
      executor.buildUrl("anthropic.claude-sonnet-4-6", true, 0, credentials("eu-west-2"))
    ).toBe(
      "https://bedrock-runtime.eu-west-2.amazonaws.com/model/eu.anthropic.claude-sonnet-4-6/converse-stream"
    );

    // US region: claude model gets us. prefix
    expect(
      executor.buildUrl("anthropic.claude-3-7-sonnet-20250219-v1:0", false, 0, credentials("us-east-1"))
    ).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-3-7-sonnet-20250219-v1%3A0/converse"
    );

    // Zero config (no region in credentials): defaults to us-east-1 and us. prefix
    expect(
      executor.buildUrl("anthropic.claude-sonnet-4-6", false, 0, { apiKey: "test-key" })
    ).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-sonnet-4-6/converse"
    );
  });

  it("maps OpenAI chat messages and tools to Bedrock Converse", () => {
    const payload = openAIToBedrockConverse("anthropic.claude-sonnet-4-6", {
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "What is the weather?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_weather",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Berlin"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_weather", content: "12C" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
      tool_choice: "auto",
      max_tokens: 64,
      temperature: 0.2,
    });

    expect(payload.modelId).toBe("anthropic.claude-sonnet-4-6");
    expect(payload.system).toEqual([{ text: "You are concise." }]);
    expect(payload.messages[0].role).toBe("user");
    expect(payload.messages[0].content).toEqual([{ text: "What is the weather?" }]);
    expect(payload.messages[1].content[0].toolUse.name).toBe("get_weather");
    expect(payload.messages[1].content[0].toolUse.input).toEqual({ city: "Berlin" });
    expect(payload.messages[2].content[0].toolResult.toolUseId).toBe("call_weather");
    expect(payload.toolConfig.tools[0].toolSpec.name).toBe("get_weather");
    expect(payload.toolConfig.toolChoice).toEqual({ auto: {} });
    expect(payload.inferenceConfig).toEqual({ maxTokens: 64, temperature: 0.2 });
  });

  it("avoids duplicate Bedrock toolUse ids from mixed tool formats", () => {
    const payload = openAIToBedrockConverse("anthropic.claude-sonnet-4-6", {
      messages: [
        { role: "user", content: "use a tool" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_dup", name: "lookup", input: { source: "content" } },
          ],
          tool_calls: [
            {
              id: "call_dup",
              type: "function",
              function: { name: "lookup", arguments: '{"source":"tool_calls"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_dup", content: "done" },
      ],
    });

    const toolUseBlocks = payload.messages[1].content.filter((block) => block.toolUse);
    expect(toolUseBlocks.length).toBe(1);
    expect(toolUseBlocks[0].toolUse.toolUseId).toBe("call_dup");
    expect(toolUseBlocks[0].toolUse.input).toEqual({ source: "tool_calls" });
    expect(payload.messages[2].content[0].toolResult.toolUseId).toBe("call_dup");
  });

  it("preserves additionalModelRequestFields", () => {
    const payload = openAIToBedrockConverse("anthropic.claude-3-7-sonnet-20250219-v1:0", {
      messages: [{ role: "user", content: "Hello" }],
      additionalModelRequestFields: {
        thinking: { type: "enabled", budget_tokens: 2048 },
      },
    });

    expect(payload.additionalModelRequestFields).toEqual({
      thinking: { type: "enabled", budget_tokens: 2048 },
    });
  });

  it("drops duplicate pending tool call ids", () => {
    const payload = openAIToBedrockConverse("anthropic.claude-sonnet-4-6", {
      messages: [
        { role: "user", content: "use tools" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_dup",
              type: "function",
              function: { name: "first", arguments: "{}" },
            },
            {
              id: "call_dup",
              type: "function",
              function: { name: "second", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_dup", content: "first result" },
      ],
    });

    const toolUseIds = payload.messages[1].content.map((block) => block.toolUse?.toolUseId);
    expect(toolUseIds).toEqual(["call_dup"]);
    expect(payload.messages[2].content[0].toolResult.toolUseId).toBe("call_dup");
  });

  it("allows a tool id to be reused after its result", () => {
    const payload = openAIToBedrockConverse("anthropic.claude-sonnet-4-6", {
      messages: [
        { role: "user", content: "first" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_reuse",
              type: "function",
              function: { name: "first", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_reuse", content: "first result" },
        { role: "user", content: "again" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_reuse",
              type: "function",
              function: { name: "second", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_reuse", content: "second result" },
      ],
    });

    expect(payload.messages[1].content[0].toolUse.toolUseId).toBe("call_reuse");
    expect(payload.messages[2].content[0].toolResult.toolUseId).toBe("call_reuse");
    expect(payload.messages[4].content[0].toolUse.toolUseId).toBe("call_reuse");
    expect(payload.messages[5].content[0].toolResult.toolUseId).toBe("call_reuse");
  });

  it("skips assistant tool calls that have no result in history", () => {
    const payload = openAIToBedrockConverse("anthropic.claude-sonnet-4-6", {
      messages: [
        { role: "user", content: "spawn subagents" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_done",
              type: "function",
              function: { name: "done", arguments: "{}" },
            },
            {
              id: "call_missing",
              type: "function",
              function: { name: "missing", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_done", content: "ok" },
        { role: "user", content: "continue" },
      ],
    });

    const toolUseIds = payload.messages[1].content.map((block) => block.toolUse?.toolUseId);
    expect(toolUseIds).toEqual(["call_done"]);
    expect(payload.messages[2].content[0].toolResult.toolUseId).toBe("call_done");
    expect(payload.messages[3].role).toBe("user");
  });

  it("merges consecutive tool results after multi-tool calls", () => {
    const payload = openAIToBedrockConverse("anthropic.claude-sonnet-4-6", {
      messages: [
        { role: "user", content: "use tools" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_a",
              type: "function",
              function: { name: "a", arguments: "{}" },
            },
            {
              id: "call_b",
              type: "function",
              function: { name: "b", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_a", content: "a result" },
        { role: "tool", tool_call_id: "call_b", content: "b result" },
      ],
    });

    const toolUseIds = payload.messages[1].content.map((block) => block.toolUse?.toolUseId);
    const toolResultIds = payload.messages[2].content.map((block) => block.toolResult?.toolUseId);
    expect(toolUseIds).toEqual(["call_a", "call_b"]);
    expect(toolResultIds).toEqual(["call_a", "call_b"]);
    expect(payload.messages.length).toBe(3);
  });

  it("removes tool uses whose results are not immediately next", () => {
    const payload = openAIToBedrockConverse("anthropic.claude-sonnet-4-6", {
      messages: [
        { role: "user", content: "use a tool" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_late",
              type: "function",
              function: { name: "late", arguments: "{}" },
            },
          ],
        },
        { role: "user", content: "interruption" },
        { role: "tool", tool_call_id: "call_late", content: "late result" },
      ],
    });

    expect(payload.messages[1].content).toEqual([{ text: " " }]);
    expect(payload.messages[3].content).toEqual([{ text: " " }]);
  });

  it("converts non-streaming Converse output to OpenAI chat completion JSON", async () => {
    const sent = [];
    const executor = new BedrockExecutor(() => ({
      send: async (command) => {
        sent.push(command);
        return {
          output: { message: { content: [{ text: "Hello from Bedrock" }] } },
          stopReason: "end_turn",
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        };
      },
    }));

    const result = await executor.execute({
      model: "anthropic.claude-sonnet-4-6",
      body: { messages: [{ role: "user", content: "Hi" }], max_tokens: 16 },
      stream: false,
      credentials: credentials(),
    });

    expect(sent[0].constructor.name).toBe("ConverseCommand");
    expect(sent[0].input.modelId).toBe("eu.anthropic.claude-sonnet-4-6");
    expect(result.response.status).toBe(200);
    const data = await result.response.json();
    expect(data.model).toBe("anthropic.claude-sonnet-4-6");
    expect(data.choices[0].message.content).toBe("Hello from Bedrock");
    expect(data.usage.total_tokens).toBe(8);
  });

  it("configures the AWS SDK to use Bedrock bearer API keys", async () => {
    const created = new BedrockExecutor().createClient(credentials("eu-west-2"));

    expect(typeof created.config.authSchemePreference).toBe("function");
    expect(await created.config.authSchemePreference()).toEqual(["httpBearerAuth"]);
  });

  it("converts ConverseStream output to OpenAI SSE chunks", async () => {
    async function* bedrockStream() {
      yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Hel" } } };
      yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "lo" } } };
      yield { messageStop: { stopReason: "end_turn" } };
      yield { metadata: { usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 } } };
    }

    const executor = new BedrockExecutor(() => ({
      send: async (command) => {
        expect(command.constructor.name).toBe("ConverseStreamCommand");
        return { stream: bedrockStream() };
      },
    }));

    const result = await executor.execute({
      model: "anthropic.claude-sonnet-4-6",
      body: { messages: [{ role: "user", content: "Hi" }], stream: true },
      stream: true,
      credentials: credentials(),
    });

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await result.response.text();
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain('"content":"Hel"');
    expect(text).toContain('"content":"lo"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain("data: [DONE]");
  });

  it("executes with zero config (just apiKey) and resolves us-east-1 model ID", async () => {
    const sent = [];
    const executor = new BedrockExecutor(() => ({
      send: async (command) => {
        sent.push(command);
        return {
          output: { message: { content: [{ text: "Zero config response" }] } },
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      },
    }));

    const result = await executor.execute({
      model: "anthropic.claude-3-7-sonnet-20250219-v1:0",
      body: { messages: [{ role: "user", content: "Hi" }] },
      stream: false,
      credentials: { apiKey: "simple-api-key-no-config" },
    });

    expect(sent[0].constructor.name).toBe("ConverseCommand");
    expect(sent[0].input.modelId).toBe("us.anthropic.claude-3-7-sonnet-20250219-v1:0");
    expect(result.response.status).toBe(200);
    const data = await result.response.json();
    expect(data.model).toBe("anthropic.claude-3-7-sonnet-20250219-v1:0");
    expect(data.choices[0].message.content).toBe("Zero config response");
  });

  it("maps Claude thinking configuration to additionalModelRequestFields", () => {
    const enabled = openAIToBedrockConverse("anthropic.claude-3-7-sonnet-20250219-v1:0", {
      messages: [{ role: "user", content: "Solve math problem" }],
      thinking: { type: "enabled", budget_tokens: 4096 },
    });
    expect(enabled.additionalModelRequestFields).toEqual({
      thinking: { type: "enabled", budget_tokens: 4096 },
    });

    const adaptive = openAIToBedrockConverse("anthropic.claude-3-7-sonnet-20250219-v1:0", {
      messages: [{ role: "user", content: "Think adaptively" }],
      thinking: { type: "adaptive" },
    });
    expect(adaptive.additionalModelRequestFields).toEqual({
      thinking: { type: "adaptive" },
    });
  });

  it("supports custom VPC endpoint or baseURL in options", () => {
    const executor = new BedrockExecutor();
    const customCreds = {
      apiKey: "test-key",
      providerSpecificData: {
        baseUrl: "https://bedrock-runtime.us-east-1.vpce-xxxxx.amazonaws.com",
      },
    };

    expect(executor.buildUrl("anthropic.claude-sonnet-4-6", false, 0, customCreds)).toBe(
      "https://bedrock-runtime.us-east-1.vpce-xxxxx.amazonaws.com/model/us.anthropic.claude-sonnet-4-6/converse"
    );
    expect(resolveBedrockRegion(customCreds.providerSpecificData)).toBe("us-east-1");
  });

  it("returns 401 when API key is missing", async () => {
    const executor = new BedrockExecutor();
    const result = await executor.execute({
      model: "anthropic.claude-sonnet-4-6",
      body: { messages: [{ role: "user", content: "Hi" }] },
      stream: false,
      credentials: { apiKey: "" },
    });

    expect(result.response.status).toBe(401);
    const json = await result.response.json();
    expect(json.error.type).toBe("auth_error");
    expect(json.error.message).toContain("Missing Bedrock API key");
  });
});

describe("Bedrock Config & Services", () => {
  it("normalizes and resolves regions correctly", () => {
    expect(BEDROCK_DEFAULT_REGION).toBe("us-east-1");
    expect(BEDROCK_REGIONS.length).toBeGreaterThan(5);
    expect(normalizeBedrockRegion("EU-WEST-1")).toBe("eu-west-1");
    expect(normalizeBedrockRegion("invalid")).toBe("us-east-1");
    expect(extractBedrockRegionFromBaseUrl("https://bedrock-runtime.ap-northeast-1.amazonaws.com")).toBe("ap-northeast-1");
    expect(resolveBedrockRegion({ region: "eu-central-1" })).toBe("eu-central-1");
    expect(resolveBedrockRegion({ baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com" })).toBe("us-west-2");
    expect(resolveBedrockRegion({})).toBe("us-east-1");
  });

  it("builds runtime URLs with resolveModelID", () => {
    expect(buildBedrockRuntimeBaseUrl("us-east-1")).toBe("https://bedrock-runtime.us-east-1.amazonaws.com");
    expect(buildBedrockNativeConverseUrl("us-east-1", "anthropic.claude-sonnet-4-6")).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-sonnet-4-6/converse"
    );
    expect(buildBedrockNativeConverseUrl("eu-west-1", "amazon.nova-lite-v1:0", true)).toBe(
      "https://bedrock-runtime.eu-west-1.amazonaws.com/model/eu.amazon.nova-lite-v1%3A0/converse-stream"
    );
  });

  it("applies OpenCode's cross-region prefix resolution matrix", () => {
    // Already prefixed or ARN: unmodified
    expect(resolveModelID("arn:aws:bedrock:us-east-1::foundation-model/deepseek.v3.2", "us-east-1")).toBe(
      "arn:aws:bedrock:us-east-1::foundation-model/deepseek.v3.2"
    );
    expect(resolveModelID("global.anthropic.claude-opus-4-7", "us-east-1")).toBe(
      "global.anthropic.claude-opus-4-7"
    );
    expect(resolveModelID("us.anthropic.claude-sonnet-4-6", "us-east-1")).toBe(
      "us.anthropic.claude-sonnet-4-6"
    );
    expect(resolveModelID("eu.anthropic.claude-sonnet-4-6", "eu-west-1")).toBe(
      "eu.anthropic.claude-sonnet-4-6"
    );

    // US region: prefix with us.
    expect(resolveModelID("anthropic.claude-sonnet-4-6", "us-east-1")).toBe("us.anthropic.claude-sonnet-4-6");
    expect(resolveModelID("anthropic.claude-3-7-sonnet-20250219-v1:0", "us-east-1")).toBe(
      "us.anthropic.claude-3-7-sonnet-20250219-v1:0"
    );
    expect(resolveModelID("amazon.nova-pro-v1:0", "us-east-1")).toBe("us.amazon.nova-pro-v1:0");
    expect(resolveModelID("amazon.nova-lite-v1:0", "us-east-1")).toBe("us.amazon.nova-lite-v1:0");
    expect(resolveModelID("amazon.nova-micro-v1:0", "us-east-1")).toBe("us.amazon.nova-micro-v1:0");
    expect(resolveModelID("deepseek.r1-v1:0", "us-east-1")).toBe("us.deepseek.r1-v1:0");
    // Non-prefixed model in US
    expect(resolveModelID("cohere.command-r-plus-v1:0", "us-east-1")).toBe("cohere.command-r-plus-v1:0");
    expect(resolveModelID("deepseek.v3.2", "us-east-1")).toBe("deepseek.v3.2");

    // US GovCloud: do not prefix
    expect(resolveModelID("anthropic.claude-sonnet-4-5", "us-gov-west-1")).toBe("anthropic.claude-sonnet-4-5");

    // EU region: prefix with eu.
    expect(resolveModelID("anthropic.claude-sonnet-4-5", "eu-west-1")).toBe("eu.anthropic.claude-sonnet-4-5");
    expect(resolveModelID("amazon.nova-lite-v1:0", "eu-west-2")).toBe("eu.amazon.nova-lite-v1:0");
    expect(resolveModelID("meta.llama3-70b-instruct-v1:0", "eu-north-1")).toBe("eu.meta.llama3-70b-instruct-v1:0");

    // AP regions:
    // Australia: au.
    expect(resolveModelID("anthropic.claude-sonnet-4-5", "ap-southeast-2")).toBe("au.anthropic.claude-sonnet-4-5");
    expect(resolveModelID("anthropic.claude-haiku-v1:0", "ap-southeast-4")).toBe("au.anthropic.claude-haiku-v1:0");
    // Tokyo: jp.
    expect(resolveModelID("anthropic.claude-sonnet-4-5", "ap-northeast-1")).toBe("jp.anthropic.claude-sonnet-4-5");
    expect(resolveModelID("amazon.nova-pro-v1:0", "ap-northeast-1")).toBe("jp.amazon.nova-pro-v1:0");
    // Other APAC: apac.
    expect(resolveModelID("anthropic.claude-sonnet-4-5", "ap-south-1")).toBe("apac.anthropic.claude-sonnet-4-5");
    expect(resolveModelID("amazon.nova-lite-v1:0", "ap-south-1")).toBe("apac.amazon.nova-lite-v1:0");
  });

  it("resolves context limits for vendor-prefixed models", () => {
    const sonnetLimits = getBedrockKnownModelLimits("anthropic.claude-sonnet-4-6");
    expect(sonnetLimits?.inputTokenLimit).toBe(1000000);
    expect(sonnetLimits?.outputTokenLimit).toBe(128000);

    const crossRegionLimits = getBedrockKnownModelLimits("us.anthropic.claude-sonnet-4-6");
    expect(crossRegionLimits?.inputTokenLimit).toBe(1000000);
  });

  it("filters OpenCode models.dev catalog for amazon-bedrock", () => {
    const rawCatalog = {
      "amazon-bedrock": {
        models: {
          "anthropic.claude-3-7-sonnet-20250219-v1:0": {
            id: "anthropic.claude-3-7-sonnet-20250219-v1:0",
            name: "Claude 3.7 Sonnet",
            limit: { context: 200000 },
          },
          "us.amazon.nova-pro-v1:0": {
            id: "us.amazon.nova-pro-v1:0",
            name: "Nova Pro (US)",
            limit: { context: 300000 },
          },
        },
      },
    };

    const filter = FILTERS["amazon-bedrock"];
    expect(filter).toBeDefined();
    const result = filter(rawCatalog);
    expect(result.length).toBe(2);
    expect(result.find((m) => m.id === "us.amazon.nova-pro-v1:0")).toEqual({
      id: "us.amazon.nova-pro-v1:0",
      name: "Nova Pro (US)",
      contextLength: 300000,
    });
  });

  it("probes bedrock runtime for key validation", async () => {
    // Valid key returns 400 (model __probe__ not found) -> succeeds
    const mockSuccess = async () => new Response("{}", { status: 400 });
    const successRes = await probeBedrockRuntime({
      apiKey: "valid-key",
      fetcher: mockSuccess,
    });
    expect(successRes.ok).toBe(true);

    // Invalid key returns 403 AccessDeniedException -> throws BedrockNativeApiError
    const mockAuthFail = async () => new Response("{}", { status: 403 });
    await expect(
      probeBedrockRuntime({
        apiKey: "bad-key",
        fetcher: mockAuthFail,
      })
    ).rejects.toBeInstanceOf(BedrockNativeApiError);
  });
});
