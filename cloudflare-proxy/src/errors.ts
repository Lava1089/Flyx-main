/**
 * Structured error response utilities for the CF Worker
 * All error responses include CORS headers per Requirement 4.4
 */

export interface CFWorkerErrorBody {
  error: string;
  code?: string;
  message?: string;
  stack?: string;
  timestamp: string;
}

/**
 * Create a structured JSON error response with CORS headers.
 * Used by all route handlers when an error occurs.
 */
export function errorResponse(message: string, status: number, extra?: Record<string, unknown>): Response {
  const body: CFWorkerErrorBody = {
    error: message,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Create a detailed error response that includes the error's message and stack.
 * Used for provider-specific errors where debugging info is helpful.
 */
export function detailedErrorResponse(label: string, err: Error, status = 500): Response {
  return new Response(JSON.stringify({
    error: label,
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
