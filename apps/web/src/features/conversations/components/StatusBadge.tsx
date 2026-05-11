import { MessageStatus } from '@sms/shared';
import { cn } from '../../../lib/cn.js';

const config: Record<MessageStatus, { label: string; className: string }> = {
  received: { label: 'Received', className: 'bg-blue-100 text-blue-700' },
  processing: { label: 'Processing', className: 'bg-yellow-100 text-yellow-700 animate-pulse' },
  sent: { label: 'Sent', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
};

export function StatusBadge({ status }: { status: MessageStatus }) {
  const { label, className } = config[status];
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', className)}>
      {label}
    </span>
  );
}
