import { pgTable, uuid, text, integer, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const messageStatusEnum = pgEnum('message_status', [
  'received',
  'processing',
  'sent',
  'failed',
]);
export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  phoneNumber: text('phone_number').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    twilioSid: text('twilio_sid').unique(),
    direction: messageDirectionEnum('direction').notNull(),
    body: text('body').notNull(),
    status: messageStatusEnum('status').notNull().default('received'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    byConversation: index('msg_conv_created_idx').on(t.conversationId, t.createdAt),
    byStatusOpen: index('msg_status_open_idx').on(t.status).where(sql`${t.status} IN ('received', 'processing')`),
  }),
);
