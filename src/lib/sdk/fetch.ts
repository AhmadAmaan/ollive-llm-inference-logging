import { randomUUID } from "node:crypto";

import { createDefaultRedactionPipeline } from "@/lib/sdk/redaction";
import type { FetchInstrumentationOptions, InferenceContext } from "@/lib/sdk/types";
import { emitAsync } from "@/lib/sdk/transport";

function previewRequestBody(body: BodyInit | null | undefined) {
  if (!body) {
    return null;
  }

  if (typeof body === "string") {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body instanceof Blob) {
    return `[BLOB:${body.type || "application/octet-stream"} size=${body.size}]`;
  }

  return "[UNAVAILABLE_BODY_PREVIEW]";
}

function resolveUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function detectProvider(url: string) {
  if (url.includes("api.openai.com")) {
    return "openai";
  }

  if (url.includes("api.anthropic.com")) {
    return "anthropic";
  }

  return "http";
}

async function safeResponsePreview(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (
    !contentType.includes("json") &&
    !contentType.includes("text") &&
    !contentType.includes("event-stream")
  ) {
    return `[UNINSPECTED_RESPONSE:${contentType || "unknown"}]`;
  }

  try {
    return await response.clone().text();
  } catch {
    return "[UNAVAILABLE_RESPONSE_PREVIEW]";
  }
}

export function instrumentFetch({
  emit,
  shouldInstrument,
  resolveContext,
  resolveUsage,
}: FetchInstrumentationOptions) {
  const originalFetch = globalThis.fetch;
  const redact = createDefaultRedactionPipeline();

  globalThis.fetch = async function instrumentedFetch(input: RequestInfo | URL, init?: RequestInit) {
    if (shouldInstrument && !shouldInstrument(input, init)) {
      return originalFetch(input, init);
    }

    const startedAt = new Date();
    const url = resolveUrl(input);
    const provider = detectProvider(url);
    const context: InferenceContext = {
      provider,
      model: "unknown",
      operation: init?.method || "fetch",
      sourceType: "fetch",
      ...resolveContext?.(input, init),
    };

    try {
      const response = await originalFetch(input, init);
      const completedAt = new Date();
      const responsePreview = await safeResponsePreview(response);
      const redaction = redact({
        input: previewRequestBody(init?.body),
        output: responsePreview,
        context,
      });

      emitAsync(emit, {
        eventId: randomUUID(),
        provider: context.provider,
        model: context.model,
        operation: context.operation,
        sourceType: context.sourceType,
        sessionId: context.sessionId ?? null,
        conversationId: context.conversationId ?? null,
        requestMessageId: context.requestMessageId ?? null,
        responseMessageId: context.responseMessageId ?? null,
        status: response.ok ? "success" : "error",
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        latencyMs: completedAt.getTime() - startedAt.getTime(),
        usage: resolveUsage?.(response, responsePreview),
        requestPreview: redaction.requestPreview ?? null,
        responsePreview: redaction.responsePreview ?? null,
        error: response.ok
          ? null
          : {
              code: `HTTP_${response.status}`,
              message: `Instrumented fetch failed with status ${response.status}.`,
            },
        metadata: {
          ...context.metadata,
          ...redaction.metadata,
          status: response.status,
          url,
        },
      });

      return response;
    } catch (error) {
      const completedAt = new Date();
      const redaction = redact({
        input: previewRequestBody(init?.body),
        error,
        context,
      });

      emitAsync(emit, {
        eventId: randomUUID(),
        provider: context.provider,
        model: context.model,
        operation: context.operation,
        sourceType: context.sourceType,
        sessionId: context.sessionId ?? null,
        conversationId: context.conversationId ?? null,
        requestMessageId: context.requestMessageId ?? null,
        responseMessageId: context.responseMessageId ?? null,
        status: "error",
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        latencyMs: completedAt.getTime() - startedAt.getTime(),
        requestPreview: redaction.requestPreview ?? null,
        responsePreview: redaction.responsePreview ?? null,
        error: {
          code: error instanceof Error ? error.name : "FetchError",
          message:
            error instanceof Error
              ? error.message
              : "Instrumented fetch failed unexpectedly.",
        },
        metadata: {
          ...context.metadata,
          ...redaction.metadata,
          url,
        },
      });

      throw error;
    }
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}
