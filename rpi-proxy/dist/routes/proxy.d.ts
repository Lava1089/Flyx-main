/**
 * Generic /proxy route handler
 * Proxies requests to allowed domains from residential IP.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
import type { RPIRequest } from '../types';
import type { ServerResponse } from 'http';
export declare function handleProxy(req: RPIRequest, res: ServerResponse): Promise<void>;
//# sourceMappingURL=proxy.d.ts.map