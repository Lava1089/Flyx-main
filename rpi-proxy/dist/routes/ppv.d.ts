/**
 * PPV route handler
 * /ppv — Proxies poocloud.in streams from residential IP.
 * poocloud.in blocks datacenter IPs and IPv6.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
export declare function handlePPV(req: RPIRequest, res: ServerResponse): Promise<void>;
//# sourceMappingURL=ppv.d.ts.map