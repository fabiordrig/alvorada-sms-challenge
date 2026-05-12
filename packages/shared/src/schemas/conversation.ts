import { z } from 'zod';
import { MessageSchema } from './message.js';

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  phoneNumber: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ConversationWithLastMessageSchema = ConversationSchema.extend({
  lastMessage: MessageSchema.nullable(),
});

export const ConversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationWithLastMessage = z.infer<typeof ConversationWithLastMessageSchema>;
