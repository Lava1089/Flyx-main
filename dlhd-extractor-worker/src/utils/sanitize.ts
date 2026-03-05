/**
 * Sanitization Utility Module
 * 
 * Requirements: 8.4, 8.5
 * - THE Worker SHALL not expose internal implementation details in error messages to unauthorized requests
 * - WHEN logging requests, THE Worker SHALL sanitize sensitive information (API keys, tokens)
 * 
 * This module provides utilities for sanitizing error messages and log entries
 * to prevent leaking sensitive information.
 */

/**
 * Patterns that indicate sensitive information in error messages
 */
const SENSITIVE_PATTERNS = {
  // File paths (Unix and Windows)
  filePaths: [
    /\/[a-zA-Z0-9_\-./]+\.(ts|js|json|mjs|cjs)/gi,
    /[A-Z]:\\[a-zA-Z0-9_\-\\]+\.(ts|js|json|mjs|cjs)/gi,
    /at\s+[^\s]+\s+\([^)]+\)/gi, // Stack trace locations
  ],
  // Stack traces
  stackTraces: [
    /^\s*at\s+.+$/gm,
    /Error:.*\n(\s+at\s+.+\n)+/gi,
    /\n\s+at\s+[^\n]+/gi,
  ],
  // Configuration details
  configDetails: [
    /wrangler\.toml/gi,
    /\.env(\.[a-z]+)?/gi,
    /config\.[a-z]+/gi,
    /KV_NAMESPACE_ID[=:]\s*[a-f0-9-]+/gi,
  ],
  // Upstream URLs (internal CDN/server URLs)
  upstreamUrls: [
    /https?:\/\/[a-zA-Z0-9.-]+\.(internal|local|private|cdn)[a-zA-Z0-9./-]*/gi,
    /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[^\s]*/gi, // IP addresses
    /https?:\/\/localhost[^\s]*/gi,
  ],
  // API keys and tokens
  apiKeys: [
    /[a-zA-Z0-9_-]{32,}/g, // Long alphanumeric strings (potential keys)
    /Bearer\s+[a-zA-Z0-9._-]+/gi,
    /api[_-]?key[=:]\s*[^\s,;]+/gi,
    /token[=:]\s*[^\s,;]+/gi,
    /secret[=:]\s*[^\s,;]+/gi,
    /password[=:]\s*[^\s,;]+/gi,
    /authorization[=:]\s*[^\s,;]+/gi,
  ],
};

/**
 * Safe error messages for different error codes
 */
const SAFE_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'Access denied',
  INVALID_API_KEY: 'Invalid credentials',
  RATE_LIMITED: 'Too many requests',
  INTERNAL_ERROR: 'An internal error occurred',
  PARSE_ERROR: 'Failed to process request',
  FETCH_ERROR: 'Failed to retrieve data',
  PROXY_ERROR: 'Proxy request failed',
  EXTRACTION_ERROR: 'Stream extraction failed',
  CHANNEL_NOT_FOUND: 'Channel not found',
  PLAYER_UNAVAILABLE: 'Player not available',
  ALL_PLAYERS_FAILED: 'No available streams',
  UPSTREAM_ERROR: 'Upstream service error',
  TIMEOUT: 'Request timed out',
};

/**
 * Check if a string contains sensitive information
 * 
 * @param text - The text to check
 * @returns True if sensitive information is detected
 */
export function containsSensitiveInfo(text: string): boolean {
  for (const patterns of Object.values(SENSITIVE_PATTERNS)) {
    for (const pattern of patterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a string looks like a file path
 */
export function containsFilePath(text: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS.filePaths) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a string contains a stack trace
 */
export function containsStackTrace(text: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS.stackTraces) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a string contains configuration details
 */
export function containsConfigDetails(text: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS.configDetails) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a string contains upstream URLs
 */
export function containsUpstreamUrl(text: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS.upstreamUrls) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}



/**
 * Sanitize an error message by removing sensitive information
 * 
 * Property 16: Error Message Sanitization
 * *For any* error response to an unauthenticated or unauthorized request, 
 * the error message SHALL NOT contain:
 * - Internal file paths
 * - Stack traces
 * - Configuration details
 * - Upstream URLs
 * 
 * @param message - The error message to sanitize
 * @param errorCode - Optional error code to use for safe message lookup
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(message: string, errorCode?: string): string {
  // If we have a known error code, use the safe message
  if (errorCode && SAFE_ERROR_MESSAGES[errorCode]) {
    return SAFE_ERROR_MESSAGES[errorCode];
  }
  
  // Check if the message contains sensitive information
  if (containsSensitiveInfo(message)) {
    // Return a generic safe message
    return SAFE_ERROR_MESSAGES.INTERNAL_ERROR;
  }
  
  // Message appears safe, return as-is
  return message;
}

/**
 * Create a sanitized error response for unauthorized/unauthenticated requests
 * 
 * @param errorCode - The error code
 * @param originalMessage - The original error message (will be sanitized)
 * @param isAuthenticated - Whether the request is authenticated
 * @returns Sanitized error message
 */
export function createSafeErrorMessage(
  errorCode: string,
  originalMessage: string,
  isAuthenticated: boolean
): string {
  // For unauthenticated requests, always use safe messages
  if (!isAuthenticated) {
    return SAFE_ERROR_MESSAGES[errorCode] || SAFE_ERROR_MESSAGES.INTERNAL_ERROR;
  }
  
  // For authenticated requests, sanitize but allow more detail
  return sanitizeErrorMessage(originalMessage, errorCode);
}

/**
 * Mask sensitive values in a string (for logging)
 * 
 * Property 17: Log Sanitization
 * *For any* log entry generated by the Worker, the entry SHALL NOT contain:
 * - API keys in plain text
 * - Authentication tokens
 * - Full upstream credentials
 * 
 * @param text - The text to mask
 * @returns Text with sensitive values masked
 */
export function maskSensitiveValues(text: string): string {
  let result = text;
  
  // Mask API keys (long alphanumeric strings)
  result = result.replace(/([a-zA-Z0-9_-]{32,})/g, (match) => {
    if (match.length > 8) {
      return match.substring(0, 4) + '****' + match.substring(match.length - 4);
    }
    return '****';
  });
  
  // Mask Bearer tokens
  result = result.replace(/Bearer\s+([a-zA-Z0-9._-]+)/gi, 'Bearer ****');
  
  // Mask key=value patterns for sensitive keys
  const sensitiveKeys = ['api[_-]?key', 'token', 'secret', 'password', 'authorization', 'credential'];
  for (const key of sensitiveKeys) {
    const pattern = new RegExp(`(${key})[=:]\\s*([^\\s,;]+)`, 'gi');
    result = result.replace(pattern, '$1=****');
  }
  
  // Mask X-API-Key header values
  result = result.replace(/X-API-Key[=:]\s*([^\s,;]+)/gi, 'X-API-Key=****');
  
  return result;
}

/**
 * Sanitize an object for logging by masking sensitive values
 * 
 * @param obj - The object to sanitize
 * @returns Sanitized object safe for logging
 */
export function sanitizeForLogging(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    return maskSensitiveValues(obj);
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForLogging(item));
  }
  
  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeyPatterns = [
      /api[_-]?key/i,
      /token/i,
      /secret/i,
      /password/i,
      /authorization/i,
      /credential/i,
      /cookie/i,
    ];
    
    for (const [key, value] of Object.entries(obj)) {
      // Check if the key itself is sensitive
      const isSensitiveKey = sensitiveKeyPatterns.some(pattern => pattern.test(key));
      
      if (isSensitiveKey && typeof value === 'string') {
        // Mask the entire value for sensitive keys
        sanitized[key] = value.length > 8 
          ? value.substring(0, 4) + '****' + value.substring(value.length - 4)
          : '****';
      } else {
        // Recursively sanitize nested objects
        sanitized[key] = sanitizeForLogging(value);
      }
    }
    
    return sanitized;
  }
  
  return obj;
}

/**
 * Logger utility that automatically sanitizes sensitive information
 */
export class SanitizedLogger {
  private prefix: string;
  
  constructor(prefix: string = '') {
    this.prefix = prefix;
  }
  
  /**
   * Log an info message with sanitization
   */
  info(message: string, data?: unknown): void {
    const sanitizedMessage = maskSensitiveValues(message);
    const sanitizedData = data !== undefined ? sanitizeForLogging(data) : undefined;
    
    if (sanitizedData !== undefined) {
      console.log(`${this.prefix}[INFO] ${sanitizedMessage}`, sanitizedData);
    } else {
      console.log(`${this.prefix}[INFO] ${sanitizedMessage}`);
    }
  }
  
  /**
   * Log a warning message with sanitization
   */
  warn(message: string, data?: unknown): void {
    const sanitizedMessage = maskSensitiveValues(message);
    const sanitizedData = data !== undefined ? sanitizeForLogging(data) : undefined;
    
    if (sanitizedData !== undefined) {
      console.warn(`${this.prefix}[WARN] ${sanitizedMessage}`, sanitizedData);
    } else {
      console.warn(`${this.prefix}[WARN] ${sanitizedMessage}`);
    }
  }
  
  /**
   * Log an error message with sanitization
   */
  error(message: string, data?: unknown): void {
    const sanitizedMessage = maskSensitiveValues(message);
    const sanitizedData = data !== undefined ? sanitizeForLogging(data) : undefined;
    
    if (sanitizedData !== undefined) {
      console.error(`${this.prefix}[ERROR] ${sanitizedMessage}`, sanitizedData);
    } else {
      console.error(`${this.prefix}[ERROR] ${sanitizedMessage}`);
    }
  }
  
  /**
   * Log a debug message with sanitization
   */
  debug(message: string, data?: unknown): void {
    const sanitizedMessage = maskSensitiveValues(message);
    const sanitizedData = data !== undefined ? sanitizeForLogging(data) : undefined;
    
    if (sanitizedData !== undefined) {
      console.debug(`${this.prefix}[DEBUG] ${sanitizedMessage}`, sanitizedData);
    } else {
      console.debug(`${this.prefix}[DEBUG] ${sanitizedMessage}`);
    }
  }
}

/**
 * Create a sanitized logger instance
 * 
 * @param prefix - Optional prefix for log messages
 * @returns SanitizedLogger instance
 */
export function createLogger(prefix: string = ''): SanitizedLogger {
  return new SanitizedLogger(prefix);
}

/**
 * Get a safe error message for a given error code
 * 
 * @param errorCode - The error code
 * @returns Safe error message
 */
export function getSafeErrorMessage(errorCode: string): string {
  return SAFE_ERROR_MESSAGES[errorCode] || SAFE_ERROR_MESSAGES.INTERNAL_ERROR;
}

/**
 * Check if an error message is safe to expose
 * 
 * @param message - The error message to check
 * @returns True if the message is safe to expose
 */
export function isMessageSafe(message: string): boolean {
  return !containsSensitiveInfo(message);
}
