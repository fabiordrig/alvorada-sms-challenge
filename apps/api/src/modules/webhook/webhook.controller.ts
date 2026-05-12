import { FastifyInstance } from 'fastify';
import { TwilioWebhookSchema } from '@sms/shared';
import { handleInbound } from './webhook.service';
import { validateTwilioSignature } from './webhook.signature';
import { config } from '../../config';
import { logger } from '../../lib/logger';

export async function webhookRoutes(app: FastifyInstance) {
  app.post('/webhook/sms', async (request, reply) => {
    if (config.TWILIO_VALIDATE_SIGNATURE) {
      const signature = request.headers['x-twilio-signature'] as string;
      if (!signature || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_WEBHOOK_URL) {
        return reply.code(403).send({ error: 'Missing signature' });
      }
      const valid = validateTwilioSignature(
        config.TWILIO_AUTH_TOKEN,
        config.TWILIO_WEBHOOK_URL,
        request.body as Record<string, string>,
        signature,
      );
      if (!valid) {
        logger.warn('invalid twilio signature');
        return reply.code(403).send({ error: 'Invalid signature' });
      }
    }

    const parsed = TwilioWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues });
    }

    const { From, Body, MessageSid } = parsed.data;
    await handleInbound({ from: From, body: Body, messageSid: MessageSid });

    reply.header('Content-Type', 'text/xml');
    return reply.code(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
}
