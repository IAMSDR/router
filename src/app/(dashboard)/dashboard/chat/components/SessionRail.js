"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ConfirmModal, Input, Spinner } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { relativeTime } from "./chatUtils";

export default function SessionRail({
  sessions,
  activeId,
  filter,
  onFilterChange,
  onSelect,
  onNew,
  onRename,
  onDelete,
  loading,
  creating,
  className,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const renameRef = useRef(null);

  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  const query = filter.trim().toLowerCase();
  const visible = query
    ? sessions.filter((session) =>
        String(session.title || "").toLowerCase().includes(query)
      )
    : sessions;

  const beginRename = (session) => {
    setRenamingId(session.id);
    setRenameValue(session.title || "");
  };

  const commitRename = (session) => {
    const next = renameValue.trim();
    setRenamingId(null);
    if (next && next !== session.title) onRename(session.id, next);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <aside
      className={cn(
        "flex h-full w-72 shrink-0 flex-col border-r border-border-subtle bg-surface",
        className
      )}
    >
      <div className="shrink-0 space-y-2 p-3 pb-2 border-b border-border-subtle">
        <Button
          variant="secondary"
          icon="add"
          fullWidth
          onClick={onNew}
          loading={creating}
          className="border-border hover:bg-surface-2 font-medium"
        >
          New chat
        </Button>
        <Input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Search chats…"
          icon="search"
          className="text-[13px]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-text-muted">
            {sessions.length === 0
              ? "No conversations yet."
              : "No chats match your search."}
          </p>
        ) : (
          <div className="space-y-1">
            {visible.map((session) => {
              const isActive = session.id === activeId;
              return (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(session.id);
                    }
                  }}
                  className={cn(
                    "group relative cursor-pointer rounded-lg px-3 py-2 transition-all duration-150",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-text-main hover:bg-surface-2"
                  )}
                >
                  {renamingId === session.id ? (
                    <input
                      ref={renameRef}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") commitRename(session);
                        if (event.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => commitRename(session)}
                      className="w-full rounded-md border border-brand-500/40 bg-surface px-2 py-1 text-[13px] text-text-main outline-none"
                    />
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-1 pr-6">
                        <span className="truncate text-[13px]">
                          {session.title || "New chat"}
                        </span>
                        <span className="shrink-0 text-[10px] text-text-subtle font-normal">
                          {relativeTime(session.lastMessageAt || session.updatedAt)}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-text-muted font-normal mt-0.5">
                        {session.lastMessagePreview || "No messages yet"}
                      </p>

                      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 rounded-md bg-surface border border-border-subtle p-0.5 shadow-sm">
                        <button
                          type="button"
                          title="Rename"
                          aria-label="Rename chat"
                          onClick={(event) => {
                            event.stopPropagation();
                            beginRename(session);
                          }}
                          className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">edit</span>
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          aria-label="Delete chat"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDelete(session);
                          }}
                          className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-surface-2 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Delete chat"
        message={`Delete "${pendingDelete?.title || "this chat"}"? This cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
      />
    </aside>
  );
}
