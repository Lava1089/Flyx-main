/**
 * VIPRow route handlers
 * /viprow/stream, /viprow/manifest, /viprow/key, /viprow/segment
 * boanki.net blocks CF Workers — extraction done from residential IP.
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
/** /viprow/stream — Full VIPRow stream extraction */
export declare function handleVIPRowStream(req: RPIRequest, res: ServerResponse): Promise<void>;
/** /viprow/manifest — Proxy manifest with URL rewriting */
export declare function handleVIPRowManifest(req: RPIRequest, res: ServerResponse): Promise<void>;
/** /viprow/key — Proxy AES-128 decryption keys */
export declare function handleVIPRowKey(req: RPIRequest, res: ServerResponse): Promise<void>;
/** /viprow/segment — Proxy video segments */
export declare function handleVIPRowSegment(req: RPIRequest, res: ServerResponse): Promise<void>;
//# sourceMappingURL=viprow.d.ts.map