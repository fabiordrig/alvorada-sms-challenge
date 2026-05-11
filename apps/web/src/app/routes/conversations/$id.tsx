import { createFileRoute } from '@tanstack/react-router';
import { ConversationDetail } from '../../../features/conversations/components/ConversationDetail.js';

export const Route = createFileRoute('/conversations/$id')({
  component: () => {
    const { id } = Route.useParams();
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" style={{ minHeight: '600px' }}>
        <ConversationDetail conversationId={id} />
      </div>
    );
  },
});
