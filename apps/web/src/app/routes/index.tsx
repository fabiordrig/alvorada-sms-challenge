import { createFileRoute } from '@tanstack/react-router';
import { ConversationList } from '../../features/conversations/components/ConversationList';
import { SimulateSmsForm } from '../../features/conversations/components/SimulateSmsForm';

export const Route = createFileRoute('/')({
  component: () => (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Conversations</h2>
        <p className="mt-1 text-sm text-gray-500">All SMS conversations, newest first</p>
      </div>
      <SimulateSmsForm />
      <ConversationList />
    </div>
  ),
});
