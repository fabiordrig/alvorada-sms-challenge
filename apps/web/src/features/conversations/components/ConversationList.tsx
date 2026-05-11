import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { fetchConversations } from '../api.js';
import { StatusBadge } from './StatusBadge.js';

export function ConversationList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <div className="rounded-lg bg-red-50 p-4 text-red-700">Failed to load conversations</div>;
  }

  if (!data?.length) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-gray-400">
        <svg className="mb-3 h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="mt-1 text-xs">Send a test webhook to get started</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
      {data.map((conv) => (
        <Link
          key={conv.id}
          to="/conversations/$id"
          params={{ id: conv.id }}
          className="flex items-center gap-4 p-4 transition hover:bg-gray-50"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold text-sm">
            {conv.phoneNumber.slice(-2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-900 text-sm">{conv.phoneNumber}</span>
              {conv.lastMessage && (
                <span className="text-xs text-gray-400">
                  {new Date(conv.updatedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            {conv.lastMessage ? (
              <div className="flex items-center gap-2 mt-0.5">
                <p className="truncate text-xs text-gray-500">{conv.lastMessage.body}</p>
                <StatusBadge status={conv.lastMessage.status} />
              </div>
            ) : (
              <p className="text-xs text-gray-400">No messages</p>
            )}
          </div>
          <svg className="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ))}
    </div>
  );
}
