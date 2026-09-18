// Fork addition — per-API-key access policy persistence.
//
// Stored in the generic KV table under scope "apiKeyPolicies", keyed by the
// API KEY ID (not the key string) so policies survive key rotation and are
// never exposed by leaking the secret into a scope you might dump.
//
// A mirror is kept in memory so the hot request path never issues a DB read
// per request — same pattern as capabilitiesRepo.js.
import { makeKv } from "../helpers/kvStore.js";
import { normalizePolicy } from "@/shared/utils/apiKeyPolicy.js";

const policiesKv = makeKv("apiKeyPolicies");

/** @type {Map<string, object>|null} */
let cachedPolicies = null;

async function syncToMemory() {
  const all = await policiesKv.getAll();
  const map = new Map();
  for (const [id, raw] of Object.entries(all || {})) {
    const normalized = normalizePolicy(raw);
    if (normalized) map.set(id, normalized);
  }
  cachedPolicies = map;
  return map;
}

/** Read-through memory mirror of every stored policy. */
export async function getAllApiKeyPolicies() {
  if (cachedPolicies) return cachedPolicies;
  return await syncToMemory();
}

/**
 * Get the raw (un-normalized) stored policy for a key id.
 * Returns null when the key has no policy (=> unrestricted).
 */
export async function getApiKeyPolicyRaw(id) {
  if (!id) return null;
  return await policiesKv.get(id, null);
}

/** Get a normalized policy for a key id, or null when unrestricted. */
export async function getApiKeyPolicy(id) {
  if (!id) return null;
  const all = await getAllApiKeyPolicies();
  const cached = all.get(id);
  if (cached) return cached;
  // Cache miss (e.g. a policy written by another process): re-read once.
  const raw = await getApiKeyPolicyRaw(id);
  if (!raw) return null;
  const normalized = normalizePolicy(raw);
  if (!normalized) return null;
  if (cachedPolicies) cachedPolicies.set(id, normalized);
  return normalized;
}

/** Create or replace the policy for a key id. Passing null/empty deletes it. */
export async function updateApiKeyPolicy(id, policy) {
  if (!id || typeof id !== "string") throw new Error("api key id required");
  const normalized = normalizePolicy(policy);
  if (!normalized) {
    await policiesKv.remove(id);
    await syncToMemory();
    return null;
  }
  await policiesKv.set(id, policy);
  await syncToMemory();
  return normalized;
}

/** Remove a key's policy (=> unrestricted). */
export async function deleteApiKeyPolicy(id) {
  if (!id) return;
  await policiesKv.remove(id);
  await syncToMemory();
}

/** Drop policies for keys that no longer exist (called on key deletion). */
export async function pruneApiKeyPolicy(id) {
  return await deleteApiKeyPolicy(id);
}

/** Load every policy into memory at boot. */
export async function initApiKeyPolicies() {
  return await syncToMemory();
}
