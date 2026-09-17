// In-memory model capability overrides.
// Pure JS (safe for both browser bundle and Node.js server).

const userOverrides = new Map();

/**
 * Set all user capability overrides from SQLite/settings
 * @param {Record<string, object> | Map<string, object>} overrides
 */
export function setUserCapabilityOverrides(overrides) {
  userOverrides.clear();
  if (!overrides) return;
  const entries = overrides instanceof Map ? overrides.entries() : Object.entries(overrides);
  for (const [key, value] of entries) {
    if (key && value && typeof value === "object") {
      userOverrides.set(key, value);
    }
  }
}

/**
 * Get user capability override for a model
 * @param {string|null} provider
 * @param {string} model
 * @returns {object|null}
 */
export function getUserCapabilityOverride(provider, model) {
  if (!model) return null;
  const baseModel = model.includes("/") ? model.split("/").pop() : model;

  // 1. Exact match with provider: "provider/model" or "provider/baseModel"
  if (provider) {
    const p1 = userOverrides.get(`${provider}/${model}`);
    if (p1) return p1;
    const p2 = userOverrides.get(`${provider}/${baseModel}`);
    if (p2) return p2;
  }

  // 2. Exact match on full model string or base model
  const m1 = userOverrides.get(model);
  if (m1) return m1;

  if (baseModel !== model) {
    const m2 = userOverrides.get(baseModel);
    if (m2) return m2;
  }

  // 3. Match any override key ending with `/${baseModel}` or `/${model}`
  // (e.g. if saved as "tt/deepseek-v4-flash-free" and queried with raw providerId)
  for (const [k, v] of userOverrides.entries()) {
    if (k.endsWith(`/${baseModel}`) || k.endsWith(`/${model}`)) return v;
  }

  return null;
}
