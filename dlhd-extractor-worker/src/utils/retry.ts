/**
 * Retry Utility with Exponential Backoff
 * 
 * Requirements: 7.1
 * - WHEN a network request fails, THE Worker SHALL retry with exponential backoff up to 3 times
 * 
 * This module provides a centralized retry mechanism that can be used across all
 * fetch operations in the worker.
 */

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds between retries (default: 10000) */
  maxDelayMs: number;
  /** Error codes that should trigger a retry */
  retryableErrors: string[];
  /** HTTP status codes that should trigger a retry */
  retryableStatusCodes: number[];
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableErrors: ['RATE_LIMITED', 'PROXY_ERROR', 'UPSTREAM_ERROR', 'UPSTREAM_TIMEOUT', 'NETWORK_ERROR', 'TIMEOUT'],
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The result value if successful */
  value?: T;
  /** The error if failed */
  error?: Error;
  /** Number of retry attempts made */
  attempts: number;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Individual attempt durations */
  attemptDurations: number[];
}

/**
 * Error with a code property for retry classification
 */
export interface RetryableError extends Error {
  code?: string;
  status?: number;
  statusCode?: number;
  retryable?: boolean;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 * 
 * @param attempt - The current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay in milliseconds
 * @returns The delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  // Add jitter to prevent thundering herd (0.85-1.15 multiplier)
  const jitter = Math.random() * 0.3 + 0.85;
  const delay = baseDelayMs * Math.pow(2, attempt) * jitter;
  return Math.min(delay, maxDelayMs);
}

/**
 * Check if an error is retryable based on configuration
 * 
 * @param error - The error to check
 * @param config - Retry configuration
 * @returns Whether the error should trigger a retry
 */
export function isRetryableError(
  error: unknown,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): boolean {
  // Check if error explicitly marks itself as retryable
  if (error && typeof error === 'object') {
    const err = error as RetryableError;
    
    // Explicit retryable flag
    if (err.retryable === false) {
      return false;
    }
    if (err.retryable === true) {
      return true;
    }
    
    // Check error code
    if (err.code && config.retryableErrors.includes(err.code)) {
      return true;
    }
    
    // Check HTTP status code
    const status = err.status || err.statusCode;
    if (status && config.retryableStatusCodes.includes(status)) {
      return true;
    }
  }
  
  // Check for network errors by message
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up')
    ) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if an HTTP status code is retryable
 * 
 * @param status - HTTP status code
 * @param config - Retry configuration
 * @returns Whether the status code should trigger a retry
 */
export function isRetryableStatus(
  status: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): boolean {
  return config.retryableStatusCodes.includes(status);
}

/**
 * Execute a function with retry logic and exponential backoff
 * 
 * @param fn - The async function to execute
 * @param config - Retry configuration (optional, uses defaults)
 * @returns RetryResult with the outcome
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const opts: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const startTime = Date.now();
  const attemptDurations: number[] = [];
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const attemptStart = Date.now();
    
    try {
      const value = await fn();
      attemptDurations.push(Date.now() - attemptStart);
      
      return {
        success: true,
        value,
        attempts: attempt + 1,
        totalDurationMs: Date.now() - startTime,
        attemptDurations,
      };
    } catch (error) {
      attemptDurations.push(Date.now() - attemptStart);
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we should retry
      const shouldRetry = attempt < opts.maxRetries && isRetryableError(error, opts);
      
      if (!shouldRetry) {
        // Non-retryable error or max retries reached
        break;
      }
      
      // Calculate and apply backoff delay
      const delay = calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: attemptDurations.length,
    totalDurationMs: Date.now() - startTime,
    attemptDurations,
  };
}

/**
 * Execute a fetch request with retry logic
 * 
 * @param url - The URL to fetch
 * @param init - Fetch init options
 * @param config - Retry configuration
 * @returns The fetch Response
 * @throws Error if all retries fail
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  config: Partial<RetryConfig> = {}
): Promise<Response> {
  const opts: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  
  const result = await withRetry(async () => {
    const response = await fetch(url, init);
    
    // Check if response status is retryable
    if (!response.ok && isRetryableStatus(response.status, opts)) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as RetryableError;
      error.status = response.status;
      error.retryable = true;
      throw error;
    }
    
    return response;
  }, opts);
  
  if (!result.success) {
    throw result.error || new Error('Fetch failed after retries');
  }
  
  return result.value!;
}

/**
 * Create a retry wrapper for a specific function
 * 
 * @param fn - The function to wrap
 * @param config - Retry configuration
 * @returns A wrapped function with retry logic
 */
export function createRetryWrapper<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: Partial<RetryConfig> = {}
): (...args: Parameters<T>) => Promise<RetryResult<Awaited<ReturnType<T>>>> {
  return async (...args: Parameters<T>) => {
    return withRetry(() => fn(...args), config);
  };
}

/**
 * Get retry statistics from multiple retry results
 */
export function getRetryStats(results: RetryResult<unknown>[]): {
  totalAttempts: number;
  successfulOperations: number;
  failedOperations: number;
  averageAttempts: number;
  averageDurationMs: number;
  maxAttempts: number;
} {
  const successful = results.filter(r => r.success);
  const totalAttempts = results.reduce((sum, r) => sum + r.attempts, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.totalDurationMs, 0);
  const maxAttempts = Math.max(...results.map(r => r.attempts), 0);
  
  return {
    totalAttempts,
    successfulOperations: successful.length,
    failedOperations: results.length - successful.length,
    averageAttempts: results.length > 0 ? totalAttempts / results.length : 0,
    averageDurationMs: results.length > 0 ? totalDuration / results.length : 0,
    maxAttempts,
  };
}
