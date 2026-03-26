/**
 * SSEManager - Server-Sent Events endpoint for real-time admin data push
 *
 * Manages SSE connections with JWT authentication, channel-based subscription
 * filtering, keepalive pings, periodic JWT re-validation, and Last-Event-ID
 * reconnection support with delta replay.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 4.3, 9.1, 9.2, 9.3, 9.4
 */

import { DeltaEngine, DeltaUpdate } from './delta-engine';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Keepalive ping interval in ms */
const KEEPALIVE_INTERVAL_MS = 30_000;

/** JWT re-validation interval in ms */
const JWT_REVALIDATION_INTERVAL_MS = 5 * 60 * 1000;

/** Valid SSE channel names */
export const VALID_CHANNELS = ['realtime', 'users'] as const;
export type SSEChannel = (typeof VALID_CHANNELS)[number];

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SSEConnection {
  id: string;
  channels: Set<SSEChannel>;
  lastSequence: Map<string, number>; // per-channel sequence tracking
  writer: WritableStreamDefaultWriter;
  connectedAt: number;
  jwtExpiry: number;
  lastJwtCheck: number;
}

export interface SSEEvent {
  id: string;
  event: string;
  data: string;
}

export interface JWTPayload {
  sub: string;
  exp: number;
  iat: number;
  role?: string;
}

/**
 * Validates a JWT token and returns the payload if valid.
 * Returns null if the token is invalid, malformed, or expired.
 */
export type JWTValidator = (token: string) => Promise<JWTPayload | null>;

// ---------------------------------------------------------------------------
// PII sanitization
// ---------------------------------------------------------------------------

/** IPv4 pattern */
const IPV4_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** IPv6 pattern (simplified — catches common forms) */
const IPV6_REGEX = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g;

/** Email pattern */
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

/**
 * Sanitize a JSON string by replacing any PII patterns with anonymized placeholders.
 */
export function sanitizePayload(json: string): string {
  return json
    .replace(IPV4_REGEX, '[REDACTED_IP]')
    .replace(IPV6_REGEX, '[REDACTED_IP]')
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
}

/**
 * Check if a string contains PII patterns.
 */
export function containsPII(json: string): boolean {
  return IPV4_REGEX.test(json) || IPV6_REGEX.test(json) || EMAIL_REGEX.test(json);
}

// ---------------------------------------------------------------------------
// SSEManager
// ---------------------------------------------------------------------------

export class SSEManager {
  private connections: Map<string, SSEConnection> = new Map();
  private deltaEngine: DeltaEngine;
  private validateJWT: JWTValidator;
  private connectionCounter = 0;

  constructor(deltaEngine: DeltaEngine, validateJWT: JWTValidator) {
    this.deltaEngine = deltaEngine;
    this.validateJWT = validateJWT;
  }

  /**
   * Handle an incoming SSE connection request.
   * Validates JWT, parses channel subscriptions, and returns an SSE Response.
   *
   * Query params:
   *   - token: JWT token (alternative to cookie)
   *   - channels: comma-separated channel names
   * Headers:
   *   - Cookie: admin_token=<JWT> (alternative to query param)
   *   - Last-Event-ID: sequence number for reconnection
   */
  async connect(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract JWT from query param or cookie
    const token = this.extractToken(request, url);
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing authentication token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate JWT
    const jwtPayload = await this.validateJWT(token);
    if (!jwtPayload) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse requested channels
    const channels = this.parseChannels(url.searchParams.get('channels'));
    if (channels.size === 0) {
      // Default to all channels if none specified
      for (const ch of VALID_CHANNELS) channels.add(ch);
    }

    // Parse Last-Event-ID for reconnection
    const lastEventId = request.headers.get('Last-Event-ID');
    const lastSequences = this.parseLastEventId(lastEventId);

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const connectionId = this.generateConnectionId();
    const now = Date.now();

    const connection: SSEConnection = {
      id: connectionId,
      channels,
      lastSequence: lastSequences,
      writer,
      connectedAt: now,
      jwtExpiry: jwtPayload.exp * 1000, // convert to ms
      lastJwtCheck: now,
    };

    this.connections.set(connectionId, connection);

    // Send initial snapshot for each subscribed channel
    this.sendInitialSnapshots(connection, encoder).catch(() => {
      this.disconnect(connectionId);
    });

    // Start keepalive and JWT re-validation
    this.startKeepalive(connectionId, encoder);
    this.startJwtRevalidation(connectionId, token);

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-SSE-Connection-Id': connectionId,
      },
    });
  }

  /**
   * Disconnect and clean up an SSE connection.
   */
  disconnect(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    try {
      conn.writer.close().catch(() => {});
    } catch {
      // Writer may already be closed
    }

    this.connections.delete(connectionId);
  }

  /**
   * Broadcast an event to all connections subscribed to the given channel.
   * The event payload is sanitized to remove any PII before sending.
   */
  broadcast(channel: SSEChannel, event: SSEEvent): void {
    // Sanitize the payload
    const sanitizedData = sanitizePayload(event.data);
    const sanitizedEvent: SSEEvent = { ...event, data: sanitizedData };

    const message = this.formatSSEMessage(sanitizedEvent);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(message);

    for (const [connId, conn] of this.connections) {
      if (conn.channels.has(channel)) {
        conn.writer.write(encoded).catch(() => {
          this.disconnect(connId);
        });
        // Track last sequence per channel
        conn.lastSequence.set(channel, parseInt(event.id, 10) || 0);
      }
    }
  }

  /**
   * Broadcast a delta update to all connections subscribed to the delta's channel.
   * Wraps the delta in an SSE event with proper formatting and PII sanitization.
   */
  broadcastDelta(channel: SSEChannel, delta: DeltaUpdate): void {
    const event: SSEEvent = {
      id: String(delta.sequence),
      event: 'delta',
      data: JSON.stringify({
        channel: delta.channel,
        sequence: delta.sequence,
        timestamp: delta.timestamp,
        changes: delta.changes,
      }),
    };

    this.broadcast(channel, event);
  }

  /**
   * Returns the number of active connections.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Returns connection IDs subscribed to a given channel.
   */
  getSubscribers(channel: SSEChannel): string[] {
    const subscribers: string[] = [];
    for (const [connId, conn] of this.connections) {
      if (conn.channels.has(channel)) {
        subscribers.push(connId);
      }
    }
    return subscribers;
  }

  /**
   * Returns all active connection info (for debugging/monitoring).
   */
  getConnections(): Map<string, SSEConnection> {
    return this.connections;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private extractToken(request: Request, url: URL): string | null {
    // Try query param first
    const queryToken = url.searchParams.get('token');
    if (queryToken) return queryToken;

    // Try cookie
    const cookieHeader = request.headers.get('Cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/admin_token=([^;]+)/);
      if (match) return match[1];
    }

    return null;
  }

  private parseChannels(channelsParam: string | null): Set<SSEChannel> {
    const channels = new Set<SSEChannel>();
    if (!channelsParam) return channels;

    for (const ch of channelsParam.split(',')) {
      const trimmed = ch.trim() as SSEChannel;
      if (VALID_CHANNELS.includes(trimmed)) {
        channels.add(trimmed);
      }
    }
    return channels;
  }

  /**
   * Parse Last-Event-ID header. Format: "channel:seq,channel:seq" or just "seq"
   */
  private parseLastEventId(lastEventId: string | null): Map<string, number> {
    const sequences = new Map<string, number>();
    if (!lastEventId) return sequences;

    // Try "channel:seq,channel:seq" format
    if (lastEventId.includes(':')) {
      for (const part of lastEventId.split(',')) {
        const [channel, seqStr] = part.trim().split(':');
        const seq = parseInt(seqStr, 10);
        if (channel && !isNaN(seq)) {
          sequences.set(channel, seq);
        }
      }
    } else {
      // Single sequence number — apply to all channels
      const seq = parseInt(lastEventId, 10);
      if (!isNaN(seq)) {
        for (const ch of VALID_CHANNELS) {
          sequences.set(ch, seq);
        }
      }
    }

    return sequences;
  }

  private generateConnectionId(): string {
    this.connectionCounter++;
    return `sse_${Date.now()}_${this.connectionCounter}`;
  }

  private async sendInitialSnapshots(
    connection: SSEConnection,
    encoder: TextEncoder
  ): Promise<void> {
    for (const channel of connection.channels) {
      const fullState = this.deltaEngine.getFullState(channel);
      const currentSeq = this.deltaEngine.getSequence(channel);
      const lastClientSeq = connection.lastSequence.get(channel) ?? 0;

      // If client has a last sequence and it matches current, no snapshot needed
      // (they're up to date). If there's a gap, send full snapshot.
      const eventType = lastClientSeq > 0 && lastClientSeq === currentSeq
        ? null // up to date
        : 'snapshot';

      if (eventType) {
        const data = JSON.stringify({
          channel,
          sequence: currentSeq,
          state: fullState,
        });

        const event: SSEEvent = {
          id: String(currentSeq),
          event: 'snapshot',
          data: sanitizePayload(data),
        };

        const message = this.formatSSEMessage(event);
        await connection.writer.write(encoder.encode(message));
        connection.lastSequence.set(channel, currentSeq);
      }
    }
  }

  private startKeepalive(connectionId: string, encoder: TextEncoder): void {
    const interval = setInterval(() => {
      const conn = this.connections.get(connectionId);
      if (!conn) {
        clearInterval(interval);
        return;
      }

      const pingEvent: SSEEvent = {
        id: '',
        event: 'ping',
        data: JSON.stringify({ timestamp: Date.now() }),
      };

      const message = this.formatSSEMessage(pingEvent);
      conn.writer.write(encoder.encode(message)).catch(() => {
        clearInterval(interval);
        this.disconnect(connectionId);
      });
    }, KEEPALIVE_INTERVAL_MS);
  }

  private startJwtRevalidation(connectionId: string, token: string): void {
    const interval = setInterval(async () => {
      const conn = this.connections.get(connectionId);
      if (!conn) {
        clearInterval(interval);
        return;
      }

      const now = Date.now();

      // Check if JWT has expired based on stored expiry
      if (now >= conn.jwtExpiry) {
        // Send auth_expired event before closing
        const encoder = new TextEncoder();
        const event: SSEEvent = {
          id: '',
          event: 'auth_expired',
          data: JSON.stringify({ reason: 'Token expired' }),
        };
        const message = this.formatSSEMessage(event);
        conn.writer.write(encoder.encode(message)).catch(() => {});

        clearInterval(interval);
        this.disconnect(connectionId);
        return;
      }

      // Periodic re-validation
      if (now - conn.lastJwtCheck >= JWT_REVALIDATION_INTERVAL_MS) {
        const payload = await this.validateJWT(token);
        conn.lastJwtCheck = now;

        if (!payload) {
          const encoder = new TextEncoder();
          const event: SSEEvent = {
            id: '',
            event: 'auth_expired',
            data: JSON.stringify({ reason: 'Token validation failed' }),
          };
          const message = this.formatSSEMessage(event);
          conn.writer.write(encoder.encode(message)).catch(() => {});

          clearInterval(interval);
          this.disconnect(connectionId);
        } else {
          // Update expiry from re-validated token
          conn.jwtExpiry = payload.exp * 1000;
        }
      }
    }, JWT_REVALIDATION_INTERVAL_MS);
  }

  /**
   * Format an SSE event into the wire protocol format.
   */
  private formatSSEMessage(event: SSEEvent): string {
    let message = '';
    if (event.id) {
      message += `id: ${event.id}\n`;
    }
    if (event.event) {
      message += `event: ${event.event}\n`;
    }
    // Split data by newlines for multi-line data
    for (const line of event.data.split('\n')) {
      message += `data: ${line}\n`;
    }
    message += '\n'; // End of event
    return message;
  }
}
