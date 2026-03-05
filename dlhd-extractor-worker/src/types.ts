/**
 * Environment bindings for the Cloudflare Worker
 */
export interface Env {
  // KV Namespaces
  RATE_LIMIT_KV?: KVNamespace;
  KEY_CACHE_KV?: KVNamespace;
  NONCE_KV?: KVNamespace;
  
  // Security Configuration
  ALLOWED_ORIGINS?: string;  // Comma-separated list of allowed origins
  API_KEYS?: string;          // Comma-separated list of valid API keys
  ENVIRONMENT?: string;       // 'development' | 'production'
  ADMIN_SECRET?: string;      // Secret for debug endpoints
  
  // Rate Limiting Configuration
  RATE_LIMIT_WINDOW_MS?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  
  // RPI Proxy Configuration
  /** Optional RPI proxy URL for bypassing Cloudflare protection */
  RPI_PROXY_URL?: string;
  /** API key for the RPI proxy */
  RPI_PROXY_API_KEY?: string;
}

/**
 * Channel data model
 */
export interface Channel {
  id: string;
  name: string;
  category: 'live-event' | '24-7';
  logo?: string;
  currentEvent?: string;
  schedule?: ScheduledEvent[];
  status: 'live' | 'offline' | 'scheduled';
}

export interface ScheduledEvent {
  title: string;
  startTime: string;
  sport?: string;
}

export interface ChannelDetails extends Channel {
  players: PlayerSource[];
  lastUpdated: string;
  streamInfo?: {
    resolution?: string;
    bitrate?: string;
    codec?: string;
  };
}

/**
 * Player source data model
 */
export interface PlayerSource {
  id: number;
  name: string;
  embedUrl: string;
  available: boolean;
  priority: number;
}

/**
 * Authentication context
 */
export interface AuthContext {
  cookies: Map<string, string>;
  tokens: Map<string, string>;
  headers: Record<string, string>;
  timestamp: number;
}

/**
 * Extracted stream data
 */
export interface ExtractedStream {
  m3u8Url: string;
  headers: Record<string, string>;
  referer: string;
  origin: string;
  quality?: string;
  isEncrypted: boolean;
  /** Auth data for key fetching (DLHD EPlayerAuth) */
  authData?: {
    token: string;
    channelKey: string;
    channelSalt: string;
  };
}

/**
 * API Response models
 */
export interface ChannelListResponse {
  success: boolean;
  channels: Channel[];
  totalCount: number;
  lastUpdated: string;
  timing?: TimingInfo;
}

export interface StreamResponse {
  success: boolean;
  streamUrl: string;
  playerId: number;
  quality?: string;
  expiresAt?: number;
  timing?: TimingInfo;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export interface TimingInfo {
  /** Total duration in milliseconds */
  durationMs: number;
  /** ISO 8601 timestamp when the request started */
  startTime: string;
  /** ISO 8601 timestamp when the request ended */
  endTime?: string;
}

/**
 * Extended timing information for detailed performance tracking
 * Requirements: 7.4
 */
export interface ExtendedTimingInfo extends TimingInfo {
  /** Breakdown of timing by phase */
  phases?: TimingPhase[];
  /** Number of retry attempts if applicable */
  retryAttempts?: number;
  /** Total time spent in retries */
  retryDurationMs?: number;
}

/**
 * Timing information for a specific phase of processing
 */
export interface TimingPhase {
  /** Name of the phase */
  name: string;
  /** Duration of this phase in milliseconds */
  durationMs: number;
  /** ISO 8601 timestamp when this phase started */
  startTime: string;
  /** ISO 8601 timestamp when this phase ended */
  endTime: string;
}

/**
 * Rate limit data
 */
export interface RateLimitData {
  windowMs: number;
  maxRequests: number;
  currentCount: number;
  windowStart: number;
}

/**
 * Route handler type
 */
export type RouteHandler = (
  request: Request,
  env: Env,
  params: Record<string, string>
) => Promise<Response>;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}
