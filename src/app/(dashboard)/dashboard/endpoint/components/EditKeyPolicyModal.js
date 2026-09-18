"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input, Toggle } from "@/shared/components";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import AccessRulePickerModal from "@/shared/components/AccessRulePickerModal";

// Per-dimension access mode. "any" is the default and means the dimension is
// not restricted at all — an empty allowlist must never block everything.
const MODE = { ANY: "any", ALLOW: "allow", DENY: "deny" };

const DIMENSIONS = [
  {
    key: "models",
    title: "Models",
    icon: "smart_toy",
    anyLabel: "Any model",
    anyHint: "All models are available with this key.",
    allowHint: "Only the listed models can be used. Everything else is blocked.",
    denyHint: "The listed models are blocked. Everything else is available.",
    pickerLabel: "model",
  },
  {
    key: "providers",
    title: "Providers",
    icon: "dns",
    anyLabel: "Any provider",
    anyHint: "All providers are available with this key.",
    allowHint: "Only the listed providers can be used.",
    denyHint: "The listed providers are blocked.",
    pickerLabel: "provider",
  },
  {
    key: "combos",
    title: "Combos",
    icon: "layers",
    anyLabel: "Any combo",
    anyHint: "All combos are available with this key.",
    allowHint: "Only the listed combos can be used. An allowed combo also grants its member models.",
    denyHint: "The listed combos are blocked.",
    pickerLabel: "combo",
  },
];

const QUOTA_FIELDS = [
  { key: "rpm", label: "Requests / minute", hint: "Rolling 60-second window" },
  { key: "tokensPerDay", label: "Tokens / day", hint: "Resets at local midnight" },
  { key: "concurrency", label: "Max concurrent", hint: "In-flight requests at once" },
];

const emptyRule = () => ({ mode: MODE.ANY, list: [] });

/** Map the stored rule shape to UI state. An absent rule => "any". */
function ruleFromPolicy(rule) {
  if (!rule || !Array.isArray(rule.list) || rule.list.length === 0) return emptyRule();
  return { mode: rule.mode === "deny" ? MODE.DENY : MODE.ALLOW, list: [...rule.list] };
}

/** Map UI state back to the persisted rule shape. */
function ruleToPayload(rule) {
  if (rule.mode === MODE.ANY || rule.list.length === 0) {
    return { mode: MODE.ALLOW, list: [] };
  }
  return { mode: rule.mode, list: rule.list };
}

function DimensionSection({ dim, rule, onChangeMode, onOpenPicker, onRemove }) {
  const modeOptions = [
    { value: MODE.ANY, label: dim.anyLabel, icon: "public" },
    { value: MODE.ALLOW, label: "Allow only", icon: "check_circle" },
    { value: MODE.DENY, label: "Deny", icon: "block" },
  ];
  const activeHint = rule.mode === MODE.ALLOW ? dim.allowHint : rule.mode === MODE.DENY ? dim.denyHint : dim.anyHint;

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[18px] text-text-muted">{dim.icon}</span>
          <span className="text-sm font-semibold text-text-main">{dim.title}</span>
          {rule.mode !== MODE.ANY && rule.list.length > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {rule.list.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-3 p-0.5">
          {modeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChangeMode(opt.value)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                rule.mode === opt.value
                  ? "bg-surface text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">{opt.icon}</span>
              <span className="hidden sm:inline">{opt.label}</span>
              <span className="sm:hidden">{opt.value === MODE.ANY ? "Any" : opt.value === MODE.ALLOW ? "Only" : "Deny"}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-[11px] text-text-muted mb-2">{activeHint}</p>

        {rule.mode !== MODE.ANY && (
          <>
            {rule.list.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {rule.list.map((value) => (
                  <span
                    key={value}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] ${
                      rule.mode === MODE.DENY
                        ? "border-red-500/30 bg-red-500/10 text-red-500"
                        : "border-primary/30 bg-primary/10 text-primary"
                    }`}
                  >
                    {value}
                    <button onClick={() => onRemove(value)} className="hover:text-red-500 transition-colors" title="Remove">
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mb-2 text-[11px] italic text-text-muted">
                Nothing selected yet — this key is still unrestricted here.
              </p>
            )}

            <button
              onClick={onOpenPicker}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary/50"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              Add {dim.pickerLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

DimensionSection.propTypes = {
  dim: PropTypes.object.isRequired,
  rule: PropTypes.object.isRequired,
  onChangeMode: PropTypes.func.isRequired,
  onOpenPicker: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

export default function EditKeyPolicyModal({ isOpen, onClose, apiKey, activeProviders = [], onSaved }) {
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState({
    models: emptyRule(),
    providers: emptyRule(),
    combos: emptyRule(),
  });
  const [quotas, setQuotas] = useState({ rpm: "", tokensPerDay: "", concurrency: "" });
  const [showQuotas, setShowQuotas] = useState(false);
  const [picker, setPicker] = useState(null); // "models" | "providers" | "combos" | null
  const [modelAliases, setModelAliases] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load the existing policy when the modal opens.
  useEffect(() => {
    if (!isOpen || !apiKey?.id) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setLoading(true);
        setError(null);
        return fetch(`/api/keys/${apiKey.id}/policy`, { cache: "no-store" });
      })
      .then((res) => (res ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const policy = data?.policy || {};
        setEnabled(policy.enabled !== false);
        setRules({
          models: ruleFromPolicy(policy.models),
          providers: ruleFromPolicy(policy.providers),
          combos: ruleFromPolicy(policy.combos),
        });
        const q = policy.quotas || {};
        setQuotas({
          rpm: q.rpm ? String(q.rpm) : "",
          tokensPerDay: q.tokensPerDay ? String(q.tokensPerDay) : "",
          concurrency: q.concurrency ? String(q.concurrency) : "",
        });
        setShowQuotas(Boolean(q.rpm || q.tokensPerDay || q.concurrency));
      })
      .catch(() => { if (!cancelled) setError("Failed to load policy"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, apiKey?.id]);

  // Alias map for the shared model picker (matches the combo editor).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch("/api/models/alias")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setModelAliases(d.aliases || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen]);

  const setMode = (dim, mode) => {
    setRules((prev) => ({ ...prev, [dim]: { ...prev[dim], mode } }));
  };

  const toggleValue = (dim, value) => {
    if (!value) return;
    setRules((prev) => {
      const current = prev[dim];
      const exists = current.list.includes(value);
      const list = exists ? current.list.filter((v) => v !== value) : [...current.list, value];
      return { ...prev, [dim]: { ...current, list } };
    });
  };

  const removeValue = (dim, value) => {
    setRules((prev) => ({ ...prev, [dim]: { ...prev[dim], list: prev[dim].list.filter((v) => v !== value) } }));
  };

  const hasAnyRestriction = useMemo(() => {
    const ruleActive = Object.values(rules).some((r) => r.mode !== MODE.ANY && r.list.length > 0);
    const quotaActive = Object.values(quotas).some((v) => String(v).trim() !== "");
    return ruleActive || quotaActive;
  }, [rules, quotas]);

  const handleSave = async () => {
    if (!apiKey?.id) return;
    setSaving(true);
    setError(null);
    try {
      const toInt = (v) => {
        const n = Number.parseInt(v, 10);
        return Number.isSafeInteger(n) && n > 0 ? n : null;
      };
      const payload = {
        enabled,
        models: ruleToPayload(rules.models),
        providers: ruleToPayload(rules.providers),
        combos: ruleToPayload(rules.combos),
        quotas: {
          rpm: toInt(quotas.rpm),
          tokensPerDay: toInt(quotas.tokensPerDay),
          concurrency: toInt(quotas.concurrency),
        },
      };
      const res = await fetch(`/api/keys/${apiKey.id}/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to save policy");
        return;
      }
      onSaved?.(data);
      onClose();
    } catch (err) {
      console.error("Save key policy error:", err);
      setError("Failed to save policy");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!apiKey?.id) return;
    if (!confirm(`Remove all restrictions from "${apiKey.name}"? It will be able to use everything.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/keys/${apiKey.id}/policy`, { method: "DELETE" });
      if (res.ok) {
        onSaved?.({ restricted: false });
        onClose();
      } else {
        const data = await res.json();
        setError(data?.error || "Failed to clear policy");
      }
    } catch {
      setError("Failed to clear policy");
    } finally {
      setSaving(false);
    }
  };

  const selectedForPicker = picker ? rules[picker].list : [];
  const pickerDim = picker ? DIMENSIONS.find((d) => d.key === picker) : null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Access Policy — ${apiKey?.name || "API Key"}`}
        size="xl"
      >
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
            <p className="text-xs text-text-muted">
              Everything is allowed by default. Restrict only what you need — a blocked request fails
              immediately, and the gateway never silently falls back to another model or provider.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-main">Enforce this policy</p>
              <p className="text-[11px] text-text-muted">
                Turn off to keep the rules below but stop enforcing them for this key.
              </p>
            </div>
            <Toggle checked={enabled} onChange={setEnabled} />
          </div>

          <div className="flex flex-col gap-2.5">
            {DIMENSIONS.map((dim) => (
              <DimensionSection
                key={dim.key}
                dim={dim}
                rule={rules[dim.key]}
                onChangeMode={(mode) => setMode(dim.key, mode)}
                onOpenPicker={() => setPicker(dim.key)}
                onRemove={(value) => removeValue(dim.key, value)}
              />
            ))}
          </div>

          {/* Quotas — collapsed by default, hidden entirely until wanted. */}
          <div className="rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => setShowQuotas((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-sidebar/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-text-muted">speed</span>
                <span className="text-sm font-semibold text-text-main">Rate limits &amp; quotas</span>
                <span className="text-[10px] text-text-muted">optional</span>
              </div>
              <span className="material-symbols-outlined text-[18px] text-text-muted">
                {showQuotas ? "expand_less" : "expand_more"}
              </span>
            </button>
            {showQuotas && (
              <div className="border-t border-border/60 px-3 py-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {QUOTA_FIELDS.map((f) => (
                    <Input
                      key={f.key}
                      label={f.label}
                      type="number"
                      min="1"
                      value={quotas[f.key]}
                      onChange={(e) => setQuotas((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder="Unlimited"
                      hint={f.hint}
                    />
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-text-muted">
                  Leave blank for unlimited. Token quota resets at local midnight, and denied requests
                  do not count toward these limits.
                </p>
              </div>
            )}
          </div>

          <div className="mt-1 flex flex-col-reverse items-stretch justify-between gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClear}
              disabled={saving || loading}
              className="text-red-500 hover:bg-red-500/10 hover:text-red-600"
            >
              Remove Restrictions
            </Button>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={onClose} disabled={saving} className="flex-1 sm:flex-none">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || loading || !enabled || !hasAnyRestriction}
                className="flex-1 sm:flex-none"
              >
                {saving ? "Saving..." : "Save Policy"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Model picker — reuses the same UI as the combo editor. */}
      {picker === "models" && (
        <ModelSelectModal
          isOpen
          onClose={() => setPicker(null)}
          onSelect={(model) => toggleValue("models", model?.value)}
          onDeselect={(model) => toggleValue("models", model?.value)}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Add Model to Allowlist"
          addedModelValues={rules.models.list}
          closeOnSelect={false}
        />
      )}

      {picker === "providers" && (
        <AccessRulePickerModal
          isOpen
          kind="providers"
          onClose={() => setPicker(null)}
          onToggle={(value) => toggleValue("providers", value)}
          selected={selectedForPicker}
          title="Select Providers"
          subtitle={pickerDim?.allowHint}
        />
      )}

      {picker === "combos" && (
        <AccessRulePickerModal
          isOpen
          kind="combos"
          onClose={() => setPicker(null)}
          onToggle={(value) => toggleValue("combos", value)}
          selected={selectedForPicker}
          title="Select Combos"
          subtitle={pickerDim?.allowHint}
        />
      )}
    </>
  );
}

EditKeyPolicyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  apiKey: PropTypes.object,
  activeProviders: PropTypes.array,
  onSaved: PropTypes.func,
};
