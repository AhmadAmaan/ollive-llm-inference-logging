import { randomUUID } from "node:crypto";

import { query, queryOne, withTransaction } from "@/lib/db";
import type { ConversationSummary, MessageRecord } from "@/lib/types";
import { truncate } from "@/lib/utils";

type ConversationRow = {
  id: string;
  title: string;
  status: "ACTIVE" | "CANCELLED" | "COMPLETED";
  updated_at: Date;
  last_message_at: Date | null;
  active_request_id: string | null;
  last_preview: string | null;
  message_count: string | number;
  inference_count: string | number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  status: "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED";
  content: string;
  sequence_number: number;
  created_at: Date;
};

function nowIso() {
  return new Date().toISOString();
}

function serializeConversation(conversation: ConversationRow): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    updatedAt: conversation.updated_at.toISOString(),
    lastMessageAt: conversation.last_message_at?.toISOString() ?? null,
    lastPreview: conversation.last_preview
      ? truncate(conversation.last_preview, 96)
      : null,
    messageCount: Number(conversation.message_count),
    inferenceCount: Number(conversation.inference_count),
    activeRequestId: conversation.active_request_id ?? null,
  };
}

function serializeMessage(message: MessageRow): MessageRecord {
  return {
    id: message.id,
    conversationId: message.conversation_id,
    role: message.role,
    status: message.status,
    content: message.content,
    sequenceNumber: Number(message.sequence_number),
    createdAt: message.created_at.toISOString(),
  };
}

async function selectConversation(conversationId: string) {
  return queryOne<ConversationRow>(
    `
      SELECT
        c.id,
        c.title,
        c.status,
        c.updated_at,
        c.last_message_at,
        c.active_request_id,
        (
          SELECT m.content
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.sequence_number DESC
          LIMIT 1
        ) AS last_preview,
        (
          SELECT COUNT(*)
          FROM messages m
          WHERE m.conversation_id = c.id
        ) AS message_count,
        (
          SELECT COUNT(*)
          FROM inference_logs l
          WHERE l.conversation_id = c.id
        ) AS inference_count
      FROM conversations c
      WHERE c.id = $1
    `,
    [conversationId],
  );
}

export async function listConversations() {
  const result = await query<ConversationRow>(`
    SELECT
      c.id,
      c.title,
      c.status,
      c.updated_at,
      c.last_message_at,
      c.active_request_id,
      (
        SELECT m.content
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.sequence_number DESC
        LIMIT 1
      ) AS last_preview,
      (
        SELECT COUNT(*)
        FROM messages m
        WHERE m.conversation_id = c.id
      ) AS message_count,
      (
        SELECT COUNT(*)
        FROM inference_logs l
        WHERE l.conversation_id = c.id
      ) AS inference_count
    FROM conversations c
    ORDER BY c.updated_at DESC
  `);

  return result.rows.map(serializeConversation);
}

export async function getConversationSummary(conversationId: string) {
  const conversation = await selectConversation(conversationId);
  return conversation ? serializeConversation(conversation) : null;
}

export async function getConversationMessages(conversationId: string) {
  const result = await query<MessageRow>(
    `
      SELECT
        id,
        conversation_id,
        role,
        status,
        content,
        sequence_number,
        created_at
      FROM messages
      WHERE conversation_id = $1
      ORDER BY sequence_number ASC
    `,
    [conversationId],
  );

  return result.rows.map(serializeMessage);
}

export async function createConversation(title?: string) {
  const id = randomUUID();
  const timestamp = nowIso();

  await query(
    `
      INSERT INTO conversations (
        id,
        title,
        status,
        active_request_id,
        created_at,
        updated_at,
        last_message_at
      ) VALUES ($1, $2, 'ACTIVE', NULL, $3, $4, NULL)
    `,
    [id, title?.trim() || "New conversation", timestamp, timestamp],
  );

  const conversation = await getConversationSummary(id);
  if (!conversation) {
    throw new Error("Conversation could not be created.");
  }

  return conversation;
}

export async function createMessagePair(conversationId: string, content: string) {
  const timestamp = nowIso();

  return withTransaction(async (client) => {
    const conversationResult = await client.query<{ id: string; title: string }>(
      `
        SELECT id, title
        FROM conversations
        WHERE id = $1
      `,
      [conversationId],
    );

    const conversation = conversationResult.rows[0];
    if (!conversation) {
      return null;
    }

    const lastMessageResult = await client.query<{ sequence_number: number }>(
      `
        SELECT sequence_number
        FROM messages
        WHERE conversation_id = $1
        ORDER BY sequence_number DESC
        LIMIT 1
      `,
      [conversationId],
    );

    const nextSequence = Number(lastMessageResult.rows[0]?.sequence_number ?? 0) + 1;
    const nextTitle =
      conversation.title === "New conversation"
        ? truncate(content.replace(/\s+/g, " ").trim(), 48)
        : conversation.title;
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();

    await client.query(
      `
        INSERT INTO messages (
          id,
          conversation_id,
          role,
          content,
          status,
          sequence_number,
          created_at,
          updated_at
        ) VALUES ($1, $2, 'USER', $3, 'COMPLETED', $4, $5, $6)
      `,
      [userMessageId, conversationId, content, nextSequence, timestamp, timestamp],
    );

    await client.query(
      `
        INSERT INTO messages (
          id,
          conversation_id,
          role,
          content,
          status,
          sequence_number,
          created_at,
          updated_at
        ) VALUES ($1, $2, 'ASSISTANT', '', 'PENDING', $3, $4, $5)
      `,
      [assistantMessageId, conversationId, nextSequence + 1, timestamp, timestamp],
    );

    await client.query(
      `
        UPDATE conversations
        SET
          title = $1,
          active_request_id = $2,
          last_message_at = $3,
          updated_at = $4
        WHERE id = $5
      `,
      [nextTitle, assistantMessageId, timestamp, timestamp, conversationId],
    );

    return {
      userMessage: serializeMessage({
        id: userMessageId,
        conversation_id: conversationId,
        role: "USER",
        status: "COMPLETED",
        content,
        sequence_number: nextSequence,
        created_at: new Date(timestamp),
      }),
      assistantMessage: serializeMessage({
        id: assistantMessageId,
        conversation_id: conversationId,
        role: "ASSISTANT",
        status: "PENDING",
        content: "",
        sequence_number: nextSequence + 1,
        created_at: new Date(timestamp),
      }),
    };
  });
}

export async function getContextMessages(conversationId: string) {
  const result = await query<Pick<MessageRow, "role" | "content">>(
    `
      SELECT role, content
      FROM messages
      WHERE conversation_id = $1
        AND status != 'PENDING'
      ORDER BY sequence_number DESC
      LIMIT 10
    `,
    [conversationId],
  );

  return result.rows.reverse().map(
    (message): { role: "user" | "system" | "assistant"; content: string } => ({
      role:
        message.role === "USER"
          ? "user"
          : message.role === "SYSTEM"
            ? "system"
            : "assistant",
      content: message.content,
    }),
  );
}

export async function completeAssistantMessage(params: {
  conversationId: string;
  assistantMessageId: string;
  content: string;
  inferenceLogId: string | null;
}) {
  const timestamp = nowIso();

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE messages
        SET
          content = $1,
          status = 'COMPLETED',
          updated_at = $2
        WHERE id = $3
      `,
      [params.content, timestamp, params.assistantMessageId],
    );

    if (params.inferenceLogId) {
      await client.query(
        `
          UPDATE inference_logs
          SET response_message_id = $1
          WHERE id = $2
        `,
        [params.assistantMessageId, params.inferenceLogId],
      );
    }

    await client.query(
      `
        UPDATE conversations
        SET
          active_request_id = NULL,
          last_message_at = $1,
          updated_at = $2
        WHERE id = $3
      `,
      [timestamp, timestamp, params.conversationId],
    );
  });
}

export async function failAssistantMessage(params: {
  conversationId: string;
  assistantMessageId: string;
  status: "CANCELLED" | "FAILED";
  content: string;
}) {
  const timestamp = nowIso();

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE messages
        SET
          content = $1,
          status = $2,
          updated_at = $3
        WHERE id = $4
      `,
      [params.content, params.status, timestamp, params.assistantMessageId],
    );

    await client.query(
      `
        UPDATE conversations
        SET
          active_request_id = NULL,
          last_message_at = $1,
          updated_at = $2
        WHERE id = $3
      `,
      [timestamp, timestamp, params.conversationId],
    );
  });
}

export async function cancelPendingConversationRun(conversationId: string) {
  const timestamp = nowIso();

  return withTransaction(async (client) => {
    const pendingResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM messages
        WHERE conversation_id = $1
          AND role = 'ASSISTANT'
          AND status = 'PENDING'
        ORDER BY sequence_number DESC
        LIMIT 1
      `,
      [conversationId],
    );

    const pending = pendingResult.rows[0];
    if (!pending) {
      await client.query(
        `
          UPDATE conversations
          SET active_request_id = NULL, updated_at = $1
          WHERE id = $2
        `,
        [timestamp, conversationId],
      );
      return false;
    }

    await client.query(
      `
        UPDATE messages
        SET
          status = 'CANCELLED',
          content = 'Generation cancelled by the user.',
          updated_at = $1
        WHERE id = $2
      `,
      [timestamp, pending.id],
    );

    await client.query(
      `
        UPDATE conversations
        SET
          active_request_id = NULL,
          last_message_at = $1,
          updated_at = $2
        WHERE id = $3
      `,
      [timestamp, timestamp, conversationId],
    );

    return true;
  });
}
