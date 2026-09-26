import {
  buildBedrockRuntimeBaseUrl,
  resolveBedrockRegion,
} from "../config/bedrock.js";

export class BedrockNativeApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "BedrockNativeApiError";
    this.status = typeof options.status === "number" ? options.status : null;
    this.url = options.url || "";
    this.body = options.body ?? null;
  }
}

export function isBedrockNativeApiError(error) {
  return error instanceof BedrockNativeApiError;
}

export function isBedrockNativeAuthError(error) {
  return isBedrockNativeApiError(error) && (error.status === 401 || error.status === 403);
}

export function buildBedrockNativeHeaders(apiKey, extraHeaders = {}) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
    ...extraHeaders,
  };
}

export async function probeBedrockRuntime({
  apiKey,
  providerSpecificData,
  fetcher = fetch,
  signal,
}) {
  const region = resolveBedrockRegion(providerSpecificData);
  const rawBaseUrl =
    typeof providerSpecificData?.baseUrl === "string"
      ? providerSpecificData.baseUrl
      : typeof providerSpecificData?.endpoint === "string"
      ? providerSpecificData.endpoint
      : buildBedrockRuntimeBaseUrl(region);
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/model/__probe__/converse`;

  const response = await fetcher(url, {
    method: "POST",
    headers: buildBedrockNativeHeaders(apiKey),
    body: JSON.stringify({
      messages: [{ role: "user", content: [{ text: "ping" }] }],
    }),
    ...(signal ? { signal } : {}),
  });

  if (response.status === 401 || response.status === 403) {
    const text = await response.text().catch(() => "");
    throw new BedrockNativeApiError("Bedrock authentication failed", {
      status: response.status,
      url,
      body: text,
    });
  }

  return { ok: true, region, status: response.status };
}
