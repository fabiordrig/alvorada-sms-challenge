import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router';
import { ConversationList } from '../features/conversations/components/ConversationList';
import { ConversationDetail } from '../features/conversations/components/ConversationDetail';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 2 } },
});

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">SMS Console</h1>
              <p className="text-xs text-gray-500">Alvorada SMS Challenge</p>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Conversations</h2>
        <p className="mt-1 text-sm text-gray-500">All SMS conversations, newest first</p>
      </div>
      <ConversationList />
    </div>
  ),
});

const conversationDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conversations/$id',
  component: () => {
    const { id } = conversationDetailRoute.useParams();
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" style={{ minHeight: '600px' }}>
        <ConversationDetail conversationId={id} />
      </div>
    );
  },
});

const routeTree = rootRoute.addChildren([indexRoute, conversationDetailRoute]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
