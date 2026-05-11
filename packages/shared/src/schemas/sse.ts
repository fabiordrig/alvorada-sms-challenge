import { z } from 'zod';
import { MessageStatusSchema } from './message.js';

export const SseEventSchema = z.object({
  type: z.enum(['message:received', 'message:processing', 'message:sent', 'message:failed']),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  status: MessageStatusSchema,
});

export type SseEvent = z.infer<typeof SseEventSchema>;
