import { MODEL_CAPABILITIES, DEFAULT_CAPABILITIES, getCapabilitiesForModel } from "../providers/capabilities.js";

export const BEDROCK_DEFAULT_REGION = "us-east-1";

export const BEDROCK_REGIONS = [
  { id: "us-east-1", label: "US East (N. Virginia) — us-east-1" },
  { id: "us-east-2", label: "US East (Ohio) — us-east-2" },
  { id: "us-west-2", label: "US West (Oregon) — us-west-2" },
  { id: "eu-central-1", label: "Europe (Frankfurt) — eu-central-1" },
  { id: "eu-west-1", label: "Europe (Ireland) — eu-west-1" },
  { id: "eu-west-2", label: "Europe (London) — eu-west-2" },
  { id: "eu-west-3", label: "Europe (Paris) — eu-west-3" },
  { id: "ap-northeast-1", label: "Asia Pacific (Tokyo) — ap-northeast-1" },
  { id: "ap-southeast-1", label: "Asia Pacific (Singapore) — ap-southeast-1" },
  { id: "ap-southeast-2", label: "Asia Pacific (Sydney) — ap-southeast-2" },
  { id: "ca-central-1", label: "Canada (Central) — ca-central-1" },
  { id: "sa-east-1", label: "South America (São Paulo) — sa-east-1" },
];

const BEDROCK_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/i;

export function normalizeBedrockRegion(value, fallback = BEDROCK_DEFAULT_REGION) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  return BEDROCK_REGION_PATTERN.test(trimmed) ? trimmed : fallback;
}

export function extractBedrockRegionFromBaseUrl(value) {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname;
    const match = hostname.match(/^bedrock(?:-runtime|-mantle)?\.([a-z0-9-]+)\./i);
    return match?.[1] ? normalizeBedrockRegion(match[1], "") || null : null;
  } catch {
    return null;
  }
}

export function resolveBedrockRegion(providerSpecificData) {
  const data =
    providerSpecificData && typeof providerSpecificData === "object"
      ? providerSpecificData
      : {};
  const explicit = normalizeBedrockRegion(data.region, "");
  if (explicit) return explicit;

  const baseUrl =
    typeof data.baseUrl === "string"
      ? data.baseUrl
      : typeof data.endpoint === "string"
      ? data.endpoint
      : null;
  const fromUrl = extractBedrockRegionFromBaseUrl(baseUrl);
  if (fromUrl) return fromUrl;

  const envRegion = typeof process !== "undefined" ? process.env?.AWS_REGION : null;
  return normalizeBedrockRegion(envRegion, BEDROCK_DEFAULT_REGION);
}

// Bedrock cross-region inference profiles require regional prefixes for specific
// model/region combinations. Follows OpenCode's resolveModelID logic to avoid
// double-prefixing model IDs that already carry global/us/eu/jp/apac/au prefixes or ARNs.
export function resolveModelID(modelID, region = BEDROCK_DEFAULT_REGION) {
  if (typeof modelID !== "string") return modelID;
  const trimmed = modelID.trim();
  if (!trimmed || trimmed.startsWith("arn:")) return trimmed;

  const crossRegionPrefixes = ["global.", "us.", "eu.", "jp.", "apac.", "au."];
  if (crossRegionPrefixes.some((prefix) => trimmed.startsWith(prefix))) return trimmed;

  const resolvedRegion = region ? normalizeBedrockRegion(region) : BEDROCK_DEFAULT_REGION;
  const regionPrefix = resolvedRegion.split("-")[0];
  if (regionPrefix === "us") {
    const requiresPrefix = [
      "nova-micro",
      "nova-lite",
      "nova-pro",
      "nova-premier",
      "nova-2",
      "claude",
      "deepseek.r1",
    ].some((item) => trimmed.includes(item));
    if (requiresPrefix && !resolvedRegion.startsWith("us-gov")) return `${regionPrefix}.${trimmed}`;
    return trimmed;
  }
  if (regionPrefix === "eu") {
    const regionRequiresPrefix = [
      "eu-west-1",
      "eu-west-2",
      "eu-west-3",
      "eu-north-1",
      "eu-central-1",
      "eu-south-1",
      "eu-south-2",
    ].some((item) => resolvedRegion.includes(item));
    const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"].some((item) =>
      trimmed.includes(item)
    );
    return regionRequiresPrefix && modelRequiresPrefix ? `${regionPrefix}.${trimmed}` : trimmed;
  }
  if (regionPrefix !== "ap") return trimmed;

  const australia = ["ap-southeast-2", "ap-southeast-4"].includes(resolvedRegion);
  if (australia && ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some((item) => trimmed.includes(item))) {
    return `au.${trimmed}`;
  }

  const prefix = resolvedRegion === "ap-northeast-1" ? "jp" : "apac";
  return ["claude", "nova-lite", "nova-micro", "nova-pro"].some((item) => trimmed.includes(item))
    ? `${prefix}.${trimmed}`
    : trimmed;
}

export function buildBedrockRuntimeBaseUrl(region) {
  return `https://bedrock-runtime.${normalizeBedrockRegion(region)}.amazonaws.com`;
}

export function buildBedrockNativeConverseUrl(region, modelId, stream = false, baseUrl = null) {
  const resolvedRegion = normalizeBedrockRegion(region);
  const resolvedModel = resolveModelID(modelId, resolvedRegion);
  const encodedModel = encodeURIComponent(resolvedModel);
  const resolvedBaseUrl =
    typeof baseUrl === "string" && baseUrl.trim()
      ? baseUrl.trim().replace(/\/+$/, "")
      : buildBedrockRuntimeBaseUrl(resolvedRegion);
  return `${resolvedBaseUrl}/model/${encodedModel}/${stream ? "converse-stream" : "converse"}`;
}

function modelIdFromArn(value) {
  if (typeof value !== "string") return null;
  const marker = ":foundation-model/";
  const idx = value.indexOf(marker);
  if (idx < 0) return null;
  const id = value.slice(idx + marker.length).trim();
  return id || null;
}

export function getBedrockKnownModelLimits(modelId) {
  const trimmed = typeof modelId === "string" ? modelId.trim() : "";
  if (!trimmed) return null;

  const unqualified = trimmed.includes("/") ? trimmed.slice(trimmed.indexOf("/") + 1) : trimmed;
  const segments = unqualified.split(".");
  const candidates = [
    segments.slice(2).join("."),
    segments.slice(1).join("."),
    unqualified,
    trimmed,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const withDots = candidate.replace(/-(\d+)-(\d+)/g, ".$1.$2").replace(/-(\d+)/g, ".$1");
    const withDashes = candidate.replace(/\./g, "-");
    const exact =
      MODEL_CAPABILITIES[candidate] ||
      MODEL_CAPABILITIES[withDots] ||
      MODEL_CAPABILITIES[withDashes];

    if (exact?.contextWindow || exact?.maxOutput) {
      return {
        ...(typeof exact.contextWindow === "number" ? { inputTokenLimit: exact.contextWindow } : {}),
        ...(typeof exact.maxOutput === "number" ? { outputTokenLimit: exact.maxOutput } : {}),
      };
    }
  }

  const caps = getCapabilitiesForModel("bedrock", candidates[0] || unqualified);
  if (
    caps &&
    (caps.contextWindow !== DEFAULT_CAPABILITIES.contextWindow ||
      caps.maxOutput !== DEFAULT_CAPABILITIES.maxOutput)
  ) {
    return {
      ...(typeof caps.contextWindow === "number" ? { inputTokenLimit: caps.contextWindow } : {}),
      ...(typeof caps.maxOutput === "number" ? { outputTokenLimit: caps.maxOutput } : {}),
    };
  }

  return null;
}

function withKnownBedrockLimits(model) {
  return {
    ...model,
    ...(getBedrockKnownModelLimits(model.id) || {}),
  };
}

export function normalizeBedrockDiscoveredModels(
  foundationModelsResponse,
  inferenceProfilesResponse = null
) {
  const byId = new Map();
  const add = (model) => {
    if (!model.id || byId.has(model.id)) return;
    byId.set(model.id, model);
  };

  const foundationModels =
    foundationModelsResponse && typeof foundationModelsResponse === "object"
      ? foundationModelsResponse.modelSummaries
      : null;
  if (Array.isArray(foundationModels)) {
    for (const item of foundationModels) {
      const model = item && typeof item === "object" ? item : {};
      const id = typeof model.modelId === "string" ? model.modelId.trim() : "";
      if (!id) continue;
      const outputModalities = Array.isArray(model.outputModalities) ? model.outputModalities : [];
      const inputModalities = Array.isArray(model.inputModalities) ? model.inputModalities : [];
      add(
        withKnownBedrockLimits({
          id,
          name:
            typeof model.modelName === "string" && model.modelName.trim() ? model.modelName : id,
          source: "foundation",
          provider: typeof model.providerName === "string" ? model.providerName : null,
          supportsStreaming: model.responseStreamingSupported === true,
          supportsVision: inputModalities.includes("IMAGE") || outputModalities.includes("IMAGE"),
        })
      );
    }
  }

  const profiles =
    inferenceProfilesResponse && typeof inferenceProfilesResponse === "object"
      ? inferenceProfilesResponse.inferenceProfileSummaries
      : null;
  if (Array.isArray(profiles)) {
    for (const item of profiles) {
      const profile = item && typeof item === "object" ? item : {};
      const id =
        typeof profile.inferenceProfileId === "string" ? profile.inferenceProfileId.trim() : "";
      if (id) {
        add(
          withKnownBedrockLimits({
            id,
            name:
              typeof profile.inferenceProfileName === "string" &&
              profile.inferenceProfileName.trim()
                ? profile.inferenceProfileName
                : id,
            source: "inference_profile",
            supportsStreaming: true,
          })
        );
      }

      const models = Array.isArray(profile.models) ? profile.models : [];
      for (const profileModel of models) {
        const modelRecord =
          profileModel && typeof profileModel === "object"
            ? profileModel
            : {};
        const modelId = modelIdFromArn(modelRecord.modelArn);
        if (modelId) {
          add(
            withKnownBedrockLimits({
              id,
              name: modelId,
              source: "foundation",
              supportsStreaming: true,
            })
          );
        }
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
