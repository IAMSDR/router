"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/shared/utils/cn";

export default function Composer({
  draft,
  onDraftChange,
  attachments,
  onRemoveAttachment,
  onFilesSelected,
  onSend,
  onStop,
  streaming = false,
  uploading = false,
  disabled = false,
  disabledReason = "",
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  const canSend =
    !disabled && !streaming && (draft.trim().length > 0 || attachments.length > 0);

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  const handleFiles = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length > 0) onFilesSelected(files);
  };

  return (
    <div className="shrink-0 border-t border-border bg-bg px-3 py-3 sm:px-4">
      <div className="mx-auto w-full max-w-3xl">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group relative overflow-hidden rounded-lg border border-border-subtle"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachment.url}
                  alt={attachment.filename}
                  className="h-16 w-16 object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  title="Remove"
                  aria-label="Remove attachment"
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-100 transition-opacity hover:bg-black/80"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-border bg-surface px-3.5 py-2.5 shadow-sm transition-all focus-within:border-brand-500/60 focus-within:ring-2 focus-within:ring-brand-500/10">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={disabled}
            placeholder="Send a message…"
            className="max-h-[200px] w-full resize-none bg-transparent px-1 py-1 text-[14px] leading-relaxed text-text-main outline-none placeholder:text-text-muted disabled:cursor-not-allowed custom-scrollbar"
          />

          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || streaming || uploading}
                title="Attach image"
                aria-label="Attach image"
                className="flex size-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[19px]">
                  {uploading ? "progress_activity" : "attach_file"}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={handleFiles}
              />
            </div>

            {disabledReason && (
              <p className="min-w-0 flex-1 truncate text-center text-[11px] text-text-muted">
                {disabledReason}
              </p>
            )}

            <div className="flex shrink-0 items-center gap-1.5 ml-auto">
              {streaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  title="Stop generating"
                  aria-label="Stop generating"
                  className="flex size-8 items-center justify-center rounded-full border border-border bg-surface-2 text-text-main transition-colors hover:bg-surface-3"
                >
                  <span className="material-symbols-outlined text-[17px]">stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend}
                  title="Send message"
                  aria-label="Send message"
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-all",
                    canSend
                      ? "bg-primary text-white shadow-sm hover:bg-primary-hover active:scale-95"
                      : "bg-surface-2 text-text-muted cursor-not-allowed"
                  )}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    arrow_upward
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-1.5 hidden text-center text-[10.5px] text-text-subtle sm:block">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
