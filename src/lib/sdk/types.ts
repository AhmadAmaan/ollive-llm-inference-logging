export type InferenceUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

export type InferenceStatus = "success" | "error" | "cancelled";

export type InferenceContext = {
  provider: string;
  model: string;
  operation: string;
  sourceType?: "sdk" | "chat" | "fetch" | "http";
  sessionId?: string | null;
  conversationId?: string | null;
  requestMessageId?: string | null;
  responseMessageId?: string | null;
  metadata?: Record<string, unknown>;
};

export type InferenceErrorPayload = {
  code?: string | null;
  message?: string | null;
};

export type InferenceEvent = {
  eventId: string;
  provider: string;
  model: string;
  operation: string;
  sourceType?: "sdk" | "chat" | "fetch" | "http";
  sessionId?: string | null;
  conversationId?: string | null;
  requestMessageId?: string | null;
  responseMessageId?: string | null;
  status: InferenceStatus;
  startedAt: string;
  completedAt?: string | null;
  latencyMs?: number | null;
  usage?: InferenceUsage;
  requestPreview?: string | null;
  responsePreview?: string | null;
  error?: InferenceErrorPayload | null;
  metadata?: Record<string, unknown>;
};

export type RedactionInput = {
  input: unknown;
  output?: unknown;
  error?: unknown;
  context: InferenceContext;
};

export type RedactionResult = {
  requestPreview?: string | null;
  responsePreview?: string | null;
  metadata?: Record<string, unknown>;
};

export type RedactionStrategy = {
  name: string;
  redact: (payload: RedactionInput) => RedactionResult | null;
};

export type EmitTransport = (event: InferenceEvent) => Promise<void>;

export type WrapInferenceOptions<TInput, TOutput> = {
  context: InferenceContext;
  input: TInput;
  execute: () => Promise<TOutput>;
  usage?: InferenceUsage;
  metadata?: Record<string, unknown>;
};

export type FetchInstrumentationOptions = {
  emit: EmitTransport;
  shouldInstrument?: (input: RequestInfo | URL, init?: RequestInit) => boolean;
  resolveContext?: (
    input: RequestInfo | URL,
    init?: RequestInit,
    response?: Response,
  ) => Partial<InferenceContext>;
  resolveUsage?: (response: Response, responseText: string) => InferenceUsage | undefined;
};
