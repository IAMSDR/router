"use client";

import { useState } from "react";
import { Button } from "@/shared/components";
import ModelPicker from "./ModelPicker";

export default function ChatHeader({
  session,
  modelValue,
  models,
  combos,
  modelsLoading,
  onModelChange,
  onTemperatureCommit,
  onOpenParams,
  onToggleRail,
  railOpen,
}) {
  // While the field is focused we follow the user's keystrokes; otherwise we
  // fall back to the persisted session value.
  const [temperatureEdit, setTemperatureEdit] = useState(null);
  const paramTemperature = session?.params?.temperature;
  const temperature =
    temperatureEdit ?? (paramTemperature == null ? "" : String(paramTemperature));

  const commitTemperature = () => {
    const trimmed = temperature.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    setTemperatureEdit(null);
    if (next != null && Number.isNaN(next)) return;
    onTemperatureCommit?.(next);
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle bg-bg/70 px-2.5 py-2 backdrop-blur-md sm:gap-2 sm:px-3">
      <button
        type="button"
        onClick={onToggleRail}
        title="Show chats"
        aria-label="Show chats"
        className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main lg:hidden"
      >
        <span className="material-symbols-outlined text-[20px]">forum</span>
      </button>

      <button
        type="button"
        onClick={onToggleRail}
        title={railOpen ? "Hide chats" : "Show chats"}
        aria-label={railOpen ? "Hide chats" : "Show chats"}
        aria-pressed={railOpen}
        className="hidden rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main lg:inline-flex"
      >
        <span className="material-symbols-outlined text-[20px]">
          {railOpen ? "menu_open" : "menu"}
        </span>
      </button>

      <ModelPicker
        models={models}
        combos={combos}
        value={modelValue || ""}
        onChange={onModelChange}
        loading={modelsLoading}
      />

      <div className="hidden items-center gap-1.5 sm:flex">
        <label
          htmlFor="chat-temperature"
          className="text-[11px] font-medium text-text-muted"
        >
          Temp
        </label>
        <input
          id="chat-temperature"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          max="2"
          value={temperature}
          onChange={(event) => setTemperatureEdit(event.target.value)}
          onBlur={commitTemperature}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder="–"
          className="w-16 rounded-lg border border-border-subtle bg-surface-2 px-2 py-1 text-[12px] text-text-main outline-none focus:border-brand-500/40"
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-center text-[13px] font-medium text-text-muted">
          {session?.title || ""}
        </p>
      </div>

      <Button
        variant="secondary"
        size="sm"
        icon="tune"
        onClick={onOpenParams}
        disabled={!session}
        className="relative min-h-[44px] min-w-[44px] sm:min-h-7 sm:min-w-0 before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-h-[44px] before:min-w-[44px] before:content-['']"
      >
        <span className="hidden sm:inline">Params</span>
      </Button>
    </div>
  );
}
