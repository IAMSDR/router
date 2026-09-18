import { buildModelsList } from "../route.js";
// Fork addition: per-API-key access policy filtering for the models catalog.
import { resolveKeyPolicy } from "@/sse/services/apiKeyPolicy/enforce.js";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  "image": ["image"],
  "tts": ["tts"],
  "stt": ["stt"],
  "embedding": ["embedding"],
  "image-to-text": ["imageToText"],
  "web": ["webSearch", "webFetch"],
};

const LLM_KIND = "llm";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function json(data, options = {}) {
  return Response.json(data, {
    ...options,
    headers: {
      "Access-Control-Allow-Origin": "*",
      ...options.headers,
    },
  });
}

/**
 * GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.
 * GET /v1/models/{provider}/{model} - OpenAI-compatible single model lookup.
 * Supported kinds: image, tts, stt, embedding, image-to-text, web.
 */
export async function GET(_request, { params }) {
  try {
    const { model } = await params;
    const path = Array.isArray(model) ? model : [model];
    const identifier = path.filter(Boolean).join("/");
    const kindFilter = path.length === 1 ? KIND_SLUG_MAP[identifier] : null;

    // Fork addition: a restricted key must not see models it cannot call, so a
    // blocked id resolves to the same 404 as a non-existent one. When the caller
    // has no policy we call buildModelsList exactly as before (no extra arg), so
    // unrestricted callers keep the original call shape.
    let policy = null;
    try {
      const resolved = await resolveKeyPolicy(_request);
      policy = resolved?.policy || null;
    } catch { /* listing must never fail because of policy lookup */ }

    if (kindFilter) {
      const data = policy ? await buildModelsList(kindFilter, { policy }) : await buildModelsList(kindFilter);
      return json({ object: "list", data });
    }

    // Match the same LLM catalog exposed by GET /v1/models. A catch-all
    // parameter is required because provider-prefixed IDs contain a slash.
    const models = policy ? await buildModelsList([LLM_KIND], { policy }) : await buildModelsList([LLM_KIND]);
    const matchedModel = models.find((candidate) => candidate.id === identifier);

    if (!matchedModel) {
      return json(
        {
          error: {
            message: `The model '${identifier}' does not exist or you do not have access to it.`,
            type: "invalid_request_error",
            code: "model_not_found",
          },
        },
        { status: 404 },
      );
    }

    return json(matchedModel);
  } catch (error) {
    console.log("Error fetching model:", error);
    return json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 },
    );
  }
}
