import { desc, eq, asc } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { conversations, messages } from '../../db/schema.ts';
import { Conversation, ConversationWithLastMessage, Message } from '@sms/shared';

function toIso(d: Date): string {
  return d.toISOString();
}

function mapMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    twilioSid: row.twilioSid ?? null,
    direction: row.direction,
    body: row.body,
    status: row.status,
    error: row.error ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function findConversations(): Promise<ConversationWithLastMessage[]> {
  const convs = await db.query.conversations.findMany({
    orderBy: [desc(conversations.updatedAt)],
    with: {
      messages: {
        orderBy: [desc(messages.createdAt)],
        limit: 1,
      },
    },
  });

  return convs.map((c) => ({
    id: c.id,
    phoneNumber: c.phoneNumber,
    createdAt: toIso(c.createdAt),
    updatedAt: toIso(c.updatedAt),
    lastMessage: c.messages[0] ? mapMessage(c.messages[0]) : null,
  }));
}

export async function findMessagesByConversation(conversationId: string): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  return rows.map(mapMessage);
}

export async function findConversationById(id: string): Promise<Conversation | null> {
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!row) return null;
  return {
    id: row.id,
    phoneNumber: row.phoneNumber,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
