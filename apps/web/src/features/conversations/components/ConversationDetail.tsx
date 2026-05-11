import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { fetchMessages } from '../api.js';
import { useConversationStream } from '../hooks/useConversationStream.js';
import { MessageBubble } from './MessageBubble.js';
import { useEffect, useRef } from 'react';

export function ConversationDetail({ conversationId }: { conversationId: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useConversationStream(conversationId);

  const { data, isLoading, error } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => fetchMessages(conversationId),
    refetchInterval: 3000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-6 py-4">
        <Link to="/" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="font-semibold text-gray-900">Conversation</h2>
        <span className="ml-auto text-xs text-gray-400 font-mono">{conversationId}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && (
          <div className="flex h-32 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-red-700 text-sm">Failed to load messages</div>
        )}
        {data && (
          <div className="space-y-3">
            {data.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
        {data?.length === 0 && (
          <div className="flex h-32 items-center justify-center text-gray-400 text-sm">
            No messages in this conversation
          </div>
        )}
      </div>
    </div>
  );
}
