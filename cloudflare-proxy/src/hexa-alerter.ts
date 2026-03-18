/**
 * Hexa/Flixer Webhook Notification System
 *
 * Sends alerts via configurable webhook (Discord-compatible embed format)
 * with per-type rate limiting (max 1 alert per type per hour via KV TTL).
 *
 * Requirements: REQ-HEALTH-3.1, REQ-HEALTH-3.2, REQ-HEALTH-3.3
 */

export interface Alert {
  type: 'domain_change' | 'fingerprint_change' | 'route_change' | 'wasm_change' | 'wasm_breaking_change' | 'unreachable';
  message: string;
  oldValue?: string;
  newValue?: string;
  autoFixed: boolean;
}

export interface AlertPayload {
  type: string;
  message: string;
  oldValue?: string;
  newValue?: string;
  autoFixed: boolean;
  timestamp: string;
}

const ALERT_COLORS: Record<string, number> = {
  domain_change: 0xffa500,       // orange
  fingerprint_change: 0xffa500,  // orange
  route_change: 0xffa500,        // orange
  wasm_change: 0x3498db,         // blue
  wasm_breaking_change: 0xe74c3c, // red
  unreachable: 0xe74c3c,         // red
};

const RATE_LIMIT_TTL_SECONDS = 3600; // 1 hour

/** Only allow webhook URLs to known-safe destinations (Discord, Slack, custom). */
const ALLOWED_WEBHOOK_PATTERNS = [
  /^https:\/\/discord\.com\/api\/webhooks\//,
  /^https:\/\/discordapp\.com\/api\/webhooks\//,
  /^https:\/\/hooks\.slack\.com\//,
  /^https:\/\/[a-z0-9-]+\.workers\.dev\//,
];

export function isAllowedWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_WEBHOOK_PATTERNS.some(p => p.test(url));
  } catch {
    return false;
  }
}

/**
 * Format an Alert into a webhook-ready AlertPayload.
 */
export function formatAlertPayload(alert: Alert): AlertPayload {
  const payload: AlertPayload = {
    type: alert.type,
    message: alert.message,
    autoFixed: alert.autoFixed,
    timestamp: new Date().toISOString(),
  };
  if (alert.oldValue !== undefined) payload.oldValue = alert.oldValue;
  if (alert.newValue !== undefined) payload.newValue = alert.newValue;
  return payload;
}

/**
 * Build a Discord-compatible embed object from an AlertPayload.
 */
export function buildDiscordEmbed(payload: AlertPayload): object {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Type', value: payload.type, inline: true },
    { name: 'Auto-Fixed', value: payload.autoFixed ? 'Yes' : 'No', inline: true },
  ];

  if (payload.oldValue !== undefined) {
    fields.push({ name: 'Old Value', value: payload.oldValue || '(empty)', inline: false });
  }
  if (payload.newValue !== undefined) {
    fields.push({ name: 'New Value', value: payload.newValue || '(empty)', inline: false });
  }

  return {
    embeds: [
      {
        title: '🔔 Hexa Monitor Alert',
        description: payload.message,
        color: ALERT_COLORS[payload.type] ?? 0x95a5a6,
        fields,
        timestamp: payload.timestamp,
        footer: { text: 'Hexa Resilient Extraction Monitor' },
      },
    ],
  };
}

/**
 * Check if an alert of the given type was already sent within the last hour.
 * Uses KV key `alert_ratelimit:{type}` with a 1-hour TTL.
 */
export async function isRateLimited(type: string, kv: KVNamespace): Promise<boolean> {
  try {
    const val = await kv.get(`alert_ratelimit:${type}`);
    return val !== null;
  } catch {
    // If KV is unavailable, don't block the alert
    return false;
  }
}

/**
 * Record that an alert of the given type was sent (sets rate limit flag).
 */
async function setRateLimit(type: string, kv: KVNamespace): Promise<void> {
  try {
    await kv.put(`alert_ratelimit:${type}`, '1', { expirationTtl: RATE_LIMIT_TTL_SECONDS });
  } catch {
    // Best-effort — don't fail the alert if KV write fails
  }
}

/**
 * Send an alert via webhook, respecting rate limits.
 *
 * Returns true if the alert was dispatched, false if rate-limited or failed.
 */
export async function sendAlert(
  webhookUrl: string,
  alert: Alert,
  kv: KVNamespace,
): Promise<boolean> {
  // Validate webhook URL to prevent SSRF / data exfiltration
  if (!isAllowedWebhookUrl(webhookUrl)) {
    console.error('[hexa-alerter] Blocked alert: webhook URL not in allowlist');
    return false;
  }

  // Check rate limit first
  const limited = await isRateLimited(alert.type, kv);
  if (limited) return false;

  const payload = formatAlertPayload(alert);
  const discordBody = buildDiscordEmbed(payload);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordBody),
      signal: AbortSignal.timeout(5_000),
    });

    if (response.ok) {
      await setRateLimit(alert.type, kv);
      return true;
    }
    return false;
  } catch {
    // Webhook failure is best-effort
    return false;
  }
}
