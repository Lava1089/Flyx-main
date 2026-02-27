/**
 * IPTV route handlers
 * /iptv/api — Stalker portal API calls from residential IP
 * /iptv/stream — Raw MPEG-TS streaming with STB headers
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
import type { ServerResponse } from 'http';
import type { RPIRequest } from '../types';
/** /iptv/api — Proxy Stalker portal API calls */
export declare function handleIPTVApi(req: RPIRequest, res: ServerResponse): Promise<void>;
/** /iptv/stream — Stream raw MPEG-TS data with STB headers, follows redirects */
export declare function handleIPTVStream(req: RPIRequest, res: ServerResponse): Promise<void>;
//# sourceMappingURL=iptv.d.ts.map