import { Message } from '@sms/shared';
import { StatusBadge } from './StatusBadge.js';
import { cn } from '../../../lib/cn.js';

export function MessageBubble({ message }: { message: Message }) {
  const isInbound = message.direction === 'inbound';

  return (
    <div className={cn('flex', isInbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-xs rounded-2xl px-4 py-2.5 shadow-sm',
          isInbound ? 'bg-white text-gray-900' : 'bg-brand-600 text-white',
        )}
      >
        <p className="text-sm">{message.body}</p>
        <div className={cn('mt-1.5 flex items-center gap-2', isInbound ? '' : 'justify-end')}>
          <StatusBadge status={message.status} />
          <span className="text-[10px] opacity-60">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>
        {message.error && (
          <p className="mt-1 text-xs text-red-300">{message.error}</p>
        )}
      </div>
    </div>
  );
}
