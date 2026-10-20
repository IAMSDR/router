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
    <div className="relative z-20 flex h-13 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3 sm:px-4">
      <div className="flex items-center gap-2 min-w-0">
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
      </div>

      <div className="hidden md:block min-w-0 flex-1 px-4">
        <p className="truncate text-center text-[13px] font-medium text-text-muted">
          {session?.title || ""}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
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
            className="w-14 rounded-md border border-border bg-surface-2 px-1.5 py-1 text-[11px] font-mono text-center text-text-main outline-none focus:border-brand-500/50"
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon="tune"
          onClick={onOpenParams}
          disabled={!session}
          className="text-xs font-normal"
        >
          <span className="hidden sm:inline">Params</span>
        </Button>
      </div>
    </div>
  );
}
