/**
 * Shared utility functions for the RPI proxy.
 */
import type { ServerResponse } from 'http';
import type { RPIErrorResponse } from './types';
/** Send a JSON error response with CORS headers */
export declare function sendJsonError(res: ServerResponse, status: number, body: RPIErrorResponse): void;
/** Send a JSON success response with CORS headers */
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
//# sourceMappingURL=utils.d.ts.map