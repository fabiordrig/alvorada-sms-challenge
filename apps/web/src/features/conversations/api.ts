import { ConversationWithLastMessage, Message } from '@sms/shared';
import { apiFetch } from '../../lib/http.js';

export async function fetchConversations(): Promise<ConversationWithLastMessage[]> {
  const data = await apiFetch<{ items: ConversationWithLastMessage[] }>('/conversations');
  return data.items;
}

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const data = await apiFetch<{ items: Message[] }>(`/conversations/${conversationId}/messages`);
  return data.items;
}
