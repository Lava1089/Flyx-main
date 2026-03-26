/**
 * Generic stream proxy routes — proxies CDN streams via rust-fetch.
 *
 * Handles: /flixer/stream, /hianime/stream, /dlhd/stream, /vidlink/stream, /vidsrc/stream
 *
 * These were in server.js but never ported to the TypeScript codebase.
 * Each route uses rust-fetch (Chrome TLS fingerprint) with provider-specific headers.
 */
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
/**
 * Create a stream proxy handler for a specific path.
 * Returns an async handler compatible with the router.
 */
export declare function createStreamProxyHandler(path: string): (req: RPIRequest, res: ServerResponse) => Promise<void>;
/** All stream proxy paths */
export declare const STREAM_PROXY_PATHS: string[];
//# sourceMappingURL=stream-proxy.d.ts.map