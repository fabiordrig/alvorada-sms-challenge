import { z } from 'zod';

export const TwilioWebhookSchema = z.object({
  From: z.string().min(1),
  Body: z.string().min(1),
  MessageSid: z.string().min(1),
  To: z.string().optional(),
  NumMedia: z.string().optional(),
});

export type TwilioWebhook = z.infer<typeof TwilioWebhookSchema>;
