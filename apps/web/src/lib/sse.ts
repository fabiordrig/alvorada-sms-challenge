import { SseEvent } from '@sms/shared';

export function subscribeToConversation(
  conversationId: string,
  onEvent: (event: SseEvent) => void,
  onError?: () => void,
): () => void {
  const es = new EventSource(`/api/conversations/${conversationId}/events`);

  const types: SseEvent['type'][] = [
    'message:received',
    'message:processing',
    'message:sent',
    'message:failed',
  ];

  types.forEach((type) => {
    es.addEventListener(type, (e: MessageEvent) => {
      try {
        onEvent(JSON.parse(e.data) as SseEvent);
      } catch {}
    });
  });

  es.onerror = () => {
    onError?.();
    es.close();
  };

  return () => es.close();
}
