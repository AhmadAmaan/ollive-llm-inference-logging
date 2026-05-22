import { MessageRecord } from "@/lib/types";
import { NextResponse } from "next/server";

import {
  completeAssistantMessage,
  createMessagePair,
  failAssistantMessage,
  getContextMessages,
  getConversationMessages,
  getConversationSummary,
} from "@/lib/ui-app/conversations";
import { clearGeneration, registerGeneration } from "@/lib/ui-app/generation-state";
import {
  InferenceExecutionError,
  streamInstrumentedInference,
} from "@/lib/ui-app/llm";
import { sendMessageSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
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
      conversation: Awaited<ReturnType<typeof getConversationSummary>>;
      messages: Awaited<ReturnType<typeof getConversationMessages>>;
      source: "openai" | "anthropic" | "mock";
      inferenceLogId: string | null;
    }
  | {
      type: "error";
      error: string;
      conversation: Awaited<ReturnType<typeof getConversationSummary>>;
      messages: Awaited<ReturnType<typeof getConversationMessages>>;
    };

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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controllerStream) {
      const send = (payload: StreamChunk) => {
        controllerStream.enqueue(
          encoder.encode(`${JSON.stringify(payload)}\n`),
        );
      };

      try {
        send({
          type: "ack",
          conversationId,
          userMessage: pair.userMessage,
          assistantMessage: pair.assistantMessage,
        });

        const messages = await getContextMessages(conversationId);

        for await (const event of streamInstrumentedInference({
          baseUrl: new URL(request.url).origin,
          conversationId,
          requestMessageId: pair.userMessage.id,
          responseMessageId: pair.assistantMessage.id,
          messages,
          signal: controller.signal,
          requestedProvider: parsed.data.provider,
        })) {
          if (event.type === "delta") {
            send({
              type: "delta",
              assistantMessageId: pair.assistantMessage.id,
              text: event.text,
              source: event.source,
            });
            continue;
          }

          await completeAssistantMessage({
            conversationId,
            assistantMessageId: pair.assistantMessage.id,
            content: event.text,
            inferenceLogId: event.inferenceLogId,
          });

          const [updatedConversation, updatedMessages] = await Promise.all([
            getConversationSummary(conversationId),
            getConversationMessages(conversationId),
          ]);

          send({
            type: "complete",
            conversation: updatedConversation,
            messages: updatedMessages,
            source: event.source,
            inferenceLogId: event.inferenceLogId,
          });
        }
      } catch (error) {
        if (error instanceof InferenceExecutionError && error.kind === "cancelled") {
          await failAssistantMessage({
            conversationId,
            assistantMessageId: pair.assistantMessage.id,
            status: "CANCELLED",
            content: "Generation cancelled by the user.",
          });
        } else {
          await failAssistantMessage({
            conversationId,
            assistantMessageId: pair.assistantMessage.id,
            status: "FAILED",
            content:
              "The assistant hit a provider error. The inference log still captured the failed request for inspection.",
          });
        }

        const [updatedConversation, updatedMessages] = await Promise.all([
          getConversationSummary(conversationId),
          getConversationMessages(conversationId),
        ]);

        send({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "The assistant could not complete the request.",
          conversation: updatedConversation,
          messages: updatedMessages,
        });
      } finally {
        clearGeneration(conversationId);
        controllerStream.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
