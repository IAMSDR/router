"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { chatApi, streamChat } from "../lib/streamChat";
import SessionRail from "./SessionRail";
import ChatHeader from "./ChatHeader";
import MessageList from "./MessageList";
import Composer from "./Composer";
import ParamsDrawer from "./ParamsDrawer";
import { messageAttachments, messageText } from "./chatUtils";

function toRequestMessages(list) {
  return (list || []).map((message) => ({
    role: message.role,
    content: messageText(message),
  }));
}

export default function ChatPageClient() {
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

  const [activeId, setActiveId] = useState(null);
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [pendingModel, setPendingModel] = useState("");

  const [models, setModels] = useState([]);
  const [combos, setCombos] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  const [railOpen, setRailOpen] = useState(true);
  const [railMobileOpen, setRailMobileOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [savingParams, setSavingParams] = useState(false);

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [inlineError, setInlineError] = useState(null);

  const activeIdRef = useRef(null);
  const abortRef = useRef(null);

  const toast = useMemo(() => useNotificationStore.getState(), []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await chatApi.listSessions();
      const list = data.sessions || [];
      setSessions(list);
      return list;
    } catch (error) {
      toast.error(error?.message || "Failed to load chats");
      return [];
    } finally {
      setSessionsLoading(false);
    }
  }, [toast]);

  const refreshActive = useCallback(async (id) => {
    if (!id) return null;
    const data = await chatApi.getSession(id);
    if (activeIdRef.current === id) {
      setSession(data.session);
      setMessages(data.messages || []);
    }
    return data;
  }, []);

  // Initial load: sessions + model catalog.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadSessions();
      if (!cancelled && list.length > 0) {
        setMessagesLoading(true);
        setActiveId(list[0].id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      chatApi.listModels().catch(() => ({ models: [] })),
      chatApi.listCombos().catch(() => ({ combos: [] })),
    ])
      .then(([modelData, comboData]) => {
        if (cancelled) return;
        setModels(modelData.models || []);
        setCombos(comboData.combos || []);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the selected conversation.
  useEffect(() => {
    activeIdRef.current = activeId;
    if (!activeId) return undefined;
    let cancelled = false;
    chatApi
      .getSession(activeId)
      .then((data) => {
        if (cancelled || activeIdRef.current !== activeId) return;
        setSession(data.session);
        setMessages(data.messages || []);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error?.message || "Failed to load conversation");
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, toast]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && railMobileOpen) {
        setRailMobileOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [railMobileOpen]);

  const ensureSession = useCallback(async () => {
    if (session) {
      if (pendingModel && session.model !== pendingModel) {
        const patched = await chatApi.updateSession(session.id, { model: pendingModel });
        setPendingModel("");
        setSession(patched.session);
        return patched.session;
      }
      return session;
    }
    if (activeId) {
      const data = await chatApi.getSession(activeId);
      if (pendingModel && data.session?.model !== pendingModel) {
        const patched = await chatApi.updateSession(activeId, { model: pendingModel });
        setPendingModel("");
        setSession(patched.session);
        setMessages(data.messages || []);
        return patched.session;
      }
      setSession(data.session);
      setMessages(data.messages || []);
      return data.session;
    }
    const data = await chatApi.createSession();
    let created = data.session;
    if (pendingModel) {
      const patched = await chatApi.updateSession(created.id, { model: pendingModel });
      created = patched.session;
      setPendingModel("");
    }
    setSessions((prev) => [created, ...prev]);
    setActiveId(created.id);
    activeIdRef.current = created.id;
    setSession(created);
    setMessages([]);
    return created;
  }, [session, activeId, pendingModel]);

  const runCompletion = useCallback(
    async ({ sessionId, model, requestMessages, systemPrompt, params }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setStreamingText("");
      setStreamingReasoning("");
      setInlineError(null);

      try {
        await streamChat({
          sessionId,
          model,
          messages: requestMessages,
          systemPrompt,
          params,
          signal: controller.signal,
          onDelta: (_delta, full) => setStreamingText(full),
          onReasoning: (_delta, full) => setStreamingReasoning(full),
        });
        await refreshActive(sessionId);
        return true;
      } catch (error) {
        if (error?.name === "AbortError") {
          await refreshActive(sessionId).catch(() => {});
          return false;
        }
        const message = error?.message || "Request failed";
        toast.error(message, "Chat error");
        setInlineError({
          message,
          retry: { sessionId, model, requestMessages, systemPrompt, params },
        });
        await refreshActive(sessionId).catch(() => {});
        return false;
      } finally {
        setIsStreaming(false);
        setStreamingText("");
        setStreamingReasoning("");
        abortRef.current = null;
      }
    },
    [refreshActive, toast]
  );

  const handleSend = useCallback(async () => {
    if (isStreaming || uploading) return;
    const text = draft.trim();
    const attachmentIds = attachments.map((item) => item.id);
    if (!text && attachmentIds.length === 0) return;

    let current = session;
    try {
      if (!current) current = await ensureSession();
    } catch (error) {
      toast.error(error?.message || "Failed to create chat");
      return;
    }
    if (!current?.model) {
      toast.warning("Select a model before sending");
      return;
    }

    setDraft("");
    setAttachments([]);

    try {
      const { message } = await chatApi.addMessage(current.id, {
        role: "user",
        content: { text, attachmentIds },
      });
      const nextMessages = [...messages, message];
      setMessages(nextMessages);
      await runCompletion({
        sessionId: current.id,
        model: current.model,
        requestMessages: toRequestMessages(nextMessages),
        systemPrompt: current.systemPrompt,
        params: current.params,
      });
      loadSessions();
    } catch (error) {
      toast.error(error?.message || "Failed to send message");
    }
  }, [
    isStreaming,
    uploading,
    draft,
    attachments,
    session,
    messages,
    ensureSession,
    runCompletion,
    loadSessions,
    toast,
  ]);

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleRetry = useCallback(async () => {
    if (!inlineError?.retry) return;
    const payload = inlineError.retry;
    setInlineError(null);
    await runCompletion(payload);
    loadSessions();
  }, [inlineError, runCompletion, loadSessions]);

  const handleNewChat = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const data = await chatApi.createSession();
      const created = data.session;
      setSessions((prev) => [created, ...prev]);
      setActiveId(created.id);
      activeIdRef.current = created.id;
      setSession(created);
      setMessages([]);
      setRailMobileOpen(false);
    } catch (error) {
      toast.error(error?.message || "Failed to create chat");
    } finally {
      setCreating(false);
    }
  }, [creating, toast]);

  const handleSelectSession = useCallback((id) => {
    setMessagesLoading(true);
    setPendingModel("");
    setActiveId(id);
    setRailMobileOpen(false);
  }, []);

  const handleRename = useCallback(
    async (id, title) => {
      try {
        const data = await chatApi.updateSession(id, { title });
        setSessions((prev) =>
          prev.map((item) => (item.id === id ? { ...item, ...data.session } : item))
        );
        if (activeIdRef.current === id) {
          setSession((prev) => ({ ...(prev || {}), ...data.session }));
        }
      } catch (error) {
        toast.error(error?.message || "Failed to rename chat");
      }
    },
    [toast]
  );

  const handleDeleteSession = useCallback(
    async (id) => {
      try {
        await chatApi.deleteSession(id);
        const remaining = sessions.filter((item) => item.id !== id);
        setSessions(remaining);
        if (activeIdRef.current === id) {
          const fallback = remaining[0]?.id || null;
          if (fallback) setMessagesLoading(true);
          setActiveId(fallback);
          activeIdRef.current = fallback;
          if (!fallback) {
            setSession(null);
            setMessages([]);
          }
        }
      } catch (error) {
        toast.error(error?.message || "Failed to delete chat");
      }
    },
    [sessions, toast]
  );

  const handleModelChange = useCallback(
    async (modelId) => {
      if (!session) {
        setPendingModel(modelId);
        return;
      }
      try {
        const data = await chatApi.updateSession(session.id, { model: modelId });
        setSession((prev) => ({ ...(prev || {}), ...data.session }));
        setSessions((prev) =>
          prev.map((item) =>
            item.id === session.id ? { ...item, ...data.session } : item
          )
        );
      } catch (error) {
        toast.error(error?.message || "Failed to set model");
      }
    },
    [session, toast]
  );

  const patchParams = useCallback(
    async (params) => {
      if (!session) return;
      const data = await chatApi.updateSession(session.id, { params });
      setSession((prev) => ({ ...(prev || {}), ...data.session }));
      setSessions((prev) =>
        prev.map((item) =>
          item.id === session.id ? { ...item, ...data.session } : item
        )
      );
    },
    [session]
  );

  const handleTemperatureCommit = useCallback(
    async (value) => {
      if (!session) return;
      const params = { ...(session.params || {}) };
      if (value == null) delete params.temperature;
      else params.temperature = value;
      try {
        await patchParams(params);
      } catch (error) {
        toast.error(error?.message || "Failed to update temperature");
      }
    },
    [session, patchParams, toast]
  );

  const handleSaveParams = useCallback(
    async ({ systemPrompt, params }) => {
      if (!session) return;
      setSavingParams(true);
      try {
        const data = await chatApi.updateSession(session.id, { systemPrompt, params });
        setSession((prev) => ({ ...(prev || {}), ...data.session }));
        setSessions((prev) =>
          prev.map((item) =>
            item.id === session.id ? { ...item, ...data.session } : item
          )
        );
        setParamsOpen(false);
      } catch (error) {
        toast.error(error?.message || "Failed to save parameters");
      } finally {
        setSavingParams(false);
      }
    },
    [session, toast]
  );

  const handleFilesSelected = useCallback(
    async (files) => {
      // The upload route binds the attachment to a session, so make sure one
      // exists before sending any file.
      let current = session;
      if (!current) {
        try {
          current = await ensureSession();
        } catch (error) {
          toast.error(error?.message || "Failed to create chat");
          return;
        }
      }
      if (!current?.id) return;

      setUploading(true);
      const uploaded = [];
      for (const file of files) {
        if (!file.type?.startsWith("image/")) {
          toast.error(`${file.name} is not a supported image`);
          continue;
        }
        try {
          const attachment = await chatApi.uploadAttachment(file, current.id);
          uploaded.push(attachment);
        } catch (error) {
          toast.error(error?.message || `Failed to upload ${file.name}`);
        }
      }
      if (uploaded.length > 0) {
        setAttachments((prev) => [...prev, ...uploaded]);
      }
      setUploading(false);
    },
    [session, ensureSession, toast]
  );

  const removeAttachment = useCallback((id) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleDeleteMessage = useCallback(
    async (message) => {
      if (!session) return;
      try {
        await chatApi.deleteMessage(message.id, session.id);
        await refreshActive(session.id);
        loadSessions();
      } catch (error) {
        toast.error(error?.message || "Failed to delete message");
      }
    },
    [session, refreshActive, loadSessions, toast]
  );

  const handleRegenerate = useCallback(
    async (message) => {
      if (!session?.model || isStreaming) return;
      try {
        await chatApi.truncateMessage(message.id, session.id);
        const data = await chatApi.getSession(session.id);
        const remaining = data.messages || [];
        setSession(data.session);
        setMessages(remaining);
        await runCompletion({
          sessionId: session.id,
          model: data.session?.model || session.model,
          requestMessages: toRequestMessages(remaining),
          systemPrompt: data.session?.systemPrompt,
          params: data.session?.params,
        });
        loadSessions();
      } catch (error) {
        toast.error(error?.message || "Failed to regenerate reply");
      }
    },
    [session, isStreaming, runCompletion, loadSessions, toast]
  );

  const handleEditResend = useCallback(
    async (message, newText) => {
      if (!session?.model || isStreaming) return;
      try {
        await chatApi.truncateMessage(message.id, session.id);
        const data = await chatApi.getSession(session.id);
        const remaining = data.messages || [];
        const attachmentIds = messageAttachments(message).map((item) => item.id);
        const { message: userMessage } = await chatApi.addMessage(session.id, {
          role: "user",
          content: { text: newText, attachmentIds },
        });
        const withUser = [...remaining, userMessage];
        setSession(data.session);
        setMessages(withUser);
        await runCompletion({
          sessionId: session.id,
          model: data.session?.model || session.model,
          requestMessages: toRequestMessages(withUser),
          systemPrompt: data.session?.systemPrompt,
          params: data.session?.params,
        });
        loadSessions();
      } catch (error) {
        toast.error(error?.message || "Failed to resend message");
      }
    },
    [session, isStreaming, runCompletion, loadSessions, toast]
  );

  const handleSuggestion = useCallback((text) => {
    setDraft(text);
  }, []);

  const handleToggleRail = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setRailMobileOpen(true);
    } else {
      setRailOpen((value) => !value);
    }
  }, []);

  const composerDisabled = !(session?.model || pendingModel);
  const composerDisabledReason = composerDisabled
    ? "Select a model to start chatting"
    : "";

  const renderRail = () => (
    <SessionRail
      sessions={sessions}
      activeId={activeId}
      filter={filter}
      onFilterChange={setFilter}
      onSelect={handleSelectSession}
      onNew={handleNewChat}
      onRename={handleRename}
      onDelete={handleDeleteSession}
      loading={sessionsLoading}
      creating={creating}
    />
  );

  return (
    <div className="flex h-full min-h-0 w-full">
      {railOpen && <div className="hidden lg:flex">{renderRail()}</div>}

      {railMobileOpen && (
        <>
          <div
            className="fade-in fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] lg:hidden"
            onClick={() => setRailMobileOpen(false)}
          />
          <div className="slide-in-left fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-surface shadow-2xl lg:hidden">
            {renderRail()}
          </div>
        </>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader
          session={session}
          modelValue={session?.model || pendingModel || ""}
          models={models}
          combos={combos}
          modelsLoading={modelsLoading}
          onModelChange={handleModelChange}
          onTemperatureCommit={handleTemperatureCommit}
          onOpenParams={() => setParamsOpen(true)}
          onToggleRail={handleToggleRail}
          railOpen={railOpen}
        />

        {messagesLoading && messages.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-text-muted">
            <span className="material-symbols-outlined animate-spin mr-2">
              progress_activity
            </span>
            Loading conversation…
          </div>
        ) : (
          <MessageList
            messages={messages}
            streaming={isStreaming}
            streamingText={streamingText}
            streamingReasoning={streamingReasoning}
            modelLabel={session?.model || pendingModel || ""}
            busy={isStreaming}
            onDelete={handleDeleteMessage}
            onRegenerate={handleRegenerate}
            onEditResend={handleEditResend}
            onSuggestion={handleSuggestion}
          />
        )}

        {inlineError && (
          <div className="shrink-0 border-t border-red-500/20 bg-red-500/10 px-4 py-2">
            <div className="mx-auto flex max-w-3xl items-center gap-2 text-[13px] text-red-600 dark:text-red-400">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span className="min-w-0 flex-1 truncate">{inlineError.message}</span>
              <Button size="xs" variant="secondary" icon="refresh" onClick={handleRetry}>
                Retry
              </Button>
              <button
                type="button"
                onClick={() => setInlineError(null)}
                aria-label="Dismiss error"
                className="rounded p-0.5 hover:bg-red-500/10"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          </div>
        )}

        <Composer
          draft={draft}
          onDraftChange={setDraft}
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          onFilesSelected={handleFilesSelected}
          onSend={handleSend}
          onStop={handleStop}
          streaming={isStreaming}
          uploading={uploading}
          disabled={composerDisabled}
          disabledReason={composerDisabledReason}
        />
      </div>

      <ParamsDrawer
        isOpen={paramsOpen}
        onClose={() => setParamsOpen(false)}
        session={session}
        onSave={handleSaveParams}
        saving={savingParams}
      />
    </div>
  );
}
