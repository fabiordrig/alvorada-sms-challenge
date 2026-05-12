import { ConversationWithLastMessage, Message } from '@sms/shared';
import { apiFetch } from '../../lib/http';

export async function fetchConversations(): Promise<ConversationWithLastMessage[]> {
  const data = await apiFetch<{ items: ConversationWithLastMessage[] }>('/conversations');
  return data.items;
}

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const data = await apiFetch<{ items: Message[] }>(`/conversations/${conversationId}/messages`);
  return data.items;
}

export async function sendTestSms(from: string, body: string): Promise<void> {
  const messageSid = `SM${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`;
  const params = new URLSearchParams({ From: from, Body: body, MessageSid: messageSid });
  const res = await fetch('/api/webhook/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Webhook error: ${res.status}`);
}
