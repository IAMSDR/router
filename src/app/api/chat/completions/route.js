// Dashboard Chat: streaming completion bridge (fork addition).
//
// The Chat page must run on the gateway's real pipeline so routing, combos,
// account fallback, quota accounting and the request log all apply. Rather than
// reimplement any of that, this route rebuilds an OpenAI-compatible request
// from the persisted session history and hands it to the same handleChat() the
// public /api/v1/chat/completions endpoint uses; the SSE bytes are forwarded to
// the client unchanged while the reply is accumulated and persisted server-side
// (a closed tab still saves the answer).
import { NextResponse } from "next/server";
import fs from "node:fs";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { calculateCostFromTokens } from "open-sse/providers/pricing.js";
import { getModelInfo } from "@/sse/services/model.js";
import {
  getChatSession,
  listChatMessages,
  listChatAttachments,
  appendChatMessage,
  getSettings,
  getApiKeys,
} from "@/lib/db";
import { getPricingForModel } from "@/lib/db/repos/pricingRepo.js";
import { chatUploadAbsPath } from "@/lib/chat/storage.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let initialized = false;

/** Initialize translators once, mirroring the /api/v1 route. */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Turn a persisted message into an upstream request message. A user turn with
 * images becomes the OpenAI content-array form; image files that vanished from
 * disk are dropped rather than failing the whole request.
 */
function buildUpstreamMessage(message, attachmentsById) {
  const text = typeof message?.content?.text === "string" ? message.content.text : "";
  const attachments = Array.isArray(message?.content?.attachments)
    ? message.content.attachments
    : [];

  if (message?.role !== "user" || attachments.length === 0) {
    return { role: message?.role ?? "user", content: text };
  }

  const parts = [];
  if (text) parts.push({ type: "text", text });
  for (const ref of attachments) {
    const row = attachmentsById.get(ref?.id);
    const absPath = row ? chatUploadAbsPath(row.relPath) : null;
    if (!absPath || !fs.existsSync(absPath)) continue;
    try {
      const base64 = fs.readFileSync(absPath).toString("base64");
      const mimeType = row.mimeType || ref.mimeType || "image/png";
      parts.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } });
    } catch {
      // dropped: unreadable bytes must not break the turn
    }
  }

  if (parts.length === 0) return { role: message.role, content: text };
  return { role: message.role, content: parts };
}

function parseFrames(buffer, onFrame) {
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() || "";
  for (const frame of frames) onFrame(frame);
  return rest;
}

/**
 * Per-field accumulation cap, in characters (~1 MB for ASCII), applied to a
 * single reply's text and reasoning independently. A hostile or runaway
 * provider must not be able to grow the persisted reply without bound; once a
 * field hits the cap we stop appending but keep forwarding bytes untouched.
 */
const CHAT_REPLY_FIELD_LIMIT = 1_000_000;

/** Append `piece` to `current` without exceeding the cap. Never throws. */
function appendCapped(current, piece) {
  if (current.length >= CHAT_REPLY_FIELD_LIMIT) return [current, true];
  const combined = current + piece;
  if (combined.length > CHAT_REPLY_FIELD_LIMIT) {
    return [combined.slice(0, CHAT_REPLY_FIELD_LIMIT), true];
  }
  return [combined, false];
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const startedAt = Date.now();
  const { sessionId, model, systemPrompt, params } = body;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!model || typeof model !== "string") {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }

  // 404 before doing any work when the session is gone.
  const session = await getChatSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // History is refetched server-side so the browser cannot smuggle a
  // conversation that disagrees with what was persisted.
  const history = await listChatMessages(sessionId);
  const attachmentsById = new Map();
  try {
    for (const attachment of await listChatAttachments(sessionId)) {
      attachmentsById.set(attachment.id, attachment);
    }
  } catch {
    // attachment metadata is optional — text-only turns still work
  }

  const messages = [];
  if (typeof systemPrompt === "string" && systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt });
  }
  for (const message of history) {
    messages.push(buildUpstreamMessage(message, attachmentsById));
  }

  const payload = {
    model,
    messages,
    // Caller params first so the forced streaming contract below always wins:
    // a stray `stream: false` or bogus `stream_options` must not break SSE.
    ...(params && typeof params === "object" && !Array.isArray(params) ? params : {}),
    stream: true,
    stream_options: { include_usage: true },
  };

  // requireApiKey means the pipeline will demand a key; the Chat page has none
  // of its own, so lend it the first active dashboard key. When keys are not
  // required we send no Authorization header at all (local mode).
  const settings = await getSettings();
  const headers = { "content-type": "application/json" };
  if (settings?.requireApiKey) {
    const keys = await getApiKeys();
    const activeKey = Array.isArray(keys) ? keys.find((k) => k?.isActive && k.key) : null;
    if (!activeKey) {
      return NextResponse.json(
        {
          error:
            "No active API key. Create one under API Keys in the dashboard to use Chat.",
        },
        { status: 400 }
      );
    }
    headers.Authorization = `Bearer ${activeKey.key}`;
  }

  await ensureInitialized();

  const upstreamRequest = new Request(new URL("/api/v1/chat/completions", request.url), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const upstream = await handleChat(upstreamRequest);
  if (!upstream.ok) {
    // Pass a failure straight through — a request that never started must not
    // leave an empty assistant message behind.
    return upstream;
  }

  const state = { text: "", reasoning: "", model: null, usage: null, ttftMs: null, truncated: false };
  const decoder = new TextDecoder();
  let buffer = "";
  let settled = false;
  const reader = upstream.body.getReader();

  const onFrame = (frame) => {
    for (const rawLine of frame.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (typeof chunk?.model === "string") state.model = chunk.model;

      const delta = chunk?.choices?.[0]?.delta;
      if (delta) {
        if (typeof delta.content === "string" && delta.content) {
          if (state.ttftMs == null) state.ttftMs = Date.now() - startedAt;
          const [text, truncated] = appendCapped(state.text, delta.content);
          state.text = text;
          if (truncated) state.truncated = true;
        }
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          if (state.ttftMs == null) state.ttftMs = Date.now() - startedAt;
          const [reasoning, truncated] = appendCapped(state.reasoning, delta.reasoning_content);
          state.reasoning = reasoning;
          if (truncated) state.truncated = true;
        }
      }
      if (chunk?.usage) state.usage = chunk.usage;
    }
  };

  const finalize = async (status, error) => {
    if (settled) return;
    settled = true;
    request.signal?.removeEventListener?.("abort", onAbort);

    // Provider: the requested model's info first, then the resolved model the
    // pipeline echoed back when it looks like "provider/model".
    let provider = null;
    let resolvedModel = model;
    try {
      const info = await getModelInfo(model);
      if (info) {
        provider = info.provider ?? null;
        resolvedModel = info.model || model;
      }
    } catch {
      // provider stays null
    }
    if (typeof state.model === "string" && state.model.includes("/")) {
      const [streamedProvider, ...rest] = state.model.split("/");
      if (streamedProvider && rest.length) {
        provider = streamedProvider;
        resolvedModel = rest.join("/");
      }
    } else if (typeof state.model === "string" && state.model) {
      resolvedModel = state.model;
    }

    // Cost only when both a provider and pricing are known — never invent one.
    let cost = null;
    const usage = state.usage;
    if (usage && provider) {
      try {
        const pricing = await getPricingForModel(provider, resolvedModel);
        if (pricing) cost = calculateCostFromTokens(usage, pricing);
      } catch {
        cost = null;
      }
    }

    try {
      // Surface truncation instead of silently persisting a short reply.
      const persistedStatus = state.truncated ? "truncated" : status;
      let persistedError = error;
      if (state.truncated) {
        const note = `Reply truncated at ${CHAT_REPLY_FIELD_LIMIT} chars`;
        persistedError = error ? `${error} (${note})` : note;
      }
      await appendChatMessage({
        sessionId,
        role: "assistant",
        content: { text: state.text, attachments: [] },
        reasoning: state.reasoning || null,
        model: resolvedModel,
        provider,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        cost,
        ttftMs: state.ttftMs,
        latencyMs: Date.now() - startedAt,
        status: persistedStatus,
        error: persistedError,
      });
    } catch {
      // Persistence is best-effort; the stream has already reached the client.
    }
  };

  const onAbort = () => {
    if (settled) return;
    try {
      reader.cancel();
    } catch {
      // ignore
    }
    // Detached: swallow any rejection so an abort cannot surface as an
    // unhandled rejection even if finalize throws before its own try/catch.
    finalize("aborted", null).catch(() => {});
  };
  request.signal?.addEventListener?.("abort", onAbort);

  const stream = new ReadableStream({
    async pull(controller) {
      if (settled) return;
      try {
        const { value, done } = await reader.read();
        if (settled) return; // aborted while awaiting the next chunk
        if (done) {
          buffer = parseFrames(buffer + decoder.decode(), onFrame);
          if (buffer) onFrame(buffer);
          await finalize("success", null);
          controller.close();
          return;
        }
        // Forward the upstream bytes untouched so the browser's SSE parser
        // sees exactly what the pipeline produced.
        controller.enqueue(value);
        buffer = parseFrames(buffer + decoder.decode(value, { stream: true }), onFrame);
      } catch (err) {
        if (settled) return;
        await finalize("error", err?.message || String(err));
        try {
          controller.error(err);
        } catch {
          // the consumer already went away
        }
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        // ignore
      }
      await finalize("aborted", null);
    },
  });

  return new Response(stream, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
