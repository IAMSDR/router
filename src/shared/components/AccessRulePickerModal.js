"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Input from "./Input";
import ProviderIcon from "./ProviderIcon";
import {
  AI_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
} from "@/shared/constants/providers";

// Provider order matches the rest of the dashboard: OAuth, free, free tier, api key.
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

function orderProviders(ids) {
  const rank = new Map(PROVIDER_ORDER.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
}

/**
 * Multi-select picker for providers or combos, used by the per-key access
 * policy editor. Mirrors the look & feel of ModelSelectModal (search + grouped
 * grid + selected state) so all three dimensions of a policy select the same way.
 *
 * @param {"providers"|"combos"} kind
 */
export default function AccessRulePickerModal({
  isOpen,
  onClose,
  onToggle,
  kind = "providers",
  selected = [],
  title,
  subtitle,
}) {
  const [search, setSearch] = useState("");
  const [combos, setCombos] = useState([]);
  const [loadingCombos, setLoadingCombos] = useState(false);

  useEffect(() => {
    if (!isOpen || kind !== "combos") return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setLoadingCombos(true);
        return fetch("/api/combos", { cache: "no-store" });
      })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setCombos(d.combos || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingCombos(false); });
    return () => { cancelled = true; };
  }, [isOpen, kind]);

  const selectedLower = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);

  const providerItems = useMemo(() => {
    return orderProviders(Object.keys(AI_PROVIDERS)).map((id) => {
      const p = AI_PROVIDERS[id];
      return {
        id,
        label: p?.name || id,
        // The engine matches a provider by its registry id OR its alias, so we
        // store the canonical id and show the alias only when it differs.
        sublabel: p?.alias && p.alias !== id ? `${id} · ${p.alias}` : id,
        value: id,
        iconId: id,
      };
    });
  }, []);

  const comboItems = useMemo(
    () => combos.map((c) => ({ id: c.name, label: c.name, sublabel: `${(c.models || []).length} models`, value: c.name })),
    [combos]
  );

  const items = kind === "providers" ? providerItems : comboItems;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        it.id.toLowerCase().includes(q) ||
        (it.sublabel || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const isSelected = (item) => selectedLower.has(item.value.toLowerCase());

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || (kind === "providers" ? "Select Providers" : "Select Combos")}
      size="lg"
    >
      <div className="flex flex-col gap-3">
        {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}

        <Input
          icon="search"
          placeholder={kind === "providers" ? "Search providers..." : "Search combos..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((value) => (
              <span
                key={value}
                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[11px] text-primary"
              >
                {value}
                <button
                  onClick={() => onToggle(value)}
                  className="hover:text-red-500 transition-colors"
                  title="Remove"
                >
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="max-h-[50vh] sm:max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {kind === "combos" && loadingCombos ? (
            <p className="text-xs text-text-muted text-center py-8">Loading combos...</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-border rounded-lg">
              <span className="material-symbols-outlined text-text-muted text-2xl mb-1">
                {kind === "providers" ? "dns" : "layers"}
              </span>
              <p className="text-xs text-text-muted">
                {kind === "combos" && combos.length === 0
                  ? "No combos yet — create one on the Combos page."
                  : "Nothing matches your search."}
              </p>
            </div>
          ) : kind === "providers" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {filtered.map((item) => {
                const active = isSelected(item);
                return (
                  <button
                    key={item.id}
                    onClick={() => onToggle(item.value)}
                    className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                      active
                        ? "border-primary/50 bg-primary/10"
                        : "border-border hover:bg-sidebar/50"
                    }`}
                  >
                    <ProviderIcon providerId={item.iconId} size={24} fallbackText={(item.label || "?")[0]} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-main">{item.label}</p>
                      <p className="truncate font-mono text-[10px] text-text-muted">{item.sublabel}</p>
                    </div>
                    {active && (
                      <span className="material-symbols-outlined text-[18px] text-primary shrink-0">check_circle</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.map((item) => {
                const active = isSelected(item);
                return (
                  <button
                    key={item.id}
                    onClick={() => onToggle(item.value)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-primary/50 bg-primary/10"
                        : "border-border hover:bg-sidebar/50"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px] text-text-muted shrink-0">layers</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm text-text-main">{item.label}</p>
                      <p className="text-[10px] text-text-muted">{item.sublabel}</p>
                    </div>
                    {active && (
                      <span className="material-symbols-outlined text-[18px] text-primary shrink-0">check_circle</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

AccessRulePickerModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onToggle: PropTypes.func.isRequired,
  kind: PropTypes.oneOf(["providers", "combos"]),
  selected: PropTypes.arrayOf(PropTypes.string),
  title: PropTypes.string,
  subtitle: PropTypes.string,
};
