"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Markdown from "./Markdown";
import ThinkingBlock from "./ThinkingBlock";
import {
  formatCost,
  formatLatency,
  formatTtft,
  messageAttachments,
  messageText,
  tokenSummary,
} from "./chatUtils";

function AttachmentThumb({ attachment }) {
  const [failed, setFailed] = useState(false);
  const label = attachment?.filename || attachment?.mimeType || "Image";

  if (failed || !attachment?.url) {
    return (
      <div className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-border-subtle bg-surface-2 p-2 text-center">
        <span className="material-symbols-outlined text-[22px] text-text-muted">
          broken_image
        </span>
        <span className="line-clamp-2 break-all text-[10px] leading-tight text-text-muted">
          {label}
        </span>
      </div>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="overflow-hidden rounded-lg border border-border-subtle"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachment.url}
        alt={label}
        className="h-28 w-28 object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

function ActionButton({ icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:min-w-0 before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-h-[44px] before:min-w-[44px] before:content-['']"
    >
      <span className="material-symbols-outlined text-[15px]">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MessageActions({ copied, onCopy, onEdit, onRegenerate, onDelete, canRegenerate, busy }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:sm:opacity-0 sm:group-hover:opacity-100">
      <ActionButton
        icon={copied ? "check" : "content_copy"}
        label={copied ? "Copied" : "Copy"}
        onClick={onCopy}
      />
      {onEdit && (
        <ActionButton icon="edit" label="Edit" onClick={onEdit} disabled={busy} />
      )}
      {onRegenerate && (
        <ActionButton
          icon="refresh"
          label="Regenerate"
          onClick={onRegenerate}
          disabled={busy || !canRegenerate}
        />
      )}
      {onDelete && (
        <ActionButton icon="delete" label="Delete" onClick={onDelete} disabled={busy} />
      )}
    </div>
  );
}

export default function MessageBubble({
  message,
  live = false,
  streamingText = "",
  streamingReasoning = "",
  modelLabel = "",
  isLastAssistant = false,
  busy = false,
  onDelete,
  onRegenerate,
  onEditResend,
}) {
  const isUser = !live && message?.role === "user";
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const { copied, copy } = useCopyToClipboard(1500);
  const textareaRef = useRef(null);

  const text = live ? streamingText : messageText(message);
  const reasoning = live ? streamingReasoning : message?.reasoning || "";
  const attachments = live ? [] : messageAttachments(message);
  const status = live ? "streaming" : message?.status;
  const isError = status === "error";
  const isStreaming = live || status === "streaming";

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [editing]);

  const beginEdit = () => {
    setEditText(messageText(message));
    setEditing(true);
  };

  const commitEdit = () => {
    const next = editText.trim();
    if (!next) return;
    setEditing(false);
    onEditResend?.(message, next);
  };

  if (isUser) {
    return (
      <div className="group flex w-full flex-col items-end">
        {attachments.length > 0 && (
          <div className="mb-2 flex max-w-[85%] flex-wrap justify-end gap-2">
            {attachments.map((attachment) => (
              <AttachmentThumb key={attachment.id} attachment={attachment} />
            ))}
          </div>
        )}

        {editing ? (
          <div className="w-full max-w-[85%] rounded-2xl border border-border-subtle bg-surface p-3">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg bg-surface-2 px-3 py-2 text-[14px] leading-relaxed text-text-main outline-none"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={commitEdit} disabled={!editText.trim()}>
                Save & resend
              </Button>
            </div>
          </div>
        ) : (
          text && (
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-[var(--shadow-soft)]">
              {text}
            </div>
          )
        )}

        {!editing && (
          <MessageActions
            copied={copied === message?.id}
            onCopy={() => copy(text, message?.id)}
            onEdit={onEditResend ? beginEdit : undefined}
            onDelete={onDelete ? () => onDelete(message) : undefined}
            busy={busy}
          />
        )}
      </div>
    );
  }

  // Assistant / live-streaming turn
  const tokens = live ? null : tokenSummary(message);
  const cost = live ? null : formatCost(message?.cost);
  const latency = live ? null : formatLatency(message);
  const ttft = live ? null : formatTtft(message);
  const resolvedModel = live ? modelLabel : message?.model || modelLabel;

  return (
    <div className="group flex w-full flex-col items-start">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <span className="material-symbols-outlined text-[15px] text-primary">
          smart_toy
        </span>
        {resolvedModel || "Assistant"}
      </div>

      {(reasoning || (isStreaming && streamingReasoning)) && (
        <div className="w-full">
          <ThinkingBlock
            reasoning={reasoning || streamingReasoning}
            streaming={isStreaming}
          />
        </div>
      )}

      <div className="w-full">
        {isError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[13px] text-red-600 dark:text-red-400">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <div className="min-w-0 flex-1">
                <p className="break-words">
                  {message?.error || text || "The reply failed."}
                </p>
                {onRegenerate && (
                  <button
                    type="button"
                    onClick={() => onRegenerate(message)}
                    disabled={busy}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-red-500/10 disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined text-[14px]">refresh</span>
                    Retry
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : text ? (
          <Markdown text={text} />
        ) : isStreaming ? (
          <div className="flex items-center gap-2 py-1 text-text-muted">
            <span className="material-symbols-outlined animate-spin text-[16px]">
              progress_activity
            </span>
            <span className="text-[13px]">Thinking…</span>
          </div>
        ) : null}
      </div>

      {!live && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {resolvedModel && (
            <Badge size="sm" variant="default" icon="model_training">
              {resolvedModel}
            </Badge>
          )}
          {tokens && (
            <Badge size="sm" variant="info" icon="toll">
              {tokens.label}
            </Badge>
          )}
          {cost && (
            <Badge size="sm" variant="success" icon="payments">
              {cost}
            </Badge>
          )}
          {latency && (
            <Badge size="sm" variant="default" icon="timer">
              {latency}
            </Badge>
          )}
          {ttft && (
            <Badge size="sm" variant="default" icon="bolt">
              {ttft} TTFT
            </Badge>
          )}
        </div>
      )}

      {!live && (
        <MessageActions
          copied={copied === message?.id}
          onCopy={() => copy(text, message?.id)}
          onRegenerate={onRegenerate ? () => onRegenerate(message) : undefined}
          canRegenerate={isLastAssistant}
          onDelete={onDelete ? () => onDelete(message) : undefined}
          busy={busy}
        />
      )}
    </div>
  );
}
