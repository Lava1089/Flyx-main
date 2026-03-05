/**
 * DLHD Homepage Fetcher
 * Handles fetching pages from DLHD with proper headers and retry logic
 * 
 * Security Features:
 * - URL validation to prevent SSRF
 * - Rotating User-Agents to avoid detection
 * - Request timeouts to prevent resource exhaustion
 * - Proper retry logic for transient errors only
 * - Error sanitization to prevent information leakage
 * - Optional RPI proxy support for bypassing Cloudflare protection
 */

const DLHD_BASE_URL = 'https://dlhd.link';
const DLHD_ALLOWED_HOSTS = ['dlhd.link', 'www.dlhd.link'];

// Rotating User-Agents to avoid detection
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

// HTTP status codes that are safe to retry
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

// Global proxy configuration (set via setProxyConfig)
let proxyConfig: { url?: string; apiKey?: string } = {};

/**
 * Set the RPI proxy configuration
 * Call this at worker startup to enable proxy routing
 */
export function setProxyConfig(config: { url?: string; apiKey?: string }): void {
  proxyConfig = config;
}

/**
 * Get current proxy configuration
 */
export function getProxyConfig(): { url?: string; apiKey?: string } {
  return proxyConfig;
}

export interface FetchOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  referer?: string;
}

export interface FetchResult {
  html: string;
  status: number;
  retryCount: number;
  durationMs: number;
}

export class FetchError extends Error {
  code: string;
  status?: number;
  retryable: boolean;

  constructor(message: string, code: string, status?: number, retryable = false) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const DEFAULT_OPTIONS: Required<Omit<FetchOptions, 'referer'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  timeoutMs: 30000,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15 multiplier
  const delay = baseDelayMs * Math.pow(2, attempt) * jitter;
  return Math.min(delay, maxDelayMs);
}

/**
 * Get a random User-Agent from the pool
 */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Validate URL is allowed (SSRF protection)
 */
function validateUrl(url: string): void {
  try {
    const parsed = new URL(url);
    
    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      throw new FetchError('Only HTTPS URLs are allowed', 'INVALID_PROTOCOL');
    }
    
    // Only allow DLHD hosts
    if (!DLHD_ALLOWED_HOSTS.includes(parsed.hostname)) {
      throw new FetchError('URL host not allowed', 'INVALID_HOST');
    }
    
    // Prevent path traversal
    if (parsed.pathname.includes('..')) {
      throw new FetchError('Invalid URL path', 'INVALID_PATH');
    }
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError('Invalid URL format', 'INVALID_URL');
  }
}

/**
 * Build headers for DLHD requests
 */
export function buildDLHDHeaders(referer?: string): Record<string, string> {
  return {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': referer || DLHD_BASE_URL,
    'Origin': DLHD_BASE_URL,
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  };
}

/**
 * Check if an HTTP status code is retryable
 */
function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.includes(status);
}

/**
 * Sanitize error message to prevent information leakage
 */
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof FetchError) {
    return error.message;
  }
  if (error instanceof Error) {
    // Don't expose internal error details
    if (error.message.includes('fetch')) {
      return 'Network request failed';
    }
    if (error.message.includes('timeout')) {
      return 'Request timed out';
    }
  }
  return 'An unexpected error occurred';
}

/**
 * Fetch a page from DLHD with retry logic
 * 
 * Security: Only allows fetching from DLHD domains to prevent SSRF
 * 
 * If RPI proxy is configured, routes requests through it to bypass Cloudflare
 */
export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  // Validate URL before making any requests (SSRF protection)
  validateUrl(url);
  
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: FetchError | null = null;
  let retryCount = 0;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);
    
    try {
      let response: Response;
      
      // Check if we should use the RPI proxy
      if (proxyConfig.url && proxyConfig.apiKey) {
        // Route through RPI proxy
        const proxyUrl = new URL('/proxy', proxyConfig.url);
        proxyUrl.searchParams.set('url', url);
        
        response = await fetch(proxyUrl.toString(), {
          headers: {
            'X-API-Key': proxyConfig.apiKey,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal,
        });
      } else {
        // Direct fetch (may fail due to Cloudflare protection)
        response = await fetch(url, {
          headers: buildDLHDHeaders(opts.referer),
          signal: controller.signal,
        });
      }

      clearTimeout(timeoutId);

      if (!response.ok) {
        const isRetryable = isRetryableStatus(response.status);
        
        if (isRetryable && attempt < opts.maxRetries) {
          // Retryable error - continue to retry logic
          throw new FetchError(
            `HTTP ${response.status}`,
            'HTTP_ERROR',
            response.status,
            true
          );
        }
        
        // Non-retryable error - throw immediately
        throw new FetchError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
          response.status,
          false
        );
      }

      const html = await response.text();
      
      // Basic response validation
      if (!html || html.length < 100) {
        throw new FetchError('Empty or invalid response', 'INVALID_RESPONSE', 200, true);
      }
      
      return {
        html,
        status: response.status,
        retryCount,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Handle abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new FetchError('Request timed out', 'TIMEOUT', undefined, true);
      } else if (error instanceof FetchError) {
        lastError = error;
        
        // Don't retry non-retryable errors
        if (!error.retryable) {
          throw error;
        }
      } else {
        lastError = new FetchError(
          sanitizeErrorMessage(error),
          'NETWORK_ERROR',
          undefined,
          true
        );
      }
      
      retryCount = attempt;

      // Don't sleep on last attempt
      if (attempt < opts.maxRetries) {
        const delay = calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
        await sleep(delay);
      }
    }
  }

  throw lastError || new FetchError('Fetch failed after retries', 'MAX_RETRIES_EXCEEDED');
}

/**
 * Validate channel ID format (prevent injection)
 */
function validateChannelId(channelId: string): void {
  // Channel IDs should be numeric only
  if (!/^\d{1,5}$/.test(channelId)) {
    throw new FetchError('Invalid channel ID format', 'INVALID_CHANNEL_ID');
  }
}

/**
 * Fetch the DLHD 24/7 channels page
 */
export async function fetchChannelsPage(options?: FetchOptions): Promise<FetchResult> {
  const url = `${DLHD_BASE_URL}/24-7-channels.php`;
  return fetchWithRetry(url, {
    ...options,
    referer: DLHD_BASE_URL,
  });
}

/**
 * Fetch the DLHD homepage (schedule/live events)
 */
export async function fetchHomepage(options?: FetchOptions): Promise<FetchResult> {
  return fetchWithRetry(DLHD_BASE_URL, options);
}

/**
 * Fetch a specific channel page
 * 
 * Security: Validates channel ID to prevent URL injection
 */
export async function fetchChannelPage(
  channelId: string,
  options?: FetchOptions
): Promise<FetchResult> {
  // Validate channel ID format (injection prevention)
  validateChannelId(channelId);
  
  const url = `${DLHD_BASE_URL}/watch.php?id=${channelId}`;
  return fetchWithRetry(url, {
    ...options,
    referer: `${DLHD_BASE_URL}/24-7-channels.php`,
  });
}

// Re-export for use in other modules
export { DLHD_BASE_URL };
