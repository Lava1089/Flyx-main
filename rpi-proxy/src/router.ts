/**
 * Path-based Router with Middleware Chain
 * Matches request paths to route handlers and runs middleware before dispatch.
 * Requirements: 3.2, 3.7
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { RPIRequest, RouteDefinition, Middleware, RouteHandler } from './types';
import { sendJsonError, sendJson } from './utils';

export class Router {
  private routes: RouteDefinition[] = [];
  private middlewares: Middleware[] = [];

  /** Register a global middleware */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /** Register a route handler for an exact path */
  route(path: string, handler: RouteHandler): void {
    this.routes.push({ path, handler });
  }

  /**
   * Find the matching route for a given pathname.
   * Uses exact match — routes are checked in registration order.
   */
  match(pathname: string): RouteDefinition | undefined {
    return this.routes.find(r => r.path === pathname);
  }

  /** Handle an incoming HTTP request */
  async handle(raw: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS preflight
    if (raw.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
      });
      res.end();
      return;
    }

    if (raw.method !== 'GET') {
      sendJsonError(res, 405, { error: 'Method not allowed', timestamp: Date.now() });
      return;
    }

    const host = raw.headers.host ?? 'localhost';
    const url = new URL(raw.url ?? '/', `http://${host}`);
    const clientIp =
      (raw.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      raw.socket.remoteAddress ??
      'unknown';

    const req: RPIRequest = {
      raw,
      url,
      clientIp,
      apiKey: null,
      isAuthenticated: false,
    };

    // Run middleware chain
    let middlewareIndex = 0;
    const runNext = (): void => {
      if (res.headersSent) return;
      if (middlewareIndex < this.middlewares.length) {
        const mw = this.middlewares[middlewareIndex++];
        // Middleware may be sync or async — handle both
        const result = mw(req, res, runNext);
        if (result instanceof Promise) {
          result.catch(err => {
            console.error('[Middleware Error]', err);
            sendJsonError(res, 500, { error: 'Internal server error', timestamp: Date.now() });
          });
        }
      } else {
        // All middleware passed — dispatch to route
        this.dispatch(req, res);
      }
    };

    runNext();
  }

  /** Dispatch to the matching route handler */
  private async dispatch(req: RPIRequest, res: ServerResponse): Promise<void> {
    if (res.headersSent) return;

    // Health check — built-in, no route registration needed
    if (req.url.pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        timestamp: Date.now(),
        method: 'FRESH-AUTH-EVERY-REQUEST',
        caching: 'DISABLED for keys/auth/m3u8',
      });
      return;
    }

    const matched = this.match(req.url.pathname);
    if (!matched) {
      sendJsonError(res, 404, { error: 'Not found', timestamp: Date.now() });
      return;
    }

    try {
      await matched.handler(req, res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Route Error] ${req.url.pathname}: ${message}`);
      sendJsonError(res, 500, {
        error: 'Internal server error',
        timestamp: Date.now(),
        details: message,
      });
    }
  }

  /** Get all registered route paths (useful for debugging / tests) */
  getRegisteredPaths(): string[] {
    return this.routes.map(r => r.path);
  }
}
