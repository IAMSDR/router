/**
 * Client helpers for the dashboard Chat page.
 *
 * Every route here is same-origin and cookie-authenticated (the dashboard JWT),
 * and speaks JSON unless the response is an SSE stream. Nothing in this module
 * touches localStorage — conversation history lives on the server.
 */

/**
 * Resolve a human-readable message from a non-2xx JSON body. The gateway sends
 * `{ error: { message, type, code } }`, but `error` can also be a plain string,
 * so this never stringifies an object to "[object Object]" and never throws.
 */
export function errorMessageFrom(payload, fallback = "Request failed") {
  try {
    const error = payload?.error;
    if (typeof error === "string") {
      const text = error.trim();
      if (text) return text;
    } else if (error && typeof error === "object") {
      if (typeof error.message === "string" && error.message.trim()) {
        return error.message.trim();
      }
      // An object without a usable message: show its JSON, unless it is empty.
      try {
        const text = JSON.stringify(error);
        if (text && text !== "{}") return text;
      } catch {
        // Circular/unserializable error — fall through.
      }
    }
    if (typeof payload?.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
  } catch {
    // Never throw while resolving a message.
  }
  return fallback;
}

/**
 * Small JSON fetch wrapper that turns a non-2xx response into an Error carrying
 * the server's `error`/`message` text so callers can toast it verbatim.
 */
async function jsonFetch(url, options = {}) {
  const hasBody = options.body != null;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      errorMessageFrom(data, `Request failed (${response.status})`)
    );
  }
  return data;
}

/** Thin client over the /api/chat/* contract. */
export const chatApi = {
  listSessions: () => jsonFetch("/api/chat/sessions"),

  createSession: () =>
    jsonFetch("/api/chat/sessions", { method: "POST", body: "{}" }),

  getSession: (id) => jsonFetch(`/api/chat/sessions/${id}`),

  updateSession: (id, patch) =>
    jsonFetch(`/api/chat/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteSession: (id) =>
    jsonFetch(`/api/chat/sessions/${id}`, { method: "DELETE" }),

  addMessage: (sessionId, body) =>
    jsonFetch(`/api/chat/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteMessage: (id, sessionId) =>
    jsonFetch(`/api/chat/messages/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ sessionId }),
    }),

  truncateMessage: (id, sessionId) =>
    jsonFetch(`/api/chat/messages/${id}/truncate`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

  /**
   * Images only, 5 MB cap — a rejection arrives as { error } with a 4xx.
   * The route requires the owning session (`sessionId is required` otherwise).
   */
  uploadAttachment: async (file, sessionId) => {
    const form = new FormData();
    form.append("file", file);
    form.append("sessionId", sessionId);
    const response = await fetch("/api/chat/attachments", {
      method: "POST",
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        errorMessageFrom(data, `Upload failed (${response.status})`)
      );
    }
    return data.attachment;
  },

  // Model catalog mirrors the public /v1/models endpoint: only models routable
  // right now (active connections + live per-account catalogs), not the full
  // static registry that /api/models returns.
  // Fallback: if the live catalog is unreachable or empty, use the static
  // /api/models registry (the previous behavior) so the picker never ends up
  // unusable. The /v1 shape and the legacy row shape are both handled by
  // ModelPicker's normalizeModels.
  listModels: async () => {
    try {
      const data = await jsonFetch("/v1/models");
      if (Array.isArray(data?.data) && data.data.length > 0) {
        return { models: data.data };
      }
      console.warn("[chat] /v1/models returned no models, falling back to /api/models");
    } catch (error) {
      console.warn("[chat] /v1/models failed, falling back to /api/models:", error?.message);
    }
    return jsonFetch("/api/models");
  },

  listCombos: () => jsonFetch("/api/combos"),
};

function readChoiceDelta(chunk) {
  const delta = chunk?.choices?.[0]?.delta || {};
  return {
    content: typeof delta.content === "string" ? delta.content : "",
    reasoning:
      typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
  };
}

/**
 * POST a completion and consume the raw OpenAI SSE stream.
 *
 * Calls `onDelta(deltaText, fullText)` and `onReasoning(deltaText, fullText)` as
 * pieces arrive and `onUsage(usage)` when the final usage chunk shows up. The
 * server persists the assistant reply itself, so this resolves with the
 * accumulated text and the caller simply refetches the session afterwards.
 *
 * @returns {Promise<{ text: string, reasoning: string, usage: object|null }>}
 */
export async function streamChat({
  sessionId,
  model,
  messages,
  systemPrompt,
  params,
  signal,
  onDelta,
  onReasoning,
  onUsage,
}) {
  const response = await fetch("/api/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ sessionId, model, messages, systemPrompt, params }),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      errorMessageFrom(data, `Request failed (${response.status})`)
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    // Server answered with a buffered body instead of a stream.
    const data = await response.json().catch(() => ({}));
    const text =
      data?.choices?.[0]?.message?.content ||
      data?.text ||
      data?.output_text ||
      "";
    if (text) onDelta?.(text, text);
    if (data?.usage) onUsage?.(data.usage);
    return { text, reasoning: "", usage: data?.usage || null };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let usage = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }

      const { content, reasoning: reasoningDelta } = readChoiceDelta(chunk);
      if (content) {
        text += content;
        onDelta?.(content, text);
      }
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        onReasoning?.(reasoningDelta, reasoning);
      }
      if (chunk?.usage) {
        usage = chunk.usage;
        onUsage?.(chunk.usage);
      }
    }
  }

  return { text, reasoning, usage };
}
