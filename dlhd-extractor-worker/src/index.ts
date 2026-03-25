import { Env } from './types';
import { Router } from './router';
import { createRoutes } from './routes';
import { setProxyConfig } from './discovery/fetcher';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Initialize proxy configuration from environment
    if (env.RPI_PROXY_URL && env.RPI_PROXY_API_KEY) {
      setProxyConfig({
        url: env.RPI_PROXY_URL,
        apiKey: env.RPI_PROXY_API_KEY,
      });
    }
    
    const router = new Router(env);
    router.ctx = ctx;
    createRoutes(router);
    return router.handle(request);
  },
};
