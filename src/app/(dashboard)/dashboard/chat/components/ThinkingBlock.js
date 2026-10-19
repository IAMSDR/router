"use client";

import { useState } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * Collapsible "thinking" section shown above an assistant answer. Collapsed by
 * default; stays open while new reasoning streams in only if the user opened it.
 */
export default function ThinkingBlock({ reasoning, streaming = false }) {
  const [open, setOpen] = useState(false);
  if (!reasoning) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-border-subtle bg-gradient-to-b from-surface-2/80 to-surface-2/40 shadow-[var(--shadow-soft)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:text-text-main"
        aria-expanded={open}
      >
        <span
          className={cn(
            "material-symbols-outlined text-[16px] transition-transform duration-200",
            open && "rotate-90"
          )}
        >
          chevron_right
        </span>
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[15px]">psychology</span>
        </span>
        <span>
          Thinking
          {streaming && (
            <span className="chat-typing-dots ml-1.5 inline-flex items-center gap-1" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="max-h-72 overflow-y-auto border-t border-border-subtle px-3 py-2 custom-scrollbar">
          <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text-muted">
            {reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
