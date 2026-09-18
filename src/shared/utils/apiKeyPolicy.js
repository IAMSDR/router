// Fork addition — per-API-key access policy engine.
// Pure, dependency-free (no DB, no node:*), so it is safe to unit-test in
// isolation and to import from either the server handlers or dashboard code.
//
// Matching is EXACT-STRING ONLY by design (no globs / regex) so a policy is
// always trivially auditable and cannot be tricked by pattern edge cases.
//
// Policy shape (all fields optional; absent = unrestricted):
// {
//   enabled: true,
//   models:    { mode: "allow" | "deny", list: ["kiro/claude-opus-4.8", "sonnet"] },
//   providers: { mode: "allow" | "deny", list: ["kiro", "codex"] },
//   combos:    { mode: "allow" | "deny", list: ["cheap-fallback"] },
//   quotas:    { rpm: 60, tokensPerDay: 2000000, concurrency: 4 },
// }

/** Per-dimension modes. */
export const POLICY_MODE = Object.freeze({ ALLOW: "allow", DENY: "deny" });

/** Result codes returned by evaluatePolicy (stable — the API surfaces these). */
export const POLICY_CODE = Object.freeze({
  OK: "ok",
  DISABLED: "policy_disabled",
  MODEL_NOT_ALLOWED: "model_not_allowed",
  PROVIDER_NOT_ALLOWED: "provider_not_allowed",
  COMBO_NOT_ALLOWED: "combo_not_allowed",
  // Quota codes are produced by the quota checker, not the matcher.
  RATE_LIMITED: "rate_limited",
  QUOTA_EXCEEDED: "quota_exceeded",
  CONCURRENCY_LIMIT: "concurrency_limit",
});

const ALLOWED_MODES = new Set([POLICY_MODE.ALLOW, POLICY_MODE.DENY]);

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

/**
 * Normalize an arbitrary stored/incoming rule dimension into a safe shape.
 * Returns `null` when the dimension carries no rule at all (=> unrestricted).
 */
function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  const list = normalizeList(rule.list);
  if (list.length === 0) return null;
  const mode = ALLOWED_MODES.has(rule.mode) ? rule.mode : POLICY_MODE.ALLOW;
  return { mode, list };
}

/**
 * Normalize the whole policy. Unknown fields are dropped so a malformed row
 * can never widen or crash access decisions.
 */
export function normalizePolicy(policy) {
  if (!policy || typeof policy !== "object") return null;
  const out = {
    enabled: policy.enabled !== false,
    models: normalizeRule(policy.models),
    providers: normalizeRule(policy.providers),
    combos: normalizeRule(policy.combos),
    quotas: normalizeQuotas(policy.quotas),
  };
  const isEmpty = !out.models && !out.providers && !out.combos && !out.quotas;
  if (isEmpty) return null;
  return out;
}

/** Normalize quota config. All keys optional; non-positive / non-int dropped. */
export function normalizeQuotas(quotas) {
  if (!quotas || typeof quotas !== "object") return null;
  const pick = (v) => (Number.isSafeInteger(v) && v > 0 ? v : undefined);
  const out = {
    rpm: pick(quotas.rpm),
    tokensPerDay: pick(quotas.tokensPerDay),
    concurrency: pick(quotas.concurrency),
  };
  const hasAny = Object.values(out).some((v) => v !== undefined);
  return hasAny ? out : null;
}

/**
 * Case-insensitive exact membership test.
 * Model/provider ids in this repo are treated case-insensitively because the
 * registry is not guaranteed to preserve client casing.
 */
function includesExact(list, candidates) {
  const lowered = list.map((entry) => entry.toLowerCase());
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) continue;
    if (lowered.includes(candidate.toLowerCase())) return true;
  }
  return false;
}

/**
 * Apply one rule dimension.
 * @returns {"allowed"|"denied"|"unrestricted"}
 */
function applyRule(rule, candidates) {
  if (!rule) return "unrestricted";
  const hit = includesExact(rule.list, candidates);
  if (rule.mode === POLICY_MODE.DENY) return hit ? "denied" : "allowed";
  // allow mode
  return hit ? "allowed" : "denied";
}

/**
 * Collect every spelling of the model that should be matchable against a
 * model rule: the raw client string (which may be an alias) and the resolved
 * `provider/model` pair.
 */
function modelCandidates({ requestedModel, resolvedProvider, resolvedModel, providerAliases }) {
  const out = [];
  if (requestedModel) out.push(requestedModel);
  if (resolvedModel) out.push(resolvedModel);
  if (resolvedProvider && resolvedModel) out.push(`${resolvedProvider}/${resolvedModel}`);

  // The same model is reachable under every provider spelling, and /v1/models
  // advertises the public alias form (e.g. `cx/gpt-6-astra`) while a user may
  // have allowed the registry-id form (`codex/gpt-6-astra`). Try each prefix so
  // a model allowlisted in either form matches either way.
  if (resolvedModel && Array.isArray(providerAliases) && providerAliases.length) {
    for (const alias of providerAliases) {
      if (alias) out.push(`${alias}/${resolvedModel}`);
    }
  }
  return out;
}

/**
 * Collect provider spellings. Matches both the internal registry id and the
 * public alias/prefix used in /v1/models ids, per the fork's decision.
 */
function providerCandidates({ resolvedProvider, providerAliases }) {
  const out = [];
  if (resolvedProvider) out.push(resolvedProvider);
  for (const alias of providerAliases || []) {
    if (alias) out.push(alias);
  }
  return out;
}

/**
 * Evaluate model + provider + combo rules for a request.
 *
 * @param {object|null} policy            Raw or normalized policy.
 * @param {object} ctx
 * @param {string} [ctx.requestedModel]   Exact model string the client sent.
 * @param {string} [ctx.resolvedProvider] Internal provider id.
 * @param {string} [ctx.resolvedModel]    Bare model id (no provider prefix).
 * @param {string[]} [ctx.providerAliases] Additional provider spellings.
 * @param {string} [ctx.comboName]        Set when the request targets a combo.
 * @returns {{allowed: boolean, code: string, reason: string|null}}
 */
export function evaluatePolicy(policy, ctx = {}) {
  const normalized = policy && policy.__normalized ? policy : normalizePolicy(policy);
  if (!normalized) {
    return { allowed: true, code: POLICY_CODE.OK, reason: null };
  }
  if (!normalized.enabled) {
    return { allowed: true, code: POLICY_CODE.DISABLED, reason: null };
  }

  const {
    requestedModel,
    resolvedProvider,
    resolvedModel,
    providerAliases,
    comboName,
    skipModelRule = false,
  } = ctx;

  // --- provider dimension -------------------------------------------------
  // Skipped when the request targets a combo by name: a combo has no single
  // provider, and its members are evaluated individually via
  // evaluateComboMember(), where the provider rule IS authoritative.
  if (!comboName) {
    const providerVerdict = applyRule(
      normalized.providers,
      providerCandidates({ resolvedProvider, providerAliases })
    );
    if (providerVerdict === "denied") {
      return {
        allowed: false,
        code: POLICY_CODE.PROVIDER_NOT_ALLOWED,
        reason: `Provider "${resolvedProvider || requestedModel || "unknown"}" is not allowed for this API key`,
      };
    }
  }

  // --- combo dimension ----------------------------------------------------
  // When the request targets a combo, the combo rule is the authority for
  // model access: an allowed combo grants its expanded members, so the model
  // allowlist is intentionally NOT re-checked here. Provider rules already ran.
  if (comboName) {
    if (normalized.combos) {
      const comboVerdict = applyRule(normalized.combos, [comboName]);
      if (comboVerdict === "denied") {
        return {
          allowed: false,
          code: POLICY_CODE.COMBO_NOT_ALLOWED,
          reason: `Combo "${comboName}" is not allowed for this API key`,
        };
      }
      return { allowed: true, code: POLICY_CODE.OK, reason: null };
    }
    // No combo rule configured. A model allowlist must not silently block a
    // combo whose name is not a model id, so fall through to the combo's
    // expanded members, which are evaluated individually by the caller via
    // evaluateComboMember().
    return { allowed: true, code: POLICY_CODE.OK, reason: null };
  }

  // --- model dimension ----------------------------------------------------
  // Skipped for modalities where the provider IS the model (search/fetch,
  // video polling): a model rule has no meaning there, and applying one would
  // wrongly block every request.
  if (skipModelRule) {
    return { allowed: true, code: POLICY_CODE.OK, reason: null };
  }

  const modelVerdict = applyRule(
    normalized.models,
    modelCandidates({ requestedModel, resolvedProvider, resolvedModel, providerAliases })
  );
  if (modelVerdict === "denied") {
    return {
      allowed: false,
      code: POLICY_CODE.MODEL_NOT_ALLOWED,
      reason: `Model "${requestedModel || resolvedModel || "unknown"}" is not allowed for this API key`,
    };
  }

  return { allowed: true, code: POLICY_CODE.OK, reason: null };
}

/**
 * Evaluate an individual expanded combo member (a `provider/model` string).
 *
 * Called by the chat handler for each member of an allowed combo. Provider
 * rules are authoritative here; model rules only apply when the key has a
 * model rule AND no combo rule (a combo rule already granted its members).
 *
 * @param {object|null} policy
 * @param {string} memberStr e.g. "kiro/claude-opus-4.8"
 * @param {object} [resolved] optional pre-resolved { provider, model, aliases }
 * @returns {{allowed: boolean, code: string, reason: string|null}}
 */
export function evaluateComboMember(policy, memberStr, resolved = {}) {
  const normalized = policy && policy.__normalized ? policy : normalizePolicy(policy);
  if (!normalized || !normalized.enabled) {
    return { allowed: true, code: POLICY_CODE.OK, reason: null };
  }

  const slash = typeof memberStr === "string" ? memberStr.indexOf("/") : -1;
  const derivedProvider = slash > 0 ? memberStr.slice(0, slash) : undefined;
  const derivedModel = slash > 0 ? memberStr.slice(slash + 1) : memberStr;

  const resolvedProvider = resolved.provider || derivedProvider;
  const resolvedModel = resolved.model || derivedModel;

  const providerVerdict = applyRule(
    normalized.providers,
    providerCandidates({ resolvedProvider, providerAliases: resolved.aliases })
  );
  if (providerVerdict === "denied") {
    return {
      allowed: false,
      code: POLICY_CODE.PROVIDER_NOT_ALLOWED,
      reason: `Provider "${resolvedProvider || memberStr}" is not allowed for this API key`,
    };
  }

  // A combo rule already granted this combo's members — do not re-apply the
  // model allowlist on top, or every member would be blocked.
  if (normalized.combos) {
    return { allowed: true, code: POLICY_CODE.OK, reason: null };
  }

  const modelVerdict = applyRule(
    normalized.models,
    modelCandidates({ requestedModel: memberStr, resolvedProvider, resolvedModel, providerAliases: resolved.aliases })
  );
  if (modelVerdict === "denied") {
    return {
      allowed: false,
      code: POLICY_CODE.MODEL_NOT_ALLOWED,
      reason: `Model "${memberStr}" is not allowed for this API key`,
    };
  }

  return { allowed: true, code: POLICY_CODE.OK, reason: null };
}

/**
 * Whether a policy restricts anything at all. Used by /v1/models filtering to
 * skip work for unrestricted keys.
 */
export function policyIsRestrictive(policy) {
  const normalized = policy && policy.__normalized ? policy : normalizePolicy(policy);
  if (!normalized || !normalized.enabled) return false;
  return Boolean(normalized.models || normalized.providers || normalized.combos);
}

/**
 * Filter a list of model ids for a single key. Used by /v1/models.
 *
 * Each entry describes one catalog row:
 *   { id, provider?, isCombo?, modelRefs?, aliases? }
 * where `modelRefs` are extra spellings a model rule may match (bare id,
 * `provider/model`) and `aliases` are extra PROVIDER spellings.
 *
 * @param {object|null} policy
 * @param {{id: string, provider?: string, isCombo?: boolean, modelRefs?: string[], aliases?: string[]}[]} entries
 */
export function filterModelEntries(policy, entries) {
  const normalized = policy && policy.__normalized ? policy : normalizePolicy(policy);
  if (!normalized || !normalized.enabled) return entries;
  if (!normalized.models && !normalized.providers && !normalized.combos) return entries;

  return entries.filter((entry) => {
    if (!entry) return false;

    if (entry.isCombo) {
      if (normalized.combos) {
        const verdict = applyRule(normalized.combos, [entry.id]);
        if (verdict === "denied") return false;
      }
      const providerVerdict = applyRule(
        normalized.providers,
        providerCandidates({ resolvedProvider: entry.provider, providerAliases: entry.aliases })
      );
      return providerVerdict !== "denied";
    }

    const modelVerdict = applyRule(normalized.models, [entry.id, ...(entry.modelRefs || [])]);
    if (modelVerdict === "denied") return false;

    const providerVerdict = applyRule(
      normalized.providers,
      providerCandidates({ resolvedProvider: entry.provider, providerAliases: entry.aliases })
    );
    if (providerVerdict === "denied") return false;

    return true;
  });
}

/** Build an empty/default policy object (used by the UI and API). */
export function emptyPolicy() {
  return {
    enabled: true,
    models: { mode: POLICY_MODE.ALLOW, list: [] },
    providers: { mode: POLICY_MODE.ALLOW, list: [] },
    combos: { mode: POLICY_MODE.ALLOW, list: [] },
    quotas: { rpm: null, tokensPerDay: null, concurrency: null },
  };
}
