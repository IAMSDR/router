import { describe, expect, it } from "vitest";
import {
  normalizePolicy,
  normalizeQuotas,
  evaluatePolicy,
  evaluateComboMember,
  filterModelEntries,
  policyIsRestrictive,
  emptyPolicy,
  POLICY_CODE,
} from "../../src/shared/utils/apiKeyPolicy.js";

const allow = (list) => ({ mode: "allow", list });
const deny = (list) => ({ mode: "deny", list });

describe("normalizePolicy", () => {
  it("returns null for empty / non-object / no-rule policies", () => {
    expect(normalizePolicy(null)).toBeNull();
    expect(normalizePolicy(undefined)).toBeNull();
    expect(normalizePolicy("nope")).toBeNull();
    expect(normalizePolicy({ enabled: true })).toBeNull();
    expect(normalizePolicy({ models: allow([]) })).toBeNull();
  });

  it("drops empty dimensions and keeps populated ones", () => {
    const p = normalizePolicy({
      enabled: true,
      models: allow(["kiro/x"]),
      providers: allow([]),
      combos: allow([]),
    });
    expect(p.models.list).toEqual(["kiro/x"]);
    expect(p.providers).toBeNull();
    expect(p.combos).toBeNull();
  });

  it("defaults an invalid mode to allow rather than widening access", () => {
    const p = normalizePolicy({ models: { mode: "bogus", list: ["m"] } });
    expect(p.models.mode).toBe("allow");
  });

  it("trims list entries and drops non-strings / blanks", () => {
    const p = normalizePolicy({ models: allow(["  kiro/x  ", "", 42, null, "y"]) });
    expect(p.models.list).toEqual(["kiro/x", "y"]);
  });
});

describe("normalizeQuotas", () => {
  it("keeps only positive safe integers", () => {
    expect(normalizeQuotas({ rpm: 60, tokensPerDay: -1, concurrency: 0 })).toEqual({ rpm: 60, tokensPerDay: undefined, concurrency: undefined });
  });

  it("returns null when nothing usable is set", () => {
    expect(normalizeQuotas({})).toBeNull();
    expect(normalizeQuotas({ rpm: "60" })).toBeNull();
    expect(normalizeQuotas(null)).toBeNull();
  });
});

describe("evaluatePolicy — no policy", () => {
  it("allows everything when the policy is absent", () => {
    expect(evaluatePolicy(null, { requestedModel: "anything", resolvedProvider: "x" })).toEqual({
      allowed: true,
      code: POLICY_CODE.OK,
      reason: null,
    });
  });

  it("allows everything when the policy is disabled", () => {
    const p = normalizePolicy({ enabled: false, models: allow(["only-this"]) });
    const verdict = evaluatePolicy(p, { requestedModel: "other" });
    expect(verdict.allowed).toBe(true);
    expect(verdict.code).toBe(POLICY_CODE.DISABLED);
  });
});

describe("evaluatePolicy — model rules (exact matching only)", () => {
  const p = normalizePolicy({ models: allow(["kiro/claude-opus-4.8", "sonnet"]) });

  it("allows an exact model id", () => {
    expect(evaluatePolicy(p, { requestedModel: "kiro/claude-opus-4.8" }).allowed).toBe(true);
  });

  it("allows an exact alias", () => {
    expect(evaluatePolicy(p, { requestedModel: "sonnet" }).allowed).toBe(true);
  });

  it("allows when the resolved provider/model matches even if the alias does not", () => {
    const verdict = evaluatePolicy(p, {
      requestedModel: "my-alias",
      resolvedProvider: "kiro",
      resolvedModel: "claude-opus-4.8",
    });
    expect(verdict.allowed).toBe(true);
  });

  it("rejects a non-listed model", () => {
    const verdict = evaluatePolicy(p, { requestedModel: "gpt-5" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe(POLICY_CODE.MODEL_NOT_ALLOWED);
  });

  it("does NOT treat a prefix as a match (no globbing)", () => {
    const prefixed = normalizePolicy({ models: allow(["claude-"]) });
    expect(evaluatePolicy(prefixed, { requestedModel: "claude-opus-4.8" }).allowed).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(evaluatePolicy(p, { requestedModel: "SONNET" }).allowed).toBe(true);
  });
});

describe("evaluatePolicy — deny mode", () => {
  it("denies a listed model and allows others", () => {
    const p = normalizePolicy({ models: deny(["gpt-5"]) });
    expect(evaluatePolicy(p, { requestedModel: "gpt-5" }).allowed).toBe(false);
    expect(evaluatePolicy(p, { requestedModel: "sonnet" }).allowed).toBe(true);
  });
});

describe("evaluatePolicy — provider rules", () => {
  const p = normalizePolicy({ providers: allow(["kiro"]) });

  it("allows a listed provider id", () => {
    expect(evaluatePolicy(p, { requestedModel: "m", resolvedProvider: "kiro" }).allowed).toBe(true);
  });

  it("allows a match via a provider alias", () => {
    const verdict = evaluatePolicy(p, {
      requestedModel: "m",
      resolvedProvider: "kiro-internal",
      providerAliases: ["kiro"],
    });
    expect(verdict.allowed).toBe(true);
  });

  it("rejects an unlisted provider", () => {
    expect(evaluatePolicy(p, { requestedModel: "m", resolvedProvider: "openai" }).code).toBe(POLICY_CODE.PROVIDER_NOT_ALLOWED);
  });

  it("provider deny overrides an allowed model (intersection)", () => {
    const both = normalizePolicy({ models: allow(["openai/gpt-5"]), providers: deny(["openai"]) });
    expect(evaluatePolicy(both, { requestedModel: "openai/gpt-5", resolvedProvider: "openai" }).allowed).toBe(false);
  });
});

describe("evaluatePolicy — combos", () => {
  it("enforces the combo allowlist", () => {
    const p = normalizePolicy({ combos: allow(["cheap"]) });
    expect(evaluatePolicy(p, { comboName: "cheap" }).allowed).toBe(true);
    expect(evaluatePolicy(p, { comboName: "expensive" }).code).toBe(POLICY_CODE.COMBO_NOT_ALLOWED);
  });

  it("an allowed combo grants its members without re-checking the model allowlist", () => {
    const p = normalizePolicy({ models: allow(["nothing-matches"]), combos: allow(["cheap"]) });
    expect(evaluatePolicy(p, { comboName: "cheap" }).allowed).toBe(true);
    expect(evaluateComboMember(p, "kiro/anything").allowed).toBe(true);
  });

  it("skips the provider check for a combo name (no single provider)", () => {
    const p = normalizePolicy({ providers: allow(["kiro"]), combos: allow(["cheap"]) });
    expect(evaluatePolicy(p, { comboName: "cheap" }).allowed).toBe(true);
  });

  it("with no combo rule, a model allowlist blocks non-matching members", () => {
    const p = normalizePolicy({ models: allow(["kiro/ok"]) });
    expect(evaluatePolicy(p, { comboName: "any" }).allowed).toBe(true);
    expect(evaluateComboMember(p, "kiro/ok").allowed).toBe(true);
    expect(evaluateComboMember(p, "kiro/nope").allowed).toBe(false);
  });
});

describe("evaluateComboMember", () => {
  it("blocks a member whose provider is denied even when the combo is allowed", () => {
    const p = normalizePolicy({ providers: deny(["openai"]), combos: allow(["cheap"]) });
    expect(evaluateComboMember(p, "openai/gpt-5").allowed).toBe(false);
    expect(evaluateComboMember(p, "kiro/x").allowed).toBe(true);
  });

  it("is unrestricted when there is no policy", () => {
    expect(evaluateComboMember(null, "anything/here").allowed).toBe(true);
  });
});

describe("evaluatePolicy — providerOnly (search/fetch/video)", () => {
  it("skips model rules so a model allowlist cannot block a provider-addressed request", () => {
    const p = normalizePolicy({ models: allow(["kiro/x"]), providers: allow(["exa"]) });
    const verdict = evaluatePolicy(p, { skipModelRule: true, resolvedProvider: "exa" });
    expect(verdict.allowed).toBe(true);
  });

  it("still enforces the provider rule", () => {
    const p = normalizePolicy({ providers: allow(["exa"]) });
    expect(evaluatePolicy(p, { skipModelRule: true, resolvedProvider: "tavily" }).code).toBe(POLICY_CODE.PROVIDER_NOT_ALLOWED);
  });
});

describe("filterModelEntries", () => {
  const p = normalizePolicy({
    models: allow(["claude-opus-4.8"]),
    providers: deny(["openai"]),
    combos: allow(["cheap"]),
  });
  const entries = [
    { id: "kiro/claude-opus-4.8", provider: "kiro", isCombo: false, modelRefs: ["claude-opus-4.8", "kiro/claude-opus-4.8"] },
    { id: "openai/gpt-5", provider: "openai", isCombo: false, modelRefs: ["gpt-5", "openai/gpt-5"] },
    { id: "kiro/other", provider: "kiro", isCombo: false, modelRefs: ["other", "kiro/other"] },
    { id: "cheap", provider: "combo", isCombo: true },
    { id: "expensive", provider: "combo", isCombo: true },
  ];

  it("keeps only allowed models and combos", () => {
    expect(filterModelEntries(p, entries).map((e) => e.id)).toEqual(["kiro/claude-opus-4.8", "cheap"]);
  });

  it("returns the list unchanged when the policy is absent or empty", () => {
    expect(filterModelEntries(null, entries)).toEqual(entries);
    expect(filterModelEntries(normalizePolicy({ enabled: true }), entries)).toEqual(entries);
  });
});

describe("policyIsRestrictive / emptyPolicy", () => {
  it("reports restrictive only for enabled policies with rules", () => {
    expect(policyIsRestrictive(null)).toBe(false);
    expect(policyIsRestrictive(normalizePolicy({ enabled: false, models: allow(["x"]) }))).toBe(false);
    expect(policyIsRestrictive(normalizePolicy({ models: allow(["x"]) }))).toBe(true);
  });

  it("emptyPolicy has the documented shape", () => {
    const p = emptyPolicy();
    expect(p.models).toEqual({ mode: "allow", list: [] });
    expect(p.providers).toEqual({ mode: "allow", list: [] });
    expect(p.combos).toEqual({ mode: "allow", list: [] });
    expect(p.quotas).toEqual({ rpm: null, tokensPerDay: null, concurrency: null });
  });
});

// Regression: a request addressed by a provider ALIAS prefix (or the catalog's
// alias-form id) must match a policy written with the canonical provider id,
// and vice-versa. Found live: allowing `codex/gpt-6-astra` blocked the catalog
// id `cx/gpt-6-astra`, which is the exact id the picker offers.
describe("provider alias / id equivalence", () => {
  it("matches a provider allowlist written with the canonical id against an alias prefix", () => {
    const p = normalizePolicy({ providers: allow(["codex"]) });
    const verdict = evaluatePolicy(p, { requestedModel: "cx/gpt-6-astra", providerAliases: ["cx", "codex"] });
    expect(verdict.allowed).toBe(true);
  });

  it("matches a model allowlist written canonically against the alias-prefixed id", () => {
    const p = normalizePolicy({ models: allow(["codex/gpt-6-astra"]) });
    const verdict = evaluatePolicy(p, {
      requestedModel: "cx/gpt-6-astra",
      resolvedProvider: "codex",
      resolvedModel: "gpt-6-astra",
      providerAliases: ["codex", "cx"],
    });
    expect(verdict.allowed).toBe(true);
  });

  it("still blocks a model that is not in the allowlist under either spelling", () => {
    const p = normalizePolicy({ models: allow(["codex/gpt-6-astra"]) });
    const verdict = evaluatePolicy(p, {
      requestedModel: "cx/gpt-5",
      resolvedProvider: "codex",
      resolvedModel: "gpt-5",
      providerAliases: ["codex", "cx"],
    });
    expect(verdict.allowed).toBe(false);
  });

  it("applies the same equivalence to combo members", () => {
    const p = normalizePolicy({ providers: deny(["openai"]) });
    expect(evaluateComboMember(p, "oa/gpt-5", { provider: "openai", model: "gpt-5", aliases: ["openai", "oa"] }).allowed).toBe(false);
    expect(evaluateComboMember(p, "cx/gpt-6-astra", { provider: "codex", model: "gpt-6-astra", aliases: ["codex", "cx"] }).allowed).toBe(true);
  });
});
