import { randomUUID } from "node:crypto";

import type {
  EmitTransport,
  InferenceContext,
  InferenceErrorPayload,
  InferenceEvent,
  InferenceSdk,
  RedactionInput,
  RedactionResult,
  WrapInferenceOptions,
} from "@/lib/sdk/types";
import { createDefaultRedactionPipeline } from "@/lib/sdk/redaction";
import { emitAsync } from "@/lib/sdk/transport";

type CreateInferenceSdkOptions = {
  transport: EmitTransport;
  redact?: (payload: RedactionInput) => RedactionResult;
};

function normalizeError(error: unknown): InferenceErrorPayload {
  if (error instanceof Error) {
    return {
      code: error.name || "Error",
      message: error.message,
    };
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return {
      code:
        "name" in error && typeof error.name === "string"
          ? error.name
          : "Error",
      message: error.message,
    };
  }

  return {
    code: "UnknownError",
    message: typeof error === "string" ? error : "Unknown inference failure.",
  };
}

export function createInferenceSdk({
  transport,
  redact = createDefaultRedactionPipeline(),
}: CreateInferenceSdkOptions): InferenceSdk {
  function buildBaseEvent(
    context: InferenceContext,
    startedAt: Date,
    completedAt: Date,
  ) {
    return {
      eventId: randomUUID(),
      provider: context.provider,
      model: context.model,
      operation: context.operation,
      sourceType: context.sourceType ?? "sdk",
      sessionId: context.sessionId ?? null,
      conversationId: context.conversationId ?? null,
      requestMessageId: context.requestMessageId ?? null,
      responseMessageId: context.responseMessageId ?? null,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      latencyMs: completedAt.getTime() - startedAt.getTime(),
      metadata: context.metadata,
    } satisfies Omit<InferenceEvent, "status">;
  }

  function recordEvent(event: InferenceEvent) {
    emitAsync(transport, event);
    return event.eventId;
  }

  function recordSuccess(options: {
    context: InferenceContext;
    input: unknown;
    output: unknown;
    startedAt: Date;
    completedAt?: Date;
    usage?: InferenceEvent["usage"];
    metadata?: Record<string, unknown>;
  }) {
    const completedAt = options.completedAt ?? new Date();
    const redaction = redact({
      input: options.input,
      output: options.output,
      context: options.context,
    });

    return recordEvent({
      ...buildBaseEvent(options.context, options.startedAt, completedAt),
      status: "success",
      usage: options.usage,
      requestPreview: redaction.requestPreview ?? null,
      responsePreview: redaction.responsePreview ?? null,
      metadata: {
        ...options.context.metadata,
        ...options.metadata,
        ...redaction.metadata,
      },
    });
  }

  function recordFailure(options: {
    context: InferenceContext;
    input: unknown;
    output?: unknown;
    error: unknown;
    startedAt: Date;
    completedAt?: Date;
    status?: "error" | "cancelled";
    metadata?: Record<string, unknown>;
  }) {
    const completedAt = options.completedAt ?? new Date();
    const redaction = redact({
      input: options.input,
      output: options.output,
      error: options.error,
      context: options.context,
    });

    return recordEvent({
      ...buildBaseEvent(options.context, options.startedAt, completedAt),
      status: options.status ?? "error",
      requestPreview: redaction.requestPreview ?? null,
      responsePreview: redaction.responsePreview ?? null,
      error: normalizeError(options.error),
      metadata: {
        ...options.context.metadata,
        ...options.metadata,
        ...redaction.metadata,
      },
    });
  }

  async function wrap<TInput, TOutput>({
    context,
    input,
    execute,
    usage,
    metadata,
  }: WrapInferenceOptions<TInput, TOutput>) {
    const startedAt = new Date();

    try {
      const output = await execute();
      recordSuccess({
        context,
        input,
        output,
        startedAt,
        usage,
        metadata,
      });
      return output;
    } catch (error) {
      recordFailure({
        context,
        input,
        error,
        startedAt,
        metadata,
      });
      throw error;
    }
  }

  return {
    wrap,
    recordSuccess,
    recordFailure,
  };
}
