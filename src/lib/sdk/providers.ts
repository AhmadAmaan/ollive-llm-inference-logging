import type { InferenceSdk, InferenceUsage } from "@/lib/sdk/types";

type OpenAIResponsesClient = {
  responses?: {
    create?: (input: unknown) => Promise<unknown>;
  };
  chat?: {
    completions?: {
      create?: (input: unknown) => Promise<unknown>;
    };
  };
};

type AnthropicClient = {
  messages?: {
    create?: (input: unknown) => Promise<unknown>;
  };
};

type ProviderInstrumentationDefaults = {
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
};

function extractModel(input: unknown, fallback: string) {
  if (
    input &&
    typeof input === "object" &&
    "model" in input &&
    typeof input.model === "string"
  ) {
    return input.model;
  }

  return fallback;
}

function extractOpenAIUsage(result: unknown): InferenceUsage | undefined {
  if (!result || typeof result !== "object" || !("usage" in result)) {
    return undefined;
  }

  const usage = result.usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  return {
    inputTokens:
      "prompt_tokens" in usage && typeof usage.prompt_tokens === "number"
        ? usage.prompt_tokens
        : "input_tokens" in usage && typeof usage.input_tokens === "number"
          ? usage.input_tokens
          : null,
    outputTokens:
      "completion_tokens" in usage && typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : "output_tokens" in usage && typeof usage.output_tokens === "number"
          ? usage.output_tokens
          : null,
    totalTokens:
      "total_tokens" in usage && typeof usage.total_tokens === "number"
        ? usage.total_tokens
        : null,
  };
}

function extractAnthropicUsage(result: unknown): InferenceUsage | undefined {
  if (!result || typeof result !== "object" || !("usage" in result)) {
    return undefined;
  }

  const usage = result.usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const inputTokens =
    "input_tokens" in usage && typeof usage.input_tokens === "number"
      ? usage.input_tokens
      : null;
  const outputTokens =
    "output_tokens" in usage && typeof usage.output_tokens === "number"
      ? usage.output_tokens
      : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens != null || outputTokens != null
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : null,
  };
}

export function instrumentOpenAIClient(
  client: OpenAIResponsesClient,
  sdk: InferenceSdk,
  defaults?: ProviderInstrumentationDefaults,
) {
  const restorers: Array<() => void> = [];

  const responsesCreate = client.responses?.create;
  if (responsesCreate) {
    client.responses!.create = async function instrumentedResponsesCreate(input: unknown) {
      const startedAt = new Date();

      try {
        const result = await responsesCreate.call(client.responses, input);
        sdk.recordSuccess({
          context: {
            provider: "openai",
            model: extractModel(input, "unknown"),
            operation: "openai.responses.create",
            sessionId: defaults?.sessionId ?? null,
            metadata: defaults?.metadata,
          },
          input,
          output: result,
          startedAt,
          usage: extractOpenAIUsage(result),
          metadata: {
            instrumentationMode: "monkey-patched-client",
          },
        });
        return result;
      } catch (error) {
        sdk.recordFailure({
          context: {
            provider: "openai",
            model: extractModel(input, "unknown"),
            operation: "openai.responses.create",
            sessionId: defaults?.sessionId ?? null,
            metadata: defaults?.metadata,
          },
          input,
          error,
          startedAt,
          metadata: {
            instrumentationMode: "monkey-patched-client",
          },
        });
        throw error;
      }
    };

    restorers.push(() => {
      client.responses!.create = responsesCreate;
    });
  }

  const chatCreate = client.chat?.completions?.create;
  if (chatCreate) {
    client.chat!.completions!.create = async function instrumentedChatCreate(input: unknown) {
      const startedAt = new Date();
      try {
        const result = await chatCreate.call(client.chat?.completions, input);
        sdk.recordSuccess({
          context: {
            provider: "openai",
            model: extractModel(input, "unknown"),
            operation: "openai.chat.completions.create",
            sessionId: defaults?.sessionId ?? null,
            metadata: defaults?.metadata,
          },
          input,
          output: result,
          startedAt,
          usage: extractOpenAIUsage(result),
          metadata: {
            instrumentationMode: "monkey-patched-client",
          },
        });
        return result;
      } catch (error) {
        sdk.recordFailure({
          context: {
            provider: "openai",
            model: extractModel(input, "unknown"),
            operation: "openai.chat.completions.create",
            sessionId: defaults?.sessionId ?? null,
            metadata: defaults?.metadata,
          },
          input,
          error,
          startedAt,
          metadata: {
            instrumentationMode: "monkey-patched-client",
          },
        });
        throw error;
      }
    };

    restorers.push(() => {
      client.chat!.completions!.create = chatCreate;
    });
  }

  return () => {
    restorers.forEach((restore) => restore());
  };
}

export function instrumentAnthropicClient(
  client: AnthropicClient,
  sdk: InferenceSdk,
  defaults?: ProviderInstrumentationDefaults,
) {
  const messagesCreate = client.messages?.create;
  if (!messagesCreate) {
    return () => undefined;
  }

  client.messages!.create = async function instrumentedMessagesCreate(input: unknown) {
    const startedAt = new Date();

    try {
      const result = await messagesCreate.call(client.messages, input);
      sdk.recordSuccess({
        context: {
          provider: "anthropic",
          model: extractModel(input, "unknown"),
          operation: "anthropic.messages.create",
          sessionId: defaults?.sessionId ?? null,
          metadata: defaults?.metadata,
        },
        input,
        output: result,
        startedAt,
        usage: extractAnthropicUsage(result),
        metadata: {
          instrumentationMode: "monkey-patched-client",
        },
      });
      return result;
    } catch (error) {
      sdk.recordFailure({
        context: {
          provider: "anthropic",
          model: extractModel(input, "unknown"),
          operation: "anthropic.messages.create",
          sessionId: defaults?.sessionId ?? null,
          metadata: defaults?.metadata,
        },
        input,
        error,
        startedAt,
        metadata: {
          instrumentationMode: "monkey-patched-client",
        },
      });
      throw error;
    }
  };

  return () => {
    client.messages!.create = messagesCreate;
  };
}
