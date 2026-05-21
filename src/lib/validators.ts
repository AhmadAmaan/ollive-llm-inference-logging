import { z } from "zod";

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  provider: z.enum(["auto", "openai", "anthropic", "mock"]).optional(),
});

export const inferenceEventSchema = z.object({
  eventId: z.string().min(1),
  conversationId: z.string().min(1),
  requestMessageId: z.string().min(1).nullable().optional(),
  responseMessageId: z.string().min(1).nullable().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: z.enum(["success", "error", "cancelled"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
  latencyMs: z.number().int().nonnegative().nullable().optional(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().nullable().optional(),
      outputTokens: z.number().int().nonnegative().nullable().optional(),
      totalTokens: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
  requestPreview: z.string().max(500).nullable().optional(),
  responsePreview: z.string().max(500).nullable().optional(),
  error: z
    .object({
      code: z.string().min(1).nullable().optional(),
      message: z.string().min(1).nullable().optional(),
    })
    .nullable()
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InferenceEventInput = z.infer<typeof inferenceEventSchema>;
