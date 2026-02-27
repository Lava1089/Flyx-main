/**
 * SOCKS5 fetch route handler
 * /fetch-socks5 — Fetch a URL through a SOCKS5 proxy with auto-retry.
 * /fetch — Generic fetch via residential IP.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
/** /fetch-socks5 — Fetch URL through SOCKS5 proxy with auto-retry */
export declare function handleFetchSocks5(req: RPIRequest, res: ServerResponse): Promise<void>;
/** /fetch — Generic fetch via residential IP (dumb pipe) */
export declare function handleFetch(req: RPIRequest, res: ServerResponse): Promise<void>;
//# sourceMappingURL=socks5.d.ts.map