"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bot,
  ChevronDown,
  Loader2,
  MessageSquareText,
  PanelLeftOpen,
  Plus,
  Signal,
  Sparkles,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ConversationPayload,
  ConversationSummary,
  DashboardMetrics,
  MessageRecord,
  MessagesPayload,
  MetricsOverview,
  ProviderOption,
} from "@/lib/types";
import { cn, formatRelativeTime, formatTimestamp } from "@/lib/utils";

type RuntimeInfo = {
  providerMode: "openai" | "anthropic" | "mock";
  hasOpenAiKey: boolean;
  hasAnthropicKey: boolean;
  availableProviders: ProviderOption[];
  defaultProvider: ProviderOption;
  model: string;
  nodeVersion: string;
  storage: string;
};

type StreamChunk =
  | {
      type: "ack";
      conversationId: string;
      userMessage: MessageRecord;
      assistantMessage: MessageRecord;
    }
  | {
      type: "delta";
      assistantMessageId: string;
      text: string;
      source: "openai" | "anthropic" | "mock";
    }
  | {
      type: "complete";
      conversation: ConversationSummary | null;
      messages: MessageRecord[];
      source: "openai" | "anthropic" | "mock";
      inferenceLogId: string | null;
    }
  | {
      type: "error";
      error: string;
      conversation: ConversationSummary | null;
      messages: MessageRecord[];
    };

const quickPrompts = [
  "Summarize the benefits of inference logging for an LLM product.",
  "Compare OpenAI and Anthropic provider integration tradeoffs for this system.",
  "Give me a sample conversation that tests cancellation, resume, and provider switching.",
];

function getRoleLabel(role: MessageRecord["role"]) {
  switch (role) {
    case "ASSISTANT":
      return "Assistant";
    case "SYSTEM":
      return "System";
    default:
      return "You";
  }
}

function getStatusTone(status: string) {
  if (status === "SUCCESS") {
    return "bg-[rgba(21,107,82,0.12)] text-[var(--success)]";
  }

  if (status === "CANCELLED") {
    return "bg-[rgba(206,107,44,0.14)] text-[var(--accent)]";
  }

  return "bg-[rgba(166,60,47,0.12)] text-[var(--danger)]";
}

function getProviderLabel(provider: ProviderOption) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "mock":
      return "Mock";
    default:
      return "Auto";
  }
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "The request could not be completed.");
  }

  return data;
}

export function ChatWorkspace() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [metrics, setMetrics] = useState<MetricsOverview | null>(null);
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption>("auto");
  const [isBooting, setIsBooting] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [providerNotice, setProviderNotice] = useState<string>(
    "The workspace is loading provider availability and runtime details.",
  );

  const requestAbortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  async function refreshMetrics() {
    try {
      const [overview, dashboardData] = await Promise.all([
        fetchJson<MetricsOverview>("/api/metrics/overview", {
          method: "GET",
        }),
        fetchJson<DashboardMetrics>("/api/metrics/dashboard", {
          method: "GET",
        }).catch(() => null),
      ]);

      setMetrics(overview);
      setDashboard(dashboardData);
    } catch {
      setMetrics(null);
      setDashboard(null);
    }
  }

  async function loadRuntimeInfo() {
    try {
      const data = await fetchJson<RuntimeInfo>("/api/runtime-info", {
        method: "GET",
      });
      setRuntimeInfo(data);
      setSelectedProvider(data.defaultProvider);
      setProviderNotice(
        data.providerMode === "mock"
          ? "The local fallback provider is active. Chat, streaming, logging, and dashboards remain fully operational without external model credentials."
          : `${getProviderLabel(data.providerMode)} is available with model ${data.model}. You can also switch providers per request from the composer.`,
      );
    } catch {
      setRuntimeInfo(null);
    }
  }

  async function refreshConversations(options?: { preserveSelection?: boolean }) {
    const data = await fetchJson<{ conversations: ConversationSummary[] }>("/api/conversations", {
      method: "GET",
    });

    setConversations(data.conversations);
    const preserveSelection = options?.preserveSelection ?? true;

    if (!preserveSelection) {
      const nextActive =
        activeConversationId &&
        data.conversations.some((item) => item.id === activeConversationId)
          ? activeConversationId
          : data.conversations[0]?.id ?? null;
      setActiveConversationId(nextActive);
      return nextActive;
    }

    if (
      activeConversationId &&
      data.conversations.some((item) => item.id === activeConversationId)
    ) {
      return activeConversationId;
    }

    const nextActive = data.conversations[0]?.id ?? null;
    setActiveConversationId(nextActive);
    return nextActive;
  }

  async function loadMessages(conversationId: string) {
    const data = await fetchJson<MessagesPayload>(
      `/api/conversations/${conversationId}/messages`,
      {
        method: "GET",
      },
    );
    setMessages(data.messages);
    if (data.conversation) {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === data.conversation.id ? data.conversation : conversation,
        ),
      );
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsBooting(true);
      try {
        await Promise.all([loadRuntimeInfo(), refreshMetrics()]);

        const conversationsData = await fetchJson<{ conversations: ConversationSummary[] }>(
          "/api/conversations",
          { method: "GET" },
        );

        if (cancelled) {
          return;
        }

        setConversations(conversationsData.conversations);
        const nextActive = conversationsData.conversations[0]?.id ?? null;
        setActiveConversationId(nextActive);

        if (nextActive) {
          const messageData = await fetchJson<MessagesPayload>(
            `/api/conversations/${nextActive}/messages`,
            {
              method: "GET",
            },
          );

          if (cancelled) {
            return;
          }

          setMessages(messageData.messages);
        }
      } catch (bootError) {
        if (!cancelled) {
          setError(
            bootError instanceof Error
              ? bootError.message
              : "The workspace could not load.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  function upsertConversation(conversation: ConversationSummary | null) {
    if (!conversation) {
      return;
    }

    setConversations((current) => {
      const withoutCurrent = current.filter((item) => item.id !== conversation.id);
      return [conversation, ...withoutCurrent];
    });
  }

  async function sendStreamRequest(
    conversationId: string,
    content: string,
    controller: AbortController,
  ) {
    const response = await fetch(`/api/conversations/${conversationId}/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, provider: selectedProvider }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || "The request could not be completed.");
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("The response stream could not be opened.");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const chunk = JSON.parse(trimmed) as StreamChunk;

        if (chunk.type === "ack") {
          setMessages((current) =>
            current.map((message) => {
              if (message.id.startsWith("optimistic-user-")) {
                return chunk.userMessage;
              }

              if (message.id.startsWith("optimistic-assistant-")) {
                return chunk.assistantMessage;
              }

              return message;
            }),
          );
          continue;
        }

        if (chunk.type === "delta") {
          setMessages((current) =>
            current.map((message) =>
              message.id === chunk.assistantMessageId
                ? {
                    ...message,
                    content: `${message.content}${chunk.text}`,
                    status: "PENDING",
                  }
                : message,
            ),
          );
          continue;
        }

        if (chunk.type === "complete") {
          setMessages(chunk.messages);
          upsertConversation(chunk.conversation);
          setProviderNotice(
            chunk.source === "mock"
              ? "The local fallback provider handled the latest request while preserving the full telemetry path and streaming behavior."
              : `${getProviderLabel(chunk.source)} handled the latest request and the telemetry pipeline captured the invocation successfully.`,
          );
          continue;
        }

        setMessages(chunk.messages);
        upsertConversation(chunk.conversation);
        setError(chunk.error);
      }
    }
  }

  async function handleSelectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setIsDrawerOpen(false);
    await loadMessages(conversationId);
  }

  async function handleCreateConversation() {
    setIsCreating(true);
    setError(null);

    try {
      const data = await fetchJson<ConversationPayload>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({}),
      });

      setConversations((current) => [data.conversation, ...current]);
      setActiveConversationId(data.conversation.id);
      setMessages([]);
      setIsDrawerOpen(false);
      return data.conversation.id;
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "A new conversation could not be created.",
      );
      return null;
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSendMessage(nextContent?: string) {
    const content = (nextContent ?? draft).trim();
    if (!content || isSending) {
      return;
    }

    setError(null);
    let conversationId = activeConversationId;
    if (!conversationId) {
      conversationId = await handleCreateConversation();
    }

    if (!conversationId) {
      return;
    }

    const optimisticUserId = `optimistic-user-${Date.now()}`;
    const optimisticAssistantId = `optimistic-assistant-${Date.now()}`;

    setMessages((current) => [
      ...current,
      {
        id: optimisticUserId,
        conversationId,
        role: "USER",
        status: "COMPLETED",
        content,
        sequenceNumber: current.length + 1,
        createdAt: new Date().toISOString(),
      },
      {
        id: optimisticAssistantId,
        conversationId,
        role: "ASSISTANT",
        status: "PENDING",
        content: "",
        sequenceNumber: current.length + 2,
        createdAt: new Date().toISOString(),
      },
    ]);

    setDraft("");
    setIsSending(true);
    setProviderNotice(
      "Request in flight. Streaming tokens and telemetry updates will appear as the run progresses.",
    );

    const controller = new AbortController();
    requestAbortRef.current = controller;

    try {
      await sendStreamRequest(conversationId, content, controller);
      await refreshMetrics();
    } catch (sendError) {
      if (sendError instanceof DOMException && sendError.name === "AbortError") {
        return;
      }

      setError(
        sendError instanceof Error
          ? sendError.message
          : "The assistant could not complete the request.",
      );

      await Promise.all([
        loadMessages(conversationId),
        refreshConversations(),
        refreshMetrics(),
      ]);
    } finally {
      requestAbortRef.current = null;
      setIsSending(false);
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  }

  async function handleCancel() {
    if (!activeConversationId || !isSending || isCancelling) {
      return;
    }

    setIsCancelling(true);

    try {
      await fetchJson<MessagesPayload>(
        `/api/conversations/${activeConversationId}/cancel`,
        {
          method: "POST",
        },
      );
      requestAbortRef.current?.abort();
      await Promise.all([
        loadMessages(activeConversationId),
        refreshConversations(),
        refreshMetrics(),
      ]);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "The in-flight response could not be cancelled.",
      );
    } finally {
      setIsCancelling(false);
      setIsSending(false);
    }
  }

  const emptyState = !isBooting && conversations.length === 0;
  const throughputMax = Math.max(
    1,
    ...(dashboard?.throughputByDay.map((item) => item.count) ?? [1]),
  );
  const latencyBucketMax = Math.max(
    1,
    ...(dashboard?.latencyBuckets.map((item) => item.count) ?? [1]),
  );

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1580px] flex-col gap-4 text-[var(--foreground)] md:gap-5">
      <section className="animated-rise glass-panel overflow-hidden rounded-[2rem] border border-[var(--border)]">
        <div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-5 md:flex-row md:items-end md:justify-between md:px-7">
          <div className="max-w-4xl">
            <p className="label mb-3">Founding Engineer Assignment</p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
                Inference console with portable storage, provider routing, and telemetry dashboards.
              </h1>
              <span className="rounded-full border border-[var(--border)] bg-white/60 px-3 py-1 text-sm text-[var(--muted)]">
                Docker-ready and multi-provider aware
              </span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="metric-card px-4 py-3">
              <p className="label">Total inferences</p>
              <p className="mt-2 text-2xl font-semibold">{metrics?.totalInferences ?? 0}</p>
            </div>
            <div className="metric-card px-4 py-3">
              <p className="label">Success rate</p>
              <p className="mt-2 text-2xl font-semibold">{metrics?.successRate ?? 0}%</p>
            </div>
            <div className="metric-card px-4 py-3">
              <p className="label">Average latency</p>
              <p className="mt-2 text-2xl font-semibold">
                {metrics?.averageLatencyMs ? `${metrics.averageLatencyMs} ms` : "n/a"}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 bg-[rgba(18,51,45,0.95)] px-5 py-3 text-sm text-white md:px-7">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-[var(--accent-soft)]" />
            <span>{providerNotice}</span>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/15 md:hidden"
            onClick={() => setIsDrawerOpen((current) => !current)}
          >
            <PanelLeftOpen className="size-3.5" />
            Threads
          </button>
        </div>
      </section>

      <section className="animated-rise grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div className="rounded-2xl border border-[var(--border)] bg-white/55 px-4 py-3 text-sm text-[var(--muted)]">
          {runtimeInfo?.providerMode === "mock"
            ? "Local fallback is the current default runtime provider. Add external keys when you want hosted model responses."
            : `${getProviderLabel(runtimeInfo?.providerMode ?? "auto")} is the current default runtime provider.`}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white/55 px-4 py-3 text-sm">
          <span className="label">Model</span>
          <p className="mt-1 font-medium">{runtimeInfo?.model ?? "loading..."}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white/55 px-4 py-3 text-sm">
          <span className="label">Node</span>
          <p className="mt-1 font-medium">{runtimeInfo?.nodeVersion ?? "loading..."}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white/55 px-4 py-3 text-sm">
          <span className="label">Storage</span>
          <p className="mt-1 font-medium">{runtimeInfo?.storage ?? "loading..."}</p>
        </div>
      </section>

      {error ? (
        <div className="animated-rise flex items-start gap-3 rounded-2xl border border-[rgba(166,60,47,0.18)] bg-[rgba(255,241,238,0.92)] px-4 py-3 text-sm text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="grid min-h-[760px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
        <aside
          className={cn(
            "glass-panel animated-rise rounded-[1.75rem] border border-[var(--border)] p-4 lg:block",
            isDrawerOpen ? "block" : "hidden",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="label">Conversations</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">
                Resume prior threads
              </h2>
            </div>
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-2xl bg-[var(--surface-dark)] text-white transition hover:bg-[var(--surface-muted)]"
              onClick={() => void handleCreateConversation()}
              disabled={isCreating}
              aria-label="Create a new thread"
            >
              {isCreating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {conversations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/35 px-4 py-5 text-sm text-[var(--muted)]">
                Create a thread to start capturing messages and inference telemetry.
              </div>
            ) : (
              conversations.map((conversation, index) => (
                <button
                  type="button"
                  key={conversation.id}
                  className={cn(
                    "animated-rise w-full rounded-[1.4rem] border px-4 py-4 text-left transition",
                    conversation.id === activeConversationId
                      ? "border-[rgba(21,107,82,0.18)] bg-[rgba(18,51,45,0.95)] text-white"
                      : "border-[var(--border)] bg-white/45 hover:bg-white/70",
                  )}
                  style={{ animationDelay: `${index * 40}ms` }}
                  onClick={() => void handleSelectConversation(conversation.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium tracking-[-0.02em]">{conversation.title}</p>
                      <p
                        className={cn(
                          "mt-2 text-sm leading-6",
                          conversation.id === activeConversationId
                            ? "text-white/75"
                            : "text-[var(--muted)]",
                        )}
                      >
                        {conversation.lastPreview || "No messages yet"}
                      </p>
                    </div>
                    {conversation.activeRequestId ? (
                      <span className="mt-1 inline-flex size-2.5 rounded-full bg-[var(--accent-soft)]" />
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      "mt-4 flex items-center justify-between text-xs",
                      conversation.id === activeConversationId
                        ? "text-white/70"
                        : "text-[var(--muted)]",
                    )}
                  >
                    <span>{conversation.messageCount} messages</span>
                    <span>{formatTimestamp(conversation.lastMessageAt)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="glass-panel animated-rise flex min-h-[760px] flex-col rounded-[1.75rem] border border-[var(--border)]">
          <div className="border-b border-[var(--border)] px-5 py-4 md:px-6">
            <p className="label">Chatbot application</p>
            <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em]">
                  {activeConversation?.title || "Spin up a fresh conversation"}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                  Multi-turn context is trimmed to recent history before every provider call.
                  Each request is wrapped, timed, validated, and emitted to the ingestion endpoint in near real time.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-[var(--border)] bg-white/60 px-4 py-2 text-sm font-medium transition hover:bg-white"
                  onClick={() => void handleCreateConversation()}
                  disabled={isCreating}
                >
                  New thread
                </button>
                {isSending ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-dark)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void handleCancel()}
                    disabled={isCancelling}
                  >
                    {isCancelling ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Square className="size-3.5" />
                    )}
                    Cancel run
                  </button>
                ) : (
                  <div className="rounded-full border border-[var(--border)] bg-white/55 px-4 py-2 text-sm text-[var(--muted)]">
                    Idle
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div ref={messageViewportRef} className="flex-1 overflow-y-auto px-5 py-5 md:px-6">
            {isBooting ? (
              <div className="flex h-full items-center justify-center">
                <div className="inline-flex items-center gap-3 rounded-full bg-white/70 px-4 py-3 text-sm text-[var(--muted)]">
                  <Loader2 className="size-4 animate-spin" />
                  Loading the workspace…
                </div>
              </div>
            ) : emptyState ? (
              <div className="grid h-full place-items-center">
                <div className="max-w-xl text-center">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-[1.6rem] bg-[var(--surface-dark)] text-white">
                    <MessageSquareText className="size-7" />
                  </div>
                  <h3 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
                    The repo is ready for its first thread.
                  </h3>
                  <p className="mt-4 text-base leading-7 text-[var(--muted)]">
                    Create a conversation, send a few turns, switch providers, and watch the telemetry dashboard update.
                  </p>
                  <button
                    type="button"
                    className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105"
                    onClick={() => void handleCreateConversation()}
                  >
                    Start a conversation
                    <ArrowRight className="size-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <article
                    key={message.id}
                    className={cn(
                      "animated-rise rounded-[1.5rem] border px-4 py-4 md:px-5",
                      message.role === "USER"
                        ? "ml-auto max-w-3xl border-transparent bg-[rgba(206,107,44,0.12)]"
                        : "max-w-4xl border-[var(--border)] bg-[var(--surface-strong)]",
                    )}
                    style={{ animationDelay: `${index * 24}ms` }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span
                          className={cn(
                            "inline-flex size-9 items-center justify-center rounded-2xl",
                            message.role === "USER"
                              ? "bg-[rgba(206,107,44,0.18)] text-[var(--accent)]"
                              : "bg-[rgba(18,51,45,0.08)] text-[var(--surface-dark)]",
                          )}
                        >
                          {message.role === "USER" ? (
                            <Sparkles className="size-4" />
                          ) : (
                            <Bot className="size-4" />
                          )}
                        </span>
                        <span>{getRoleLabel(message.role)}</span>
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        {formatRelativeTime(message.createdAt)}
                      </div>
                    </div>
                    <div className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-[var(--foreground)]">
                      {message.content || (
                        <span className="inline-flex items-center gap-2 text-[var(--muted)]">
                          <Loader2 className="size-4 animate-spin" />
                          Thinking…
                        </span>
                      )}
                    </div>
                    {message.status !== "COMPLETED" ? (
                      <p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                        {message.status}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
            </div>
            <div className="border-t border-[var(--border)] bg-[rgba(244,239,230,0.9)] px-5 py-4 backdrop-blur md:px-6">
              <div className="mb-3 flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="rounded-full border border-[var(--border)] bg-white/60 px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:bg-white"
                    onClick={() => setDraft(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <form
                className="rounded-[1.6rem] border border-[var(--border)] bg-white/75 p-3 shadow-[0_16px_45px_rgba(31,29,25,0.07)]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSendMessage();
                }}
              >
                <textarea
                  ref={composerRef}
                  rows={3}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Press Enter to send, Shift+Enter for a new line."
                  className="min-h-[92px] w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-7 outline-none placeholder:text-[var(--muted)]"
                />
                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-6 text-[var(--muted)]">
                      Enter sends. Shift+Enter adds a new line. Provider choice applies per request.
                    </p>
                    <label className="relative inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/60 px-4 py-2 text-sm">
                      <span className="label !text-[10px]">Provider</span>
                      <select
                        value={selectedProvider}
                        onChange={(event) =>
                          setSelectedProvider(event.target.value as ProviderOption)
                        }
                        className="appearance-none bg-transparent pr-5 font-medium outline-none"
                      >
                        {(runtimeInfo?.availableProviders ?? ["auto", "mock"]).map((provider) => (
                          <option key={provider} value={provider}>
                            {getProviderLabel(provider)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-[var(--muted)]" />
                    </label>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="rounded-2xl bg-[rgba(18,51,45,0.06)] px-3 py-2 text-sm text-[var(--muted)]">
                      Current request mode:{" "}
                      <span className="font-semibold text-[var(--surface-dark)]">
                        {getProviderLabel(selectedProvider)}
                      </span>
                    </div>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--surface-dark)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!draft.trim() || isSending}
                    >
                      {isSending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Signal className="size-4" />
                      )}
                      Send message
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </section>

        <aside className="glass-panel animated-rise rounded-[1.75rem] border border-[var(--border)] p-4">
          <p className="label">Ingestion dashboard</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">
            What the SDK is capturing
          </h2>

          <div className="mt-4 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="metric-card px-4 py-4">
                <p className="label">Errors (24h)</p>
                <p className="mt-2 text-2xl font-semibold">{metrics?.errorsLast24h ?? 0}</p>
              </div>
              <div className="metric-card px-4 py-4">
                <p className="label">Tokens stored</p>
                <p className="mt-2 text-2xl font-semibold">{metrics?.totalTokens ?? 0}</p>
              </div>
              <div className="metric-card px-4 py-4">
                <p className="label">Providers</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(metrics?.providerMix.length
                    ? metrics.providerMix
                    : [{ provider: "none", count: 0 }]).map((item) => (
                    <span
                      key={`${item.provider}-${item.count}`}
                      className="rounded-full bg-[rgba(18,51,45,0.08)] px-3 py-1 text-sm text-[var(--surface-dark)]"
                    >
                      {item.provider} · {item.count}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] bg-[rgba(18,51,45,0.96)] px-4 py-4 text-white">
              <p className="label text-white/60">Metadata fields</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-white/82">
                <li>Model and provider</li>
                <li>Latency and timestamps</li>
                <li>Request and response previews</li>
                <li>Token usage and status</li>
                <li>Conversation and message IDs</li>
              </ul>
            </div>

            <div className="rounded-[1.5rem] border border-[var(--border)] bg-white/55 px-4 py-4">
              <p className="label">Throughput (7 days)</p>
              <div className="mt-3 space-y-3">
                {(dashboard?.throughputByDay.length
                  ? dashboard.throughputByDay
                  : [{ label: "n/a", count: 0 }]).map((item) => (
                  <div key={`${item.label}-${item.count}`}>
                    <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]">
                      <span>{item.label}</span>
                      <span>{item.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[rgba(18,51,45,0.08)]">
                      <div
                        className="h-2 rounded-full bg-[var(--surface-dark)]"
                        style={{ width: `${Math.max(8, (item.count / throughputMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-[var(--border)] bg-white/55 px-4 py-4">
              <p className="label">Latency buckets</p>
              <div className="mt-3 space-y-3">
                {(dashboard?.latencyBuckets.length
                  ? dashboard.latencyBuckets
                  : [{ bucket: "n/a", count: 0 }]).map((item) => (
                  <div key={`${item.bucket}-${item.count}`}>
                    <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]">
                      <span>{item.bucket}</span>
                      <span>{item.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[rgba(206,107,44,0.08)]">
                      <div
                        className="h-2 rounded-full bg-[var(--accent)]"
                        style={{ width: `${Math.max(8, (item.count / latencyBucketMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-[var(--border)] bg-white/55 px-4 py-4">
              <p className="label">Status breakdown</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(dashboard?.statusBreakdown.length
                  ? dashboard.statusBreakdown
                  : [{ status: "SUCCESS", count: 0 }]).map((item) => (
                  <span
                    key={`${item.status}-${item.count}`}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm font-medium",
                      getStatusTone(item.status),
                    )}
                  >
                    {item.status.toLowerCase()} · {item.count}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-[var(--border)] bg-white/55 px-4 py-4">
              <p className="label">Provider / model mix</p>
              <div className="mt-3 space-y-3">
                {(dashboard?.modelMix.length
                  ? dashboard.modelMix
                  : [{ provider: "none", model: "n/a", count: 0 }]).map((item) => (
                  <div
                    key={`${item.provider}-${item.model}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white/60 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-semibold">{item.provider}</p>
                      <p className="text-xs text-[var(--muted)]">{item.model}</p>
                    </div>
                    <span className="rounded-full bg-[rgba(18,51,45,0.08)] px-2.5 py-1 text-sm text-[var(--surface-dark)]">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="label">Recent events</p>
                  <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                    Latest inference logs
                  </h3>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {metrics?.recentLogs.length ? (
                  metrics.recentLogs.map((log) => (
                    <article
                      key={log.id}
                      className="rounded-[1.4rem] border border-[var(--border)] bg-white/55 px-4 py-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold">{log.provider}</span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-medium",
                            getStatusTone(log.status),
                          )}
                        >
                          {log.status.toLowerCase()}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted)]">{log.model}</p>
                      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
                        <span>{log.latencyMs ? `${log.latencyMs} ms` : "n/a"}</span>
                        <span>{formatTimestamp(log.createdAt)}</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[1.4rem] border border-dashed border-[var(--border)] bg-white/40 px-4 py-6 text-sm text-[var(--muted)]">
                    Send a message and this panel will start filling with persisted inference events.
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
