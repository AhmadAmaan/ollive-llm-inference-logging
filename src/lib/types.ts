export type ProviderOption = "auto" | "openai" | "anthropic" | "mock";

export type ConversationSummary = {
  id: string;
  title: string;
  status: "ACTIVE" | "CANCELLED" | "COMPLETED";
  updatedAt: string;
  lastMessageAt: string | null;
  lastPreview: string | null;
  messageCount: number;
  inferenceCount: number;
  activeRequestId: string | null;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  status: "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED";
  content: string;
  sequenceNumber: number;
  createdAt: string;
};

export type MetricsOverview = {
  totalInferences: number;
  successRate: number;
  averageLatencyMs: number | null;
  errorsLast24h: number;
  totalTokens: number;
  providerMix: Array<{
    provider: string;
    count: number;
  }>;
  recentLogs: Array<{
    id: string;
    status: "SUCCESS" | "ERROR" | "CANCELLED";
    provider: string;
    model: string;
    latencyMs: number | null;
    createdAt: string;
  }>;
};

export type DashboardMetrics = {
  throughputByDay: Array<{
    label: string;
    count: number;
  }>;
  statusBreakdown: Array<{
    status: "SUCCESS" | "ERROR" | "CANCELLED";
    count: number;
  }>;
  latencyBuckets: Array<{
    bucket: string;
    count: number;
  }>;
  modelMix: Array<{
    provider: string;
    model: string;
    count: number;
  }>;
};

export type ConversationPayload = {
  conversation: ConversationSummary;
};

export type MessagesPayload = {
  conversation: ConversationSummary;
  messages: MessageRecord[];
};

export type SendMessagePayload = MessagesPayload & {
  source: "openai" | "anthropic" | "mock";
  inferenceLogId: string | null;
};
