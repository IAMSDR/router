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
      <div className="shrink-0 space-y-3 p-3">
        <Button
          variant="primary"
          icon="add"
          fullWidth
          onClick={onNew}
          loading={creating}
        >
          New chat
        </Button>
        <Input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Search chats"
          icon="search"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 custom-scrollbar">
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
          <div className="space-y-0.5">
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
                    "group relative cursor-pointer rounded-lg px-3 py-2 transition-colors",
                    isActive
                      ? "bg-primary/10"
                      : "hover:bg-surface-2"
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
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[13px] font-medium",
                            isActive ? "text-primary" : "text-text-main"
                          )}
                        >
                          {session.title || "New chat"}
                        </span>
                        <span className="shrink-0 text-[10px] text-text-subtle">
                          {relativeTime(session.lastMessageAt || session.updatedAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-text-muted">
                        {session.lastMessagePreview || "No messages yet"}
                      </p>

                      <div className="mt-1 flex items-center justify-end gap-1 opacity-100 transition-opacity [@media(hover:hover)]:lg:absolute [@media(hover:hover)]:lg:right-1.5 [@media(hover:hover)]:lg:top-1.5 [@media(hover:hover)]:lg:mt-0 lg:gap-0.5 lg:rounded-md lg:bg-surface/90 [@media(hover:hover)]:lg:opacity-0 lg:shadow-sm lg:group-hover:opacity-100">
                        <button
                          type="button"
                          title="Rename"
                          aria-label="Rename chat"
                          onClick={(event) => {
                            event.stopPropagation();
                            beginRename(session);
                          }}
                          className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main lg:h-auto lg:w-auto lg:min-h-0 lg:min-w-0 lg:shrink lg:rounded lg:p-1 lg:hover:bg-transparent lg:hover:text-text-main"
                        >
                          <span className="material-symbols-outlined text-[15px]">edit</span>
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          aria-label="Delete chat"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDelete(session);
                          }}
                          className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-red-500 lg:h-auto lg:w-auto lg:min-h-0 lg:min-w-0 lg:shrink lg:rounded lg:p-1 lg:hover:bg-transparent lg:hover:text-red-500"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
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
