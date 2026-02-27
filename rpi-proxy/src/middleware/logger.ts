/**
 * Request Logging Middleware
 * Logs method, path, client IP, and response time.
 * Requirement: 3.6
 */

import type { ServerResponse } from 'http';
import type { RPIRequest, Middleware } from '../types';

export function createLoggerMiddleware(): Middleware {
  return (req: RPIRequest, res: ServerResponse, next: () => void) => {
    const start = Date.now();
    const { method } = req.raw;
    const path = req.url.pathname;

    res.on('finish', () => {
      const elapsed = Date.now() - start;
      console.log(`[${method}] ${path} ${res.statusCode} ${elapsed}ms — ${req.clientIp}`);
    });

    next();
  };
}
