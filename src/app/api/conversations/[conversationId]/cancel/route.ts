import { NextResponse } from "next/server";

import {
  cancelPendingConversationRun,
  getConversationMessages,
  getConversationSummary,
} from "@/lib/server/conversations";
import { cancelGeneration, clearGeneration } from "@/lib/server/generation-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const conversation = await getConversationSummary(conversationId);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  cancelGeneration(conversationId);
  clearGeneration(conversationId);
  await cancelPendingConversationRun(conversationId);

  const [updatedConversation, messages] = await Promise.all([
    getConversationSummary(conversationId),
    getConversationMessages(conversationId),
  ]);

  return NextResponse.json({
    conversation: updatedConversation,
    messages,
  });
}
