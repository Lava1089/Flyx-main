/**
 * Shared utility functions for the RPI proxy.
 */

import type { ServerResponse } from 'http';
import type { RPIErrorResponse } from './types';

/** Send a JSON error response with CORS headers */
export function sendJsonError(res: ServerResponse, status: number, body: RPIErrorResponse): void {
  if (res.headersSent) return;
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(json);
}

/** Send a JSON success response with CORS headers */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(json);
}
