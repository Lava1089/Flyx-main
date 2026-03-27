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
 * This endpoint runs rust-fetch --mode dlhd-whitelist via ProxyJet residential SOCKS5
 * to solve reCAPTCHA and POST to ai.the-sunmoon.site/verify.
 *
 * The whitelist lasts ~20 minutes. The CF worker should call this before key fetches.
 */
export declare function handleDLHDWhitelist(req: RPIRequest, res: ServerResponse): Promise<void>;
/**
 * /dlhd-key-v6 — ProxyJet sticky session key fetching via rust-fetch.
 *
 * REFACTORED Mar 27 2026: Caches whitelisted sessions for fast reuse (~1s).
 * Only re-whitelists when the cached session returns fake keys.
 *
 *   1. Creates a fresh ProxyJet sticky session (unique residential IP)
 *   2. Whitelists that IP via reCAPTCHA v3 HTTP bypass + POST /verify
 *   3. Fetches the key through the SAME sticky IP (now whitelisted)
 *   4. Returns the valid 16-byte key
 *
 * The sticky session is ephemeral — one session per key request, no reuse.
 * This avoids the 4-channel concurrent limit and ensures a clean IP every time.
 */
export declare function handleDLHDKeyV6(req: RPIRequest, res: ServerResponse): Promise<void>;
/**
 * /dlhd/restream — Returns a rewritten M3U8 for VRChat / external players.
 *
 * All key and segment URLs point back to this RPI proxy so the residential IP
 * handles DLHD's whitelist requirements. VRChat clients just consume the stream.
 *
 * Usage: GET /dlhd/restream?channel=303&key=<api_key>
 */
export declare function handleDLHDRestream(req: RPIRequest, res: ServerResponse): Promise<void>;
//# sourceMappingURL=dlhd.d.ts.map