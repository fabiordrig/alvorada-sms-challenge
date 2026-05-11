import { Route as rootRoute } from './routes/__root';
import { Route as indexRoute } from './routes/index';
import { Route as conversationsIdRoute } from './routes/conversations/$id';

const rootRouteWithChildren = rootRoute.addChildren([
  indexRoute,
  conversationsIdRoute,
]);

export const routeTree = rootRouteWithChildren;
