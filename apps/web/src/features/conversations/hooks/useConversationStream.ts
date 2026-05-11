import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SseEvent } from '@sms/shared';
import { subscribeToConversation } from '../../../lib/sse.js';

export function useConversationStream(conversationId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = subscribeToConversation(conversationId, (event: SseEvent) => {
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    });

    return unsubscribe;
  }, [conversationId, queryClient]);
}
