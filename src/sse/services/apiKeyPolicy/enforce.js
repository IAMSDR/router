// Fork addition — per-API-key policy enforcement for the SSE request path.
//
// This module is the ONLY thing the handlers import. It resolves the presented
// API key into a stored policy, evaluates model/provider/combo rules, and
// checks quotas. All logic lives here (and in the pure engine) so the handler
// call sites stay a two-line guard that is trivial to reconcile on rebase.
//
// Design notes:
//  - Requests with NO key bypass policy entirely (unchanged local behaviour).
//  - A policy is enforced whenever a presented key resolves to one, even when
//    settings.requireApiKey is false (decision).
//  - Denied requests never count toward that key's own RPM/quota.
import { extractApiKey } from "../auth.js";
import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getApiKeyPolicy } from "@/lib/db/repos/apiKeyPolicyRepo.js";
import { getSettings } from "@/lib/localDb";
import {
  evaluatePolicy,
  evaluateComboMember,
  POLICY_CODE,
} from "@/shared/utils/apiKeyPolicy.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { getProviderAlias, resolveProviderId as resolveProviderIdCore, AI_PROVIDERS } from "@/shared/constants/providers.js";
import * as log from "../../utils/logger.js";

/**
 * Every spelling a provider may be referenced by: its internal registry id, its
 * public alias, and any additional aliases on the registry entry. The policy
 * matches against all of them so a user can write either form in the UI.
 */
export function providerAliasesFor(providerId) {
  if (!providerId) return [];
  const out = new Set([providerId]);
  try {
    const alias = getProviderAlias(providerId);
    if (alias) out.add(alias);
    const entry = AI_PROVIDERS?.[providerId];
    if (entry?.alias) out.add(entry.alias);
    for (const a of entry?.aliases || []) out.add(a);
  } catch { /* registry lookups are best-effort */ }
  return [...out];
}

/**
 * Resolve every provider spelling implied by a raw model string.
 *
 * The pre-resolution guard in the chat handler runs before the model string is
 * parsed, so the provider is not known yet. A `provider/model` string already
 * encodes it, and the policy must match the same way it will once resolved.
 * Returns [] for a bare model name or a combo name (no provider prefix).
 */
function providerSpellingsFromModel(modelStr, registryResolve) {
  if (!modelStr || typeof modelStr !== "string") return [];
  const slash = modelStr.indexOf("/");
  if (slash <= 0) return [];
  const prefix = modelStr.slice(0, slash);
  // Map a public alias prefix back to the registry id when possible, then take
  // every alias of that provider so either spelling matches.
  let canonical = prefix;
  try {
    if (registryResolve) canonical = registryResolve(prefix) || prefix;
  } catch { /* keep the raw prefix */ }
  const ids = new Set([prefix, canonical]);
  for (const id of [...ids]) {
    for (const alias of providerAliasesFor(id)) ids.add(alias);
  }
  return [...ids];
}

// In-memory per-key in-flight counters. Mirrors the global pattern used by
// usageRepo's pendingRequests so it is shared across Next.js module instances.
if (!global._policyPendingByKey) global._policyPendingByKey = new Map();
const pendingByKey = global._policyPendingByKey;

// Short TTL cache for the tokens-per-day DB read so a burst of requests
// on one key does not issue a query per request. (RPM no longer uses the DB —
// see the sliding window below.)
const QUOTA_CACHE_TTL_MS = 1000;
if (!global._policyQuotaCache) global._policyQuotaCache = new Map();
const quotaCache = global._policyQuotaCache;

// Per-key sliding window of recent request start times, used for the RPM
// limit. Recorded at guard time (before the request runs), so it counts
// failed and zero-usage requests that never land in usageHistory — the exact
// retry-storm traffic a rate limit exists to contain. Being in-memory and
// per-process, it also closes the check-then-act race a cached DB read opens
// under concurrent bursts. Trade-off (documented in FORK.md): the count is
// per-process and resets on restart, which is acceptable for a single-instance
// gateway and matches how pendingByKey already behaves.
if (!global._policyRpmLog) global._policyRpmLog = new Map();
const rpmLog = global._policyRpmLog;
const RPM_WINDOW_MS = 60_000;

/** Prune timestamps outside the trailing window and return the live list. */
function liveRpmEntries(id, now = Date.now()) {
  const list = rpmLog.get(id) || [];
  const cutoff = now - RPM_WINDOW_MS;
  const kept = list.filter((ts) => ts > cutoff);
  if (kept.length === 0) rpmLog.delete(id);
  else rpmLog.set(id, kept);
  return kept;
}

/** Record a request start for the key and return its count in the window. */
export function recordRpmRequest(id, now = Date.now()) {
  if (!id) return 0;
  const kept = liveRpmEntries(id, now);
  kept.push(now);
  rpmLog.set(id, kept);
  return kept.length;
}

/** Current number of requests in the trailing 60s window for a key id. */
export function rpmUsedInWindow(id, now = Date.now()) {
  if (!id) return 0;
  return liveRpmEntries(id, now).length;
}

/**
 * Resolve the presented key into { keyRecord, policy }.
 * Returns null when there is no key, the key is unknown, or it has no policy
 * (=> caller must treat the request as unrestricted).
 *
 * The result is cached on the request object for the lifetime of a single
 * request so that multiple guard calls (pre-resolution + post-resolution) do
 * not repeat the DB lookups.
 */
export async function resolveKeyPolicy(request) {
  try {
    // Fast path: reuse a prior resolution for the same request object.
    if (request && request._resolvedKeyPolicy !== undefined) {
      return request._resolvedKeyPolicy;
    }
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      if (request) request._resolvedKeyPolicy = null;
      return null;
    }
    const keyRecord = await getApiKeyByKey(apiKey);
    // A deactivated key is treated as no-policy so its behaviour is consistent
    // regardless of settings.requireApiKey: auth already 401s it when a key is
    // required; when auth is off it degrades to unrestricted rather than
    // surfacing policy denials for a key the operator has switched off.
    if (!keyRecord || !keyRecord.isActive) {
      if (request) request._resolvedKeyPolicy = null;
      return null;
    }
    const policy = await getApiKeyPolicy(keyRecord.id);
    if (!policy) {
      if (request) request._resolvedKeyPolicy = null;
      return null;
    }
    const result = { keyRecord, policy };
    if (request) request._resolvedKeyPolicy = result;
    return result;
  } catch (e) {
    // Fail-open on infrastructure errors: a broken policy lookup must not take
    // the gateway down. Denials only ever come from an explicit rule match.
    log.warn("POLICY", `Policy lookup failed (fail-open): ${e?.message || e}`);
    if (request) request._resolvedKeyPolicy = null;
    return null;
  }
}

/** Global kill switch — settings.apiKeyPoliciesEnabled (default true). */
async function policiesGloballyEnabled() {
  try {
    const settings = await getSettings();
    return settings?.apiKeyPoliciesEnabled !== false;
  } catch {
    return true;
  }
}

/** Build a 403 policy-denial response with a stable machine-readable code. */
export function policyDeniedResponse(code, message) {
  return new Response(
    JSON.stringify({ error: { message, type: "invalid_request_error", code } }),
    {
      status: HTTP_STATUS.FORBIDDEN,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

/** Build a 429 quota response including Retry-After. */
export function quotaExceededResponse(code, message, retryAfterSec) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Retry-After": String(Math.max(1, Math.ceil(retryAfterSec || 1))),
  };
  return new Response(
    JSON.stringify({
      error: { message, type: "rate_limit_error", code },
    }),
    { status: HTTP_STATUS.RATE_LIMITED, headers }
  );
}

/** Sum prompt+completion tokens for a key since local midnight. */
async function tokensUsedToday(apiKey) {
  const cacheKey = `${apiKey}|tpd`;
  const cached = quotaCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < QUOTA_CACHE_TTL_MS) return cached.value;
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db.get(
    `SELECT COALESCE(SUM(promptTokens), 0) AS p, COALESCE(SUM(completionTokens), 0) AS c
       FROM usageHistory WHERE apiKey = ? AND timestamp >= ?`,
    [apiKey, start.toISOString()]
  );
  const value = (row?.p || 0) + (row?.c || 0);
  quotaCache.set(cacheKey, { ts: now, value });
  return value;
}

/** Seconds until local midnight. */
function secondsUntilLocalMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
}

/**
 * Check a key's quotas. Returns a Response to send back when a limit is hit,
 * otherwise null.
 */
export async function checkQuotas({ keyRecord, policy, modality = "chat" }) {
  const quotas = policy?.quotas;
  if (!quotas || !keyRecord?.key) return null;

  // Concurrency — cheapest check, no DB.
  if (quotas.concurrency) {
    const inFlight = pendingByKey.get(keyRecord.id) || 0;
    if (inFlight >= quotas.concurrency) {
      log.warn(
        "POLICY",
        `Concurrency limit (${quotas.concurrency}) reached for key "${keyRecord.name || keyRecord.id}"`
      );
      return quotaExceededResponse(
        POLICY_CODE.CONCURRENCY_LIMIT,
        `Concurrency limit reached for this API key (${inFlight}/${quotas.concurrency} in flight)`,
        1
      );
    }
  }

  // Requests per minute — in-memory trailing 60s window recorded at guard time.
  if (quotas.rpm) {
    const used = rpmUsedInWindow(keyRecord.id);
    if (used >= quotas.rpm) {
      const oldest = liveRpmEntries(keyRecord.id)[0];
      const retryAfter = oldest ? Math.ceil((oldest + RPM_WINDOW_MS - Date.now()) / 1000) : 60;
      log.warn(
        "POLICY",
        `RPM limit (${quotas.rpm}) reached for key "${keyRecord.name || keyRecord.id}" (${used} in last 60s)`
      );
      return quotaExceededResponse(
        POLICY_CODE.RATE_LIMITED,
        `Rate limit exceeded for this API key: ${used}/${quotas.rpm} requests in the last 60s`,
        retryAfter
      );
    }
  }

  // Tokens per day — local-midnight reset.
  if (quotas.tokensPerDay) {
    const used = await tokensUsedToday(keyRecord.key);
    if (used >= quotas.tokensPerDay) {
      log.warn(
        "POLICY",
        `Daily token limit (${quotas.tokensPerDay}) reached for key "${keyRecord.name || keyRecord.id}" (${used} used)`
      );
      return quotaExceededResponse(
        POLICY_CODE.QUOTA_EXCEEDED,
        `Daily token quota exceeded for this API key: ${used}/${quotas.tokensPerDay} tokens used today`,
        secondsUntilLocalMidnight()
      );
    }
  }

  return null;
}

/**
 * Reserve a concurrency slot. Always paired with releaseConcurrency().
 * Returns a release function (no-op when the policy has no concurrency cap).
 */
export function acquireConcurrency(keyRecord, policy) {
  if (!policy?.quotas?.concurrency || !keyRecord?.id) return () => {};
  const id = keyRecord.id;
  pendingByKey.set(id, (pendingByKey.get(id) || 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = Math.max(0, (pendingByKey.get(id) || 0) - 1);
    if (next === 0) pendingByKey.delete(id);
    else pendingByKey.set(id, next);
  };
}

/**
 * Guard a single-model (or provider-only) request.
 *
 * @param {Request} request
 * @param {object} opts
 * @param {"chat"|"embeddings"|"image"|"tts"|"stt"|"search"|"fetch"|"video"} opts.modality
 * @param {string} [opts.modelStr]        Raw model/provider string from the client.
 * @param {string} [opts.provider]        Resolved provider id (when known).
 * @param {string} [opts.model]           Resolved bare model id (when known).
 * @param {string[]} [opts.providerAliases]
 * @param {boolean} [opts.providerOnly]   Skip model rules (search/fetch/video-poll).
 * @param {boolean} [opts.skipQuotas]     Check rules only; the caller already owns quota accounting.
 * @returns {Promise<{response: Response|null, keyRecord: object|null, policy: object|null, release: Function}>}
 */
export async function guardRequest(request, opts = {}) {
  const noop = {
    response: null,
    keyRecord: null,
    policy: null,
    release: () => {},
  };
  try {
    if (!(await policiesGloballyEnabled())) return noop;

    const resolved = await resolveKeyPolicy(request);
    if (!resolved) return noop;

    const { keyRecord, policy } = resolved;
    const label = keyRecord.name || keyRecord.id;

    // When the caller has not resolved the provider yet (the pre-combo guard in
    // the chat handler), derive every provider spelling the raw `provider/model`
    // string implies so the provider rule matches the same way it will once the
    // model is resolved. Without this, a `codex/...` request would be judged
    // against the literal string "codex/..." and wrongly denied. The bare model
    // part is derived too, so an allowlisted model matches under any provider
    // spelling (e.g. `codex/gpt-6-astra` vs the catalog's `cx/gpt-6-astra`).
    const rawModel = opts.providerOnly ? null : opts.modelStr;
    const slashIdx = typeof rawModel === "string" ? rawModel.indexOf("/") : -1;
    const derivedModel = slashIdx > 0 ? rawModel.slice(slashIdx + 1) : opts.model;
    const derivedProviderSpellings = opts.provider
      ? null
      : providerSpellingsFromModel(opts.modelStr, resolveProviderIdCore);

    const verdict = evaluatePolicy(policy, {
      requestedModel: opts.providerOnly ? undefined : opts.modelStr,
      // providerOnly modes (search/fetch/video) put the provider id in modelStr
      // and must not be judged by model rules at all.
      resolvedProvider: opts.provider || (opts.providerOnly ? opts.modelStr : undefined),
      resolvedModel: opts.providerOnly ? undefined : (opts.model || derivedModel),
      providerAliases: opts.providerAliases?.length
        ? opts.providerAliases
        : derivedProviderSpellings || undefined,
      skipModelRule: Boolean(opts.providerOnly),
    });

    if (!verdict.allowed) {
      log.warn("POLICY", `Denied [${opts.modality}] ${verdict.code} for key "${label}": ${verdict.reason}`);
      return { response: policyDeniedResponse(verdict.code, verdict.reason), keyRecord, policy, release: () => {} };
    }

    if (opts.skipQuotas) {
      return { response: null, keyRecord, policy, release: () => {} };
    }

    const quotaResponse = await checkQuotas({ keyRecord, policy, modality: opts.modality });
    if (quotaResponse) {
      return { response: quotaResponse, keyRecord, policy, release: () => {} };
    }

    // Count the request against RPM at admission so failures and zero-usage
    // responses still register (and a concurrent burst can't slip past).
    recordRpmRequest(keyRecord.id);

    return {
      response: null,
      keyRecord,
      policy,
      release: acquireConcurrency(keyRecord, policy),
    };
  } catch (e) {
    log.warn("POLICY", `Guard failed (fail-open): ${e?.message || e}`);
    return noop;
  }
}

/**
 * Guard a combo request by name (chat/image/tts combos).
 * Returns the filtered member list plus a response when the combo itself is
 * denied or every member is blocked.
 */
export async function guardCombo(request, opts = {}) {
  const { comboName, members = [] } = opts;
  const base = { response: null, keyRecord: null, policy: null, release: () => {}, members: members.slice() };
  try {
    if (!(await policiesGloballyEnabled())) return base;

    const resolved = await resolveKeyPolicy(request);
    if (!resolved) return base;

    const { keyRecord, policy } = resolved;
    const label = keyRecord.name || keyRecord.id;

    const verdict = evaluatePolicy(policy, { comboName });
    if (!verdict.allowed) {
      log.warn("POLICY", `Denied combo "${comboName}" ${verdict.code} for key "${label}": ${verdict.reason}`);
      return { ...base, response: policyDeniedResponse(verdict.code, verdict.reason), keyRecord, policy };
    }

    const quotaResponse = await checkQuotas({ keyRecord, policy, modality: opts.modality || "chat" });
    if (quotaResponse) {
      return { ...base, response: quotaResponse, keyRecord, policy };
    }

    // Hard-fail semantics: strip members a provider rule blocks so the combo
    // engine can never transparently fall back onto a disallowed provider.
    const allowedMembers = [];
    // Only compare against the ORIGINAL member list so we can detect a
    // total denial; the fallback engine receives the filtered list.
    for (const member of members) {
      const memberVerdict = evaluateComboMember(policy, member);
      if (memberVerdict.allowed) allowedMembers.push(member);
      else {
        log.warn(
          "POLICY",
          `Combo "${comboName}" member "${member}" blocked for key "${label}": ${memberVerdict.reason}`
        );
      }
    }

    if (allowedMembers.length === 0) {
      return {
        ...base,
        response: policyDeniedResponse(
          POLICY_CODE.MODEL_NOT_ALLOWED,
          `None of the models in combo "${comboName}" are allowed for this API key`
        ),
        keyRecord,
        policy,
      };
    }

    // Count the request against RPM at admission (see guardRequest).
    recordRpmRequest(keyRecord.id);

    return {
      response: null,
      keyRecord,
      policy,
      release: acquireConcurrency(keyRecord, policy),
      members: allowedMembers,
    };
  } catch (e) {
    log.warn("POLICY", `Combo guard failed (fail-open): ${e?.message || e}`);
    return base;
  }
}

/** Test/observability helper — current in-flight count for a key id. */
export function getInFlight(keyId) {
  return pendingByKey.get(keyId) || 0;
}

/** Clear the short-lived tokens-per-day read cache (used after a request completes). */
export function invalidateQuotaCache(apiKey) {
  if (!apiKey) return;
  quotaCache.delete(`${apiKey}|tpd`);
}

// Maximum time a single stream may hold a concurrency slot. If a stream hangs
// (client dies mid-stream and the producer never closes or errors), neither
// flush nor cancel fires and the slot would leak — after `concurrency` such
// hangs the key would be permanently 429'd until process restart. This timer
// is a safety net only; healthy streams release on flush/cancel long before
// it fires. Overridable via POLICY_MAX_STREAM_LIFETIME_MS.
export const MAX_STREAM_LIFETIME_MS =
  Number(process.env.POLICY_MAX_STREAM_LIFETIME_MS) > 0
    ? Number(process.env.POLICY_MAX_STREAM_LIFETIME_MS)
    : 10 * 60_000;

/**
 * Attach a concurrency release to a Response so the slot is freed when the
 * stream finishes (or immediately, for a non-streaming response).
 *
 * Streaming responses outlive the handler's return, so releasing at return
 * time would let a client open unlimited concurrent streams. Wrapping the body
 * makes the slot track the actual in-flight lifetime.
 */
export function withPolicyRelease(response, release) {
  if (typeof release !== "function" || !response || !(response instanceof Response)) {
    if (typeof release === "function") release();
    return response;
  }
  const body = response.body;
  if (!body) {
    release();
    return response;
  }

  // Only streaming responses outlive the handler return. A buffered body (JSON
  // error, non-stream payload) is fully materialised, so release right away —
  // otherwise the concurrency slot would be held until the client reads it.
  const contentType = response.headers?.get?.("content-type") || "";
  const isStream = /text\/event-stream|application\/x-ndjson|application\/stream/i.test(contentType)
    || response.headers?.get?.("x-accel-buffering") === "no";
  if (!isStream) {
    release();
    return response;
  }

  let released = false;
  // Safety net against a hung stream that never flushes or cancels. unref() so
  // the timer never keeps the process alive; cleared on normal release.
  const watchdog = setTimeout(() => {
    log.warn("POLICY", `Stream exceeded max lifetime (${MAX_STREAM_LIFETIME_MS}ms); force-releasing concurrency slot`);
    done();
  }, MAX_STREAM_LIFETIME_MS);
  watchdog.unref?.();
  const done = () => {
    if (released) return;
    released = true;
    clearTimeout(watchdog);
    release();
  };
  const wrapped = body.pipeThrough(
    new TransformStream({
      flush: done,
      cancel: done,
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    })
  );
  // A consumer error surfaces as a stream error; make sure we still release.
  wrapped.closed?.catch?.(done);
  return new Response(wrapped, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Wrap an async handler-returning promise so its concurrency slot is released
 * against the produced Response. Use for paths that may return a stream.
 */
export async function withReleasedResponse(promiseOrValue, release) {
  try {
    const response = await promiseOrValue;
    return withPolicyRelease(response, release);
  } catch (e) {
    if (typeof release === "function") release();
    throw e;
  }
}
