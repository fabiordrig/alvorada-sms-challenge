import { z } from 'zod';

export const MessageStatusSchema = z.enum(['received', 'processing', 'sent', 'failed']);
export const MessageDirectionSchema = z.enum(['inbound', 'outbound']);

export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  twilioSid: z.string().nullable(),
  direction: MessageDirectionSchema,
  body: z.string(),
  status: MessageStatusSchema,
  error: z.string().nullable(),
  attempts: z.number().int().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MessageStatus = z.infer<typeof MessageStatusSchema>;
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;
export type Message = z.infer<typeof MessageSchema>;
