/**
 * Small formatting/presentation helpers shared by the Chat page components.
 * Kept dependency-free so any component can import the one it needs.
 */

/** Render a message's text regardless of whether content is a string or object. */
export function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  return content?.text || "";
}

/** Attachments persisted with a message (user turns carry them). */
export function messageAttachments(message) {
  const content = message?.content;
  if (!content || typeof content === "string") return [];
  return Array.isArray(content.attachments) ? content.attachments : [];
}

/** Human-friendly provider/model label fallback. */
export function humanize(value = "") {
  return (
    String(value)
      .replace(/[-_/]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim() || "Unknown"
  );
}

/** Trim a long title to a compact length. */
export function truncate(text, max = 52) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max).trimEnd()}…`;
}

/** Short relative time (5m, 3h, 2d) for the session rail. */
export function relativeTime(value) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(time).toLocaleDateString();
}

/**
 * Cost chip label. Returns null for zero/missing so the chip is omitted.
 * Precision scales with magnitude: cents and up read cleanly, sub-cent values
 * keep enough significant digits to be meaningful.
 */
export function formatCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

/** Token counts from a persisted assistant message. */
export function tokenSummary(message) {
  const prompt = Number(message?.promptTokens);
  const completion = Number(message?.completionTokens);
  const hasPrompt = Number.isFinite(prompt);
  const hasCompletion = Number.isFinite(completion);
  if (!hasPrompt && !hasCompletion) return null;

  const total = (hasPrompt ? prompt : 0) + (hasCompletion ? completion : 0);
  return {
    total,
    label: `${total.toLocaleString()} tokens`,
    detail: `${hasPrompt ? prompt.toLocaleString() : "?"} in · ${
      hasCompletion ? completion.toLocaleString() : "?"
    } out`,
  };
}

/** Latency chip label (falls back to null when missing). */
export function formatLatency(message) {
  const ms = Number(message?.latencyMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Time-to-first-token chip label (falls back to null when missing). */
export function formatTtft(message) {
  const ms = Number(message?.ttftMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
