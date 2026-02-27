/**
 * DLHD route handlers
 * /dlhd-key-v4 — passthrough with pre-computed auth headers
 * /dlhd-key — fetches key via V5 auth module
 * /heartbeat — establishes heartbeat session
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
/**
 * /dlhd-key-v4 — Simple passthrough with pre-computed auth headers.
 * CF Worker computes PoW and sends jwt/timestamp/nonce.
 */
export declare function handleDLHDKeyV4(req: RPIRequest, res: ServerResponse): Promise<void>;
/**
 * /dlhd-key — Fetches DLHD encryption key via V5 auth module.
 * Falls back to the legacy dlhd-auth-v5 module.
 */
export declare function handleDLHDKey(req: RPIRequest, res: ServerResponse): Promise<void>;
/**
 * /heartbeat — Establishes heartbeat session for DLHD key fetching.
 */
export declare function handleHeartbeat(req: RPIRequest, res: ServerResponse): Promise<void>;
//# sourceMappingURL=dlhd.d.ts.map