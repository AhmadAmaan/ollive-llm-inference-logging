import { randomUUID } from "node:crypto";

import type { ProviderOption } from "@/lib/types";
import { truncate } from "@/lib/utils";
import { redactSensitiveText } from "@/lib/server/redaction";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type InferenceUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

type RunInferenceParams = {
  baseUrl: string;
  conversationId: string;
  requestMessageId: string;
  responseMessageId: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  requestedProvider?: ProviderOption;
};

type StreamEvent =
  | {
      type: "delta";
      text: string;
      source: "openai" | "anthropic" | "mock";
    }
  | {
      type: "completed";
      text: string;
      source: "openai" | "anthropic" | "mock";
      inferenceLogId: string | null;
    };

type ProviderStreamFinal = {
  usage?: InferenceUsage;
  metadata?: Record<string, unknown>;
  provider: "openai" | "anthropic" | "mock";
  model: string;
};

type SseEvent = {
  event?: string;
  data: string;
};

export class InferenceExecutionError extends Error {
  kind: "cancelled" | "error";
  code?: string | null;
  inferenceLogId: string | null;

  constructor(
    message: string,
    options: {
      kind: "cancelled" | "error";
      code?: string | null;
      inferenceLogId?: string | null;
    },
  ) {
    super(message);
    this.kind = options.kind;
    this.code = options.code ?? null;
    this.inferenceLogId = options.inferenceLogId ?? null;
  }
}

function getProviderConfig(requestedProvider: ProviderOption = "auto") {
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (requestedProvider === "openai") {
    if (!hasOpenAi) {
      throw new Error("OpenAI was requested, but OPENAI_API_KEY is not configured.");
    }

    return {
      provider: "openai" as const,
      model: process.env.LLM_MODEL || "gpt-4.1-mini",
    };
  }

  if (requestedProvider === "anthropic") {
    if (!hasAnthropic) {
      throw new Error("Anthropic was requested, but ANTHROPIC_API_KEY is not configured.");
    }

    return {
      provider: "anthropic" as const,
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
    };
  }

  if (requestedProvider === "mock") {
    return {
      provider: "mock" as const,
      model: "mock-fallback-v1",
    };
  }

  if (hasOpenAi) {
    return {
      provider: "openai" as const,
      model: process.env.LLM_MODEL || "gpt-4.1-mini",
    };
  }

  if (hasAnthropic) {
    return {
      provider: "anthropic" as const,
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
    };
  }

  return {
    provider: "mock" as const,
    model: "mock-fallback-v1",
  };
}

function normalizeProviderError(
  provider: "openai" | "anthropic",
  status: number,
  error: { code?: string; message?: string } | undefined,
) {
  const rawMessage = error?.message || "Provider request failed.";
  const code = error?.code || null;

  if (status === 401 || /api key/i.test(rawMessage) || code === "invalid_api_key") {
    return `${
      provider === "openai" ? "OpenAI" : "Anthropic"
    } rejected the API key. Check the corresponding key in .env and restart the server.`;
  }

  if (
    status === 429 ||
    code === "insufficient_quota" ||
    /quota/i.test(rawMessage) ||
    /billing/i.test(rawMessage)
  ) {
    return `${
      provider === "openai" ? "OpenAI" : "Anthropic"
    } API access is configured but billing or quota is unavailable for this key.`;
  }

  if (status >= 500) {
    return `${provider === "openai" ? "OpenAI" : "Anthropic"} is temporarily unavailable. Retry in a moment.`;
  }

  return rawMessage;
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function buildFallbackReply(messages: ChatMessage[], requestedProvider: ProviderOption = "auto") {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const prompt = latestUserMessage?.content.trim() || "the conversation";
  const lower = prompt.toLowerCase();

  if (lower.includes("inference logging")) {
    return [
      "Inference logging improves an LLM product in three ways: it makes failures diagnosable, helps quantify cost and latency, and creates the feedback loop needed to improve prompts, routing, and model choice over time.",
      "",
      "At the product level it supports faster incident response, clearer quality measurement, and more confident scaling decisions because every request can be tied back to provider behavior, usage, and outcome.",
    ].join("\n");
  }

  if (lower.includes("architecture")) {
    return [
      "A clean shape for this system is a chat surface, a provider wrapper, and an ingestion pipeline backed by relational storage.",
      "",
      "That separation keeps product behavior, observability, and persistence independently evolvable while still allowing request-level tracing across the full path.",
    ].join("\n");
  }

  return [
    `Fallback provider response for ${requestedProvider === "auto" ? "automatic routing" : requestedProvider}.`,
    "",
    `Prompt: ${truncate(prompt, 220)}`,
    "",
    "The local provider keeps the full chat, streaming, logging, and ingestion pipeline operational even when external model credentials are unavailable.",
  ].join("\n");
}

async function sleepWithAbort(durationMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseSseBlocks(buffer: string) {
  const blocks = buffer.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events: SseEvent[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    let eventName: string | undefined;
    const dataLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith(":")) {
        continue;
      }

      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length > 0) {
      events.push({
        event: eventName,
        data: dataLines.join("\n"),
      });
    }
  }

  return {
    events,
    remainder,
  };
}

async function* streamMockProvider(
  messages: ChatMessage[],
  signal: AbortSignal,
  requestedProvider: ProviderOption = "auto",
): AsyncGenerator<string, ProviderStreamFinal, void> {
  const text = buildFallbackReply(messages, requestedProvider);
  const chunks = text.split(/(\s+)/).filter(Boolean);

  for (const chunk of chunks) {
    await sleepWithAbort(28, signal);
    yield chunk;
  }

  const inputTokens = messages.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0,
  );
  const outputTokens = estimateTokens(text);

  return {
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    metadata: {
      mode: "fallback",
      requestedProvider,
      routing: "local",
    },
    provider: "mock",
    model: "mock-fallback-v1",
  };
}

async function* streamOpenAI(
  messages: ChatMessage[],
  model: string,
  signal: AbortSignal,
): AsyncGenerator<string, ProviderStreamFinal, void> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      stream: true,
      stream_options: {
        include_usage: true,
      },
      messages,
    }),
  });

  if (!response.ok) {
    const json = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };

    throw new Error(normalizeProviderError("openai", response.status, json.error));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("OpenAI did not return a readable stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let usage: InferenceUsage | undefined;
  let finishReason: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBlocks(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      if (event.data === "[DONE]") {
        continue;
      }

      const json = JSON.parse(event.data) as {
        choices?: Array<{
          delta?: {
            content?: string;
          };
          finish_reason?: string | null;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        yield delta;
      }

      if (json.choices?.[0]?.finish_reason) {
        finishReason = json.choices[0].finish_reason ?? null;
      }

      if (json.usage) {
        usage = {
          inputTokens: json.usage.prompt_tokens ?? null,
          outputTokens: json.usage.completion_tokens ?? null,
          totalTokens: json.usage.total_tokens ?? null,
        };
      }
    }
  }

  return {
    usage,
    metadata: {
      finishReason,
    },
    provider: "openai",
    model,
  };
}

async function* streamAnthropic(
  messages: ChatMessage[],
  model: string,
  signal: AbortSignal,
): AsyncGenerator<string, ProviderStreamFinal, void> {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .trim();

  const anthropicMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      temperature: 0.4,
      stream: true,
      system: system || undefined,
      messages: anthropicMessages,
    }),
  });

  if (!response.ok) {
    const json = (await response.json()) as {
      error?: {
        type?: string;
        message?: string;
      };
    };

    throw new Error(
      normalizeProviderError("anthropic", response.status, {
        code: json.error?.type,
        message: json.error?.message,
      }),
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Anthropic did not return a readable stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let stopReason: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBlocks(buffer);
    buffer = parsed.remainder;

    for (const sseEvent of parsed.events) {
      const json = JSON.parse(sseEvent.data) as {
        type?: string;
        delta?: {
          text?: string;
          stop_reason?: string | null;
        };
        message?: {
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
          };
        };
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      };

      const type = sseEvent.event || json.type;

      if (type === "content_block_delta") {
        const delta = json.delta?.text;
        if (delta) {
          yield delta;
        }
      }

      if (type === "message_start") {
        inputTokens = json.message?.usage?.input_tokens ?? inputTokens;
        outputTokens = json.message?.usage?.output_tokens ?? outputTokens;
      }

      if (type === "message_delta") {
        inputTokens = json.usage?.input_tokens ?? inputTokens;
        outputTokens = json.usage?.output_tokens ?? outputTokens;
        stopReason = json.delta?.stop_reason ?? stopReason;
      }

      if (type === "message_stop") {
        break;
      }
    }
  }

  return {
    usage: {
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens != null || outputTokens != null
          ? (inputTokens ?? 0) + (outputTokens ?? 0)
          : null,
    },
    metadata: {
      finishReason: stopReason,
    },
    provider: "anthropic",
    model,
  };
}

async function emitInferenceEvent(baseUrl: string, payload: Record<string, unknown>) {
  try {
    const response = await fetch(`${baseUrl}/api/ingest/inference`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { inferenceLogId?: string };
    return data.inferenceLogId ?? null;
  } catch {
    return null;
  }
}

function getResolvedProviderSnapshot(requestedProvider: ProviderOption = "auto") {
  try {
    return getProviderConfig(requestedProvider);
  } catch {
    return {
      provider:
        requestedProvider === "anthropic"
          ? ("anthropic" as const)
          : requestedProvider === "openai"
            ? ("openai" as const)
            : ("mock" as const),
      model:
        requestedProvider === "anthropic"
          ? process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest"
          : requestedProvider === "openai"
            ? process.env.LLM_MODEL || "gpt-4.1-mini"
            : "mock-fallback-v1",
    };
  }
}

async function* providerStream(
  requestedProvider: ProviderOption,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string, ProviderStreamFinal, void> {
  const { provider, model } = getProviderConfig(requestedProvider);

  if (provider === "openai") {
    return yield* streamOpenAI(messages, model, signal);
  }

  if (provider === "anthropic") {
    return yield* streamAnthropic(messages, model, signal);
  }

  return yield* streamMockProvider(messages, signal, requestedProvider);
}

export async function* streamInstrumentedInference({
  baseUrl,
  conversationId,
  requestMessageId,
  responseMessageId,
  messages,
  signal,
  requestedProvider = "auto",
}: RunInferenceParams): AsyncGenerator<StreamEvent, void, void> {
  const startedAt = new Date();
  const eventId = randomUUID();
  const stream = providerStream(requestedProvider, messages, signal);
  const iterator = stream[Symbol.asyncIterator]();
  let accumulated = "";

  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        const completedAt = new Date();
        const finalMeta = next.value;
        const inferenceLogId = await emitInferenceEvent(baseUrl, {
          eventId,
          conversationId,
          requestMessageId,
          responseMessageId,
          provider: finalMeta.provider,
          model: finalMeta.model,
          status: "success",
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          latencyMs: completedAt.getTime() - startedAt.getTime(),
          usage: finalMeta.usage,
          requestPreview: truncate(
            redactSensitiveText(
              messages.map((message) => `${message.role}: ${message.content}`).join("\n"),
            ) || "",
            320,
          ),
          responsePreview: truncate(redactSensitiveText(accumulated) || "", 320),
          metadata: finalMeta.metadata,
        });

        yield {
          type: "completed",
          text: accumulated,
          source: finalMeta.provider,
          inferenceLogId,
        };
        return;
      }

      accumulated += next.value;
      yield {
        type: "delta",
        text: next.value,
        source: getResolvedProviderSnapshot(requestedProvider).provider,
      };
    }
  } catch (error) {
    const completedAt = new Date();
    const kind = isAbortError(error) ? "cancelled" : "error";
    const message =
      error instanceof Error ? error.message : "Unexpected provider execution error.";
    const resolved = getResolvedProviderSnapshot(requestedProvider);
    const inferenceLogId = await emitInferenceEvent(baseUrl, {
      eventId,
      conversationId,
      requestMessageId,
      responseMessageId,
      provider: resolved.provider,
      model: resolved.model,
      status: kind,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      latencyMs: completedAt.getTime() - startedAt.getTime(),
      usage: undefined,
      requestPreview: truncate(
        redactSensitiveText(
          messages.map((item) => `${item.role}: ${item.content}`).join("\n"),
        ) || "",
        320,
      ),
      responsePreview: truncate(redactSensitiveText(accumulated) || "", 320),
      error: {
        code: isAbortError(error) ? "REQUEST_ABORTED" : "PROVIDER_ERROR",
        message,
      },
      metadata: {
        provider: resolved.provider,
        model: resolved.model,
        requestedProvider,
      },
    });

    throw new InferenceExecutionError(message, {
      kind,
      code: isAbortError(error) ? "REQUEST_ABORTED" : "PROVIDER_ERROR",
      inferenceLogId,
    });
  }
}

export async function runInstrumentedInference(params: RunInferenceParams) {
  let completed: StreamEvent | null = null;

  for await (const event of streamInstrumentedInference(params)) {
    if (event.type === "completed") {
      completed = event;
    }
  }

  if (!completed || completed.type !== "completed") {
    throw new Error("Inference stream completed without a final payload.");
  }

  return {
    text: completed.text,
    source: completed.source,
    inferenceLogId: completed.inferenceLogId,
  };
}
