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
/**
 * /dlhd-whitelist — Trigger reCAPTCHA v3 whitelist refresh via rust-fetch.
 *
 * March 2026: DLHD key servers require IP whitelisting via reCAPTCHA v3.
 * This endpoint runs rust-fetch --mode dlhd-whitelist from the RPI's residential IP
 * to solve reCAPTCHA and POST to chevy.soyspace.cyou/verify.
 *
 * The whitelist lasts ~30 minutes. The CF worker should call this before key fetches.
 */
export declare function handleDLHDWhitelist(req: RPIRequest, res: ServerResponse): Promise<void>;
/**
 * /dlhd-key-v6 — Server-side key fetching via rust-fetch (residential IP + Chrome TLS).
 *
 * March 2026: DLHD uses reCAPTCHA v3 IP whitelist. Without whitelist, key servers
 * return fake 16-byte keys. This endpoint:
 * 1. Triggers reCAPTCHA whitelist refresh via rust-fetch (if needed)
 * 2. Fetches the key from multiple servers
 * 3. Returns the first valid (non-fake) 16-byte key
 */
export declare function handleDLHDKeyV6(req: RPIRequest, res: ServerResponse): Promise<void>;
//# sourceMappingURL=dlhd.d.ts.map