import { NextResponse } from "next/server";

import {
  completeAssistantMessage,
  createMessagePair,
  failAssistantMessage,
  getContextMessages,
  getConversationMessages,
  getConversationSummary,
} from "@/lib/server/conversations";
import {
  clearGeneration,
  registerGeneration,
} from "@/lib/server/generation-state";
import {
  InferenceExecutionError,
  runInstrumentedInference,
} from "@/lib/server/llm";
import { sendMessageSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const conversation = await getConversationSummary(conversationId);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const messages = await getConversationMessages(conversationId);
  return NextResponse.json({ conversation, messages });
}

export async function POST(request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const conversation = await getConversationSummary(conversationId);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const body = await request.json();
  const parsed = sendMessageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Message content is invalid." }, { status: 400 });
  }

  const pair = await createMessagePair(conversationId, parsed.data.content);

  if (!pair) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const controller = new AbortController();
  registerGeneration(conversationId, pair.assistantMessage.id, controller);

  try {
    const messages = await getContextMessages(conversationId);
    const result = await runInstrumentedInference({
      baseUrl: new URL(request.url).origin,
      conversationId,
      requestMessageId: pair.userMessage.id,
      responseMessageId: pair.assistantMessage.id,
      messages,
      signal: controller.signal,
      requestedProvider: parsed.data.provider,
    });

    await completeAssistantMessage({
      conversationId,
      assistantMessageId: pair.assistantMessage.id,
      content: result.text,
      inferenceLogId: result.inferenceLogId,
    });

    const [updatedConversation, updatedMessages] = await Promise.all([
      getConversationSummary(conversationId),
      getConversationMessages(conversationId),
    ]);

    return NextResponse.json({
      conversation: updatedConversation,
      messages: updatedMessages,
      source: result.source,
      inferenceLogId: result.inferenceLogId,
    });
  } catch (error) {
    if (error instanceof InferenceExecutionError && error.kind === "cancelled") {
      await failAssistantMessage({
        conversationId,
        assistantMessageId: pair.assistantMessage.id,
        status: "CANCELLED",
        content: "Generation cancelled by the user.",
      });

      const [updatedConversation, updatedMessages] = await Promise.all([
        getConversationSummary(conversationId),
        getConversationMessages(conversationId),
      ]);

      return NextResponse.json({
        conversation: updatedConversation,
        messages: updatedMessages,
        source: "mock",
        inferenceLogId: error.inferenceLogId,
      });
    }

    await failAssistantMessage({
      conversationId,
      assistantMessageId: pair.assistantMessage.id,
      status: "FAILED",
      content:
        "The assistant hit a provider error. The inference log still captured the failed request for inspection.",
    });

    const [updatedConversation, updatedMessages] = await Promise.all([
      getConversationSummary(conversationId),
      getConversationMessages(conversationId),
    ]);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The assistant could not complete the request.",
        conversation: updatedConversation,
        messages: updatedMessages,
      },
      { status: 502 },
    );
  } finally {
    clearGeneration(conversationId);
  }
}
