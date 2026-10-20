"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";

const SUGGESTIONS = [
  { icon: "route", text: "Explain how this gateway routes a request to a provider." },
  { icon: "network_check", text: "Write a haiku about network latency." },
  { icon: "thermostat", text: "Summarize the difference between temperature and top_p." },
];

function EmptyState({ onSuggestion }) {
  return (
    <div className="flex h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[26px]">forum</span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-text-main">
          Start a conversation
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
          Pick an active model in the header, then send a message to test it live through this gateway.
        </p>
        <div className="mt-6 grid gap-2.5 sm:grid-cols-3">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.text}
              type="button"
              onClick={() => onSuggestion(suggestion.text)}
              className="group rounded-xl border border-border bg-surface p-3 text-left shadow-xs transition-all hover:border-brand-500/40 hover:bg-surface-2"
            >
              <span className="mb-2 inline-flex size-7 items-center justify-center rounded-lg bg-surface-2 text-text-muted transition-colors group-hover:text-primary">
                <span className="material-symbols-outlined text-[17px]">{suggestion.icon}</span>
              </span>
              <span className="block text-[12.5px] leading-snug text-text-muted transition-colors group-hover:text-text-main">
                {suggestion.text}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MessageList({
  messages,
  streaming,
  streamingText,
  streamingReasoning,
  modelLabel,
  busy,
  onDelete,
  onRegenerate,
  onEditResend,
  onSuggestion,
}) {
  const containerRef = useRef(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  })();

  const scrollToBottom = useCallback((behavior = "auto") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickRef.current = true;
    setAtBottom(true);
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    stickRef.current = near;
    setAtBottom(near);
  }, []);

  // Stick to the bottom while content grows, but only if the user is already there.
  useEffect(() => {
    if (stickRef.current) {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamingText, streamingReasoning]);

  // Jump to the bottom when switching conversations.
  const firstId = messages[0]?.id || "";
  useEffect(() => {
    stickRef.current = true;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [firstId]);

  if (messages.length === 0 && !streaming) {
    return (
      <div className="min-h-0 flex-1">
        <EmptyState onSuggestion={onSuggestion} />
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto custom-scrollbar"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              modelLabel={modelLabel}
              isLastAssistant={message.id === lastAssistantId}
              busy={busy}
              onDelete={onDelete}
              onRegenerate={onRegenerate}
              onEditResend={onEditResend}
            />
          ))}

          {streaming && (
            <MessageBubble
              live
              streamingText={streamingText}
              streamingReasoning={streamingReasoning}
              modelLabel={modelLabel}
            />
          )}
        </div>
      </div>

      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-main shadow-[var(--shadow-elev)] transition-colors hover:bg-surface-2"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
          Jump to latest
        </button>
      )}
    </div>
  );
}
