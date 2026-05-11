import { FastifyInstance } from 'fastify';
import {
  findConversations,
  findMessagesByConversation,
  findConversationById,
} from './conversations.repository.ts';
import { sseBus } from '../../services/events/sse.bus.ts';
import { SseEvent } from '@sms/shared';

export async function conversationsRoutes(app: FastifyInstance) {
  app.get('/conversations', async (_request, reply) => {
    const items = await findConversations();
    return reply.send({ items });
  });

  app.get<{ Params: { id: string } }>('/conversations/:id/messages', async (request, reply) => {
    const { id } = request.params;
    const conv = await findConversationById(id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    const items = await findMessagesByConversation(id);
    return reply.send({ items });
  });

  app.get<{ Params: { id: string } }>('/conversations/:id/events', async (request, reply) => {
    const { id } = request.params;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (event: SseEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const types: SseEvent['type'][] = [
      'message:received',
      'message:processing',
      'message:sent',
      'message:failed',
    ];

    const listener = (event: SseEvent) => {
      if (event.conversationId === id) send(event);
    };

    types.forEach((t) => sseBus.on(t, listener));

    // heartbeat every 15s to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      types.forEach((t) => sseBus.off(t, listener));
    });
  });
}
