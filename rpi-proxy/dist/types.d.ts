/**
 * RPI Proxy TypeScript Types
 * Typed interfaces for request params, response bodies, and config.
 * Requirements: 7.1, 7.2, 7.3
 */
import type { IncomingMessage, ServerResponse } from 'http';
/** Parsed request context passed to route handlers */
export interface RPIRequest {
    /** Original Node.js IncomingMessage */
    raw: IncomingMessage;
    /** Parsed URL */
    url: URL;
    /** Client IP address */
    clientIp: string;
    /** API key from header or query param */
    apiKey: string | null;
    /** Whether the request has a valid API key */
    isAuthenticated: boolean;
}
/** Standardized JSON error response */
export interface RPIErrorResponse {
    error: string;
    code?: string;
    provider?: string;
    timestamp: number;
    details?: string;
}
/** Standardized JSON success response */
export interface RPISuccessResponse<T = unknown> {
    success: true;
    data: T;
    provider?: string;
    timing?: number;
}
/** Route handler function signature */
export type RouteHandler = (req: RPIRequest, res: ServerResponse) => Promise<void> | void;
/** Middleware function signature — call next() to continue */
export type Middleware = (req: RPIRequest, res: ServerResponse, next: () => void) => void | Promise<void>;
/** Route definition */
export interface RouteDefinition {
    /** Path prefix to match (e.g. '/proxy', '/viprow/stream') */
    path: string;
    /** Handler function */
    handler: RouteHandler;
}
/** Environment configuration */
export interface RPIConfig {
    port: number;
    apiKey: string;
}
/** A validated SOCKS5 proxy entry */
export interface Socks5Proxy {
    host: string;
    port: number;
    str: string;
    lastValidated: number;
    failures: number;
}
/** SOCKS5 pool configuration */
export interface Socks5PoolConfig {
    minPoolSize: number;
    refreshIntervalMs: number;
    validationTimeoutMs: number;
    maxConcurrentValidations: number;
    sources: string[];
}
/** SOCKS5 pool state */
export interface Socks5PoolState {
    validated: Socks5Proxy[];
    validating: boolean;
    lastRefresh: number;
    totalFetched: number;
    totalValidated: number;
    totalFailed: number;
    roundRobinIndex: number;
}
/** Proxy selection result */
export interface ProxySelection {
    host: string;
    port: number;
    str: string;
    source: 'pool' | 'fallback';
}
/** /proxy query params */
export interface ProxyParams {
    url: string;
}
/** /dlhd-key-v4 query params */
export interface DLHDKeyV4Params {
    url: string;
    jwt: string;
    timestamp: string;
    nonce: string;
}
/** /dlhd-key query params */
export interface DLHDKeyParams {
    url: string;
}
/** /heartbeat query params */
export interface HeartbeatParams {
    channel: string;
    server: string;
    domain?: string;
}
/** /animekai query params */
export interface AnimeKaiParams {
    url: string;
    ua?: string;
    referer?: string;
    origin?: string;
    auth?: string;
}
/** /animekai/extract query params */
export interface AnimeKaiExtractParams {
    embed: string;
}
/** /animekai/full-extract query params */
export interface AnimeKaiFullExtractParams {
    kai_id: string;
    episode: string;
}
/** /viprow/stream query params */
export interface VIPRowStreamParams {
    url: string;
    link?: string;
    cf_proxy?: string;
}
/** /viprow/manifest, /viprow/key, /viprow/segment query params */
export interface VIPRowProxyParams {
    url: string;
    cf_proxy?: string;
}
/** /ppv query params */
export interface PPVParams {
    url: string;
}
/** /iptv/api query params */
export interface IPTVApiParams {
    url: string;
    mac?: string;
    token?: string;
}
/** /iptv/stream query params */
export interface IPTVStreamParams {
    url: string;
    mac?: string;
    token?: string;
}
/** /cdn-live/extract query params */
export interface CDNLiveExtractParams {
    name: string;
    code?: string;
}
/** /cdn-live/stream query params */
export interface CDNLiveStreamParams {
    name?: string;
    code?: string;
    m3u8url?: string;
}
/** /cdn-live/proxy query params */
export interface CDNLiveProxyParams {
    url: string;
}
/** /fetch query params */
export interface FetchParams {
    url: string;
    headers?: string;
}
/** /fetch-socks5 query params */
export interface FetchSocks5Params {
    url: string;
    headers?: string;
    proxy?: string;
}
/** /vidsrc-extract query params */
export interface VidSrcExtractParams {
    tmdbId: string;
    type?: string;
    season?: string;
    episode?: string;
}
//# sourceMappingURL=types.d.ts.map