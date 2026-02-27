/**
 * RPI Proxy — TypeScript Entry Point
 * Creates the HTTP server, registers all routes, applies middleware, and starts listening.
 * Requirements: 3.1, 3.7
 */
import http from 'http';
import { Router } from './router';
declare const router: Router;
declare const server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
export { router, server };
//# sourceMappingURL=index.d.ts.map