"use client";

import { useState } from "react";
import { Button } from "@/shared/components";
import Drawer from "@/shared/components/Drawer";
import { cn } from "@/shared/utils/cn";

const REASONING_OPTIONS = [
  { value: "", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const NUMBER_FIELDS = [
  { key: "temperature", label: "Temperature", placeholder: "0 – 2", step: "0.1", min: "0", max: "2" },
  { key: "top_p", label: "Top P", placeholder: "0 – 1", step: "0.05", min: "0", max: "1" },
  { key: "max_tokens", label: "Max tokens", placeholder: "e.g. 2048", step: "1", min: "1" },
];

function splitStop(value) {
  if (Array.isArray(value)) return value.join("\n");
  return typeof value === "string" ? value : "";
}

/**
 * The form is a separate component so it mounts fresh each time the drawer opens
 * (and per session) — state is seeded from props, no syncing effect required.
 */
function ParamsForm({ session, onClose, onSave, saving }) {
  const params = session?.params || {};
  const [systemPrompt, setSystemPrompt] = useState(session?.systemPrompt || "");
  const [values, setValues] = useState({
    temperature: params.temperature ?? "",
    top_p: params.top_p ?? "",
    max_tokens: params.max_tokens ?? "",
  });
  const [stop, setStop] = useState(splitStop(params.stop));
  const [reasoningEffort, setReasoningEffort] = useState(params.reasoning_effort || "");

  const setField = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const buildParams = () => {
    const next = {};
    for (const field of NUMBER_FIELDS) {
      const raw = values[field.key];
      if (raw !== "" && raw != null && !Number.isNaN(Number(raw))) {
        next[field.key] = Number(raw);
      }
    }
    const stopLines = stop
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (stopLines.length === 1) next.stop = stopLines[0];
    else if (stopLines.length > 1) next.stop = stopLines;
    if (reasoningEffort) next.reasoning_effort = reasoningEffort;
    return next;
  };

  const handleReset = () => {
    setSystemPrompt("");
    setValues({ temperature: "", top_p: "", max_tokens: "" });
    setStop("");
    setReasoningEffort("");
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-main">
          System prompt
        </label>
        <textarea
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={3}
          placeholder="Instructions the model should follow for this conversation."
          className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-main outline-none focus:border-brand-500/50 custom-scrollbar"
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-main">
            Temperature
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            max="2"
            value={values.temperature}
            onChange={(event) => setField("temperature", event.target.value)}
            placeholder="0 – 2"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-main outline-none focus:border-brand-500/50"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-text-main">
            Top P
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.05"
            min="0"
            max="1"
            value={values.top_p}
            onChange={(event) => setField("top_p", event.target.value)}
            placeholder="0 – 1"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-main outline-none focus:border-brand-500/50"
          />
        </div>

        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-text-main">
            Max tokens
          </label>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={values.max_tokens}
            onChange={(event) => setField("max_tokens", event.target.value)}
            placeholder="e.g. 2048 (leave blank for model default)"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-main outline-none focus:border-brand-500/50"
          />
        </div>

        <div className="col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-text-main">
            Reasoning effort
          </label>
          <div className="flex flex-wrap gap-1">
            {REASONING_OPTIONS.map((option) => {
              const active = reasoningEffort === option.value;
              return (
                <button
                  key={option.value || "default"}
                  type="button"
                  onClick={() => setReasoningEffort(option.value)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary text-white shadow-xs"
                      : "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text-main"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-text-main">
          Stop sequences
        </label>
        <textarea
          value={stop}
          onChange={(event) => setStop(event.target.value)}
          rows={2}
          placeholder="One sequence per line"
          className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-main outline-none focus:border-brand-500/50"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          One stop sequence per line. Multiple lines are sent as an array.
        </p>
      </div>

      <div className="sticky -bottom-4 sm:-bottom-5 -mx-4 sm:-mx-5 mt-6 border-t border-border bg-surface px-4 sm:px-5 py-3 flex items-center justify-between gap-2 shadow-sm">
        <Button variant="ghost" size="sm" icon="restart_alt" onClick={handleReset} className="text-xs">
          Reset
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} className="text-xs">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSave({ systemPrompt, params: buildParams() })}
            loading={saving}
            className="text-xs"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ParamsDrawer({ isOpen, onClose, session, onSave, saving }) {
  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Chat parameters" width="sm">
      <ParamsForm
        key={session?.id || "none"}
        session={session}
        onClose={onClose}
        onSave={onSave}
        saving={saving}
      />
    </Drawer>
  );
}
