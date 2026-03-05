import { Env, ErrorResponse } from '../types';

export interface AuthResult {
  valid: boolean;
  apiKey?: string;
  error?: string;
  statusCode?: number;
}

/**
 * Parse API keys from environment variable
 * Keys are trimmed and empty/whitespace-only keys are filtered out
 */
export function parseApiKeys(env: Env): Set<string> {
  const apiKeysStr = env.API_KEYS || '';
  if (!apiKeysStr.trim()) {
    return new Set();
  }
  return new Set(
    apiKeysStr
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0)
  );
}

/**
 * Check if an API key is valid (non-empty after trimming)
 */
function isValidApiKeyFormat(apiKey: string): boolean {
  return apiKey.trim().length > 0;
}

/**
 * Validate API key from request
 * 
 * Property 14: API Key Validation
 * - Requests without an API key SHALL be rejected with 401
 * - Requests with an invalid API key SHALL be rejected with 403
 * - Only requests with valid API keys SHALL proceed
 */
export function validateApiKey(request: Request, env: Env): AuthResult {
  const apiKey = request.headers.get('X-API-Key');
  
  // No API key provided - 401 Unauthorized
  if (!apiKey) {
    return {
      valid: false,
      error: 'Missing API key',
      statusCode: 401,
    };
  }
  
  // Check if API key format is valid (non-empty after trimming)
  if (!isValidApiKeyFormat(apiKey)) {
    return {
      valid: false,
      error: 'Invalid API key',
      statusCode: 403,
    };
  }
  
  const validKeys = parseApiKeys(env);
  
  // If no keys configured, allow all (development mode)
  if (validKeys.size === 0) {
    return {
      valid: true,
      apiKey,
    };
  }
  
  // Invalid API key - 403 Forbidden
  // Compare trimmed key against valid keys (which are also trimmed)
  if (!validKeys.has(apiKey.trim())) {
    return {
      valid: false,
      error: 'Invalid API key',
      statusCode: 403,
    };
  }
  
  // Valid API key
  return {
    valid: true,
    apiKey,
  };
}

/**
 * Create error response for auth failures
 * Sanitizes error messages to not expose internal details
 */
export function createAuthErrorResponse(result: AuthResult): Response {
  const errorResponse: ErrorResponse = {
    success: false,
    error: result.error || 'Authentication failed',
    code: result.statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
  };
  
  return new Response(JSON.stringify(errorResponse), {
    status: result.statusCode || 401,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
