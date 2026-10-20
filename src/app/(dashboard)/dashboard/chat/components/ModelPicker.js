"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, ALIAS_TO_ID } from "@/shared/constants/providers";
import { matchesSearch, parseSearchQuery } from "@/shared/utils/modelSearchFilter";
import { humanize } from "./chatUtils";

/**
 * Turn model rows into callable entries. Accepts both shapes:
 * - /v1/models entries: { id: "alias/model", owned_by: "alias", ... } (id is the request id)
 * - /api/models rows: { routedModel, fullModel, provider, model, alias, ... }
 * Combo entries (owned_by === "combo") are skipped — combos arrive via the combos prop.
 */
function normalizeModels(models) {
  return (models || [])
    .filter((m) => m && m.owned_by !== "combo")
    .map((m) => {
      const id = m.id || m.routedModel || m.fullModel || (m.provider && m.model ? `${m.provider}/${m.model}` : "");
      if (!id) return null;
      const providerKey = m.provider || m.owned_by || "";
      const providerId = ALIAS_TO_ID[providerKey] || providerKey;
      const modelPart = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
      return {
        id,
        name: m.alias || m.name || m.model || humanize(modelPart),
        provider: providerKey,
        providerName: AI_PROVIDERS[providerId]?.name || humanize(providerKey),
      };
    })
    .filter(Boolean);
}

function normalizeCombos(combos) {
  return (combos || [])
    .filter((c) => c && typeof c.name === "string")
    .map((c) => ({ id: c.name, name: c.name }));
}

/** Drop repeated ids so a group never lists the same entry twice. */
function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export default function ModelPicker({
  models,
  combos,
  value,
  onChange,
  disabled = false,
  loading = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef(null);

  const normalizedModels = useMemo(() => normalizeModels(models), [models]);
  const normalizedCombos = useMemo(() => normalizeCombos(combos), [combos]);

  const closePicker = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        closePicker();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, closePicker]);

  const selected = useMemo(() => {
    if (!value) return null;
    return (
      normalizedCombos.find((c) => c.id === value) ||
      normalizedModels.find((m) => m.id === value) || { id: value, name: value }
    );
  }, [value, normalizedModels, normalizedCombos]);

  const groups = useMemo(() => {
    const parsed = parseSearchQuery(search);
    const comboItems = normalizedCombos.filter((c) => matchesSearch(c.name, parsed));
    const modelItems = normalizedModels.filter((m) =>
      matchesSearch(
        { name: m.name, id: m.id, provider: m.providerName },
        parsed
      )
    );

    const byProvider = new Map();
    for (const model of modelItems) {
      if (!byProvider.has(model.providerName)) byProvider.set(model.providerName, []);
      byProvider.get(model.providerName).push(model);
    }

    const result = [];
    if (comboItems.length > 0) {
      result.push({ label: "Combos", items: dedupeById(comboItems) });
    }
    for (const [label, items] of byProvider) {
      result.push({ label, items: dedupeById(items) });
    }
    return result;
  }, [normalizedModels, normalizedCombos, search]);

  const select = (id) => {
    closePicker();
    if (id !== value) onChange(id);
  };

  const togglePicker = () => {
    if (!open) setSearch("");
    setOpen(!open);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={togglePicker}
        disabled={disabled}
        className={cn(
          "flex max-w-[min(65vw,280px)] items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-left transition-colors",
          "hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-brand-500/50"
        )}
      >
        <span className="material-symbols-outlined text-[15px] text-primary">
          model_training
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-text-main">
          {selected?.name || "Select model"}
        </span>
        <span className="material-symbols-outlined text-[15px] text-text-muted">
          expand_more
        </span>
      </button>

      {open && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-30 bg-black/20 sm:hidden"
            onClick={closePicker}
            aria-hidden="true"
          />

          <div className="chat-picker-pop fixed inset-x-3 top-26 z-40 sm:absolute sm:inset-x-auto sm:left-0 sm:top-[calc(100%+6px)] sm:w-[320px] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search models…"
                className="w-full rounded-md bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-text-main outline-none placeholder:text-text-muted"
              />
            </div>

          <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
            {loading ? (
              <div className="flex justify-center py-6">
                <Spinner size="sm" />
              </div>
            ) : groups.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-text-muted">
                No models found.
              </p>
            ) : (
              groups.map((group, groupIndex) => (
                <div
                  key={`group-${groupIndex}-${group.label}`}
                  className="mb-1.5 last:mb-0"
                >
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted/70">
                    {group.label}
                  </p>
                  {group.items.map((item) => {
                    const isSelected = item.id === value;
                    return (
                      <button
                        key={`${group.label}:${item.id}`}
                        type="button"
                        onClick={() => select(item.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                          isSelected ? "bg-primary/10" : "hover:bg-surface-2"
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-text-main">
                            {item.name}
                          </span>
                          <span className="block truncate font-mono text-[10.5px] text-text-subtle">
                            {item.id}
                          </span>
                        </span>
                        {isSelected && (
                          <span className="material-symbols-outlined text-[16px] text-primary">
                            check
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
