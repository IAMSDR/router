"use client";

import { useState } from "react";
import { Button } from "@/shared/components";
import Drawer from "@/shared/components/Drawer";

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
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-main">
          System prompt
        </label>
        <textarea
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={5}
          placeholder="Instructions the model should follow for this conversation."
          className="w-full resize-y rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm leading-relaxed text-text-main outline-none focus:border-brand-500/40 custom-scrollbar"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {NUMBER_FIELDS.map((field) => (
          <div key={field.key}>
            <label className="mb-1.5 block text-sm font-medium text-text-main">
              {field.label}
            </label>
            <input
              type="number"
              inputMode="decimal"
              step={field.step}
              min={field.min}
              max={field.max}
              value={values[field.key]}
              onChange={(event) => setField(field.key, event.target.value)}
              placeholder={field.placeholder}
              className="w-full rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-main outline-none focus:border-brand-500/40"
            />
          </div>
        ))}

        <div className="col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-text-main">
            Reasoning effort
          </label>
          <div className="flex flex-wrap gap-1.5">
            {REASONING_OPTIONS.map((option) => {
              const active = reasoningEffort === option.value;
              return (
                <button
                  key={option.value || "default"}
                  type="button"
                  onClick={() => setReasoningEffort(option.value)}
                  aria-pressed={active}
                  className={
                    active
                      ? "rounded-full bg-gradient-to-br from-brand-500 to-brand-600 px-3.5 py-1.5 text-[13px] font-medium text-white shadow-sm shadow-brand-500/25 transition-all"
                      : "rounded-full border border-border-subtle bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium text-text-muted transition-all hover:border-brand-500/40 hover:text-text-main"
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-main">
          Stop sequences
        </label>
        <textarea
          value={stop}
          onChange={(event) => setStop(event.target.value)}
          rows={2}
          placeholder="One per line"
          className="w-full resize-y rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-main outline-none focus:border-brand-500/40"
        />
        <p className="mt-1 text-xs text-text-muted">
          One stop sequence per line. Multiple lines are sent as an array.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button variant="ghost" size="sm" icon="restart_alt" onClick={handleReset}>
          Reset
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSave({ systemPrompt, params: buildParams() })}
            loading={saving}
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
