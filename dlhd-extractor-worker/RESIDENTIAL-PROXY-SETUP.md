# DLHD Key Fetching via Residential Proxy (March 2026)

This guide explains how to set up the DLHD key fetching system using a rotating residential proxy, eliminating the need for a Raspberry Pi (RPI) proxy server.

## Background

DLHD encrypts live streams with AES-128. The encryption keys rotate every ~3-5 minutes. Key servers return **fake keys** to non-whitelisted IPs. To get real keys, an IP must be whitelisted via reCAPTCHA v3.

Previously this required an RPI with a residential IP running `rust-fetch` to solve reCAPTCHA and fetch keys. The new system replaces this with a cheap rotating residential proxy service, with everything running inside the DLHD Cloudflare Worker.

## Architecture

```
Browser (HLS.js) → /key?url=... → DLHD CF Worker
                                     │
                                ┌────┴────┐
                                │  Cache   │  L1: in-memory (instant)
                                │  Lookup  │  L2: Workers KV (~10ms)
                                └────┬────┘
                                 cache miss
                                     │
                          ┌──────────┴──────────┐
                          │  Residential SOCKS5  │  Rotating proxy with
                          │  Proxy (ProxyJet)    │  sticky session (~15 min)
                          └──────────┬──────────┘
                               fake key?
                                     │
                          ┌──────────┴──────────┐
                          │  1. reCAPTCHA Bypass │  CF Worker → Google (direct)
                          │  2. POST /verify     │  Through same proxy IP
                          │  3. Retry key fetch  │  Proxy IP now whitelisted
                          └─────────────────────┘
```

### How It Works

1. **Key request comes in** — HLS.js requests a decryption key via the `/key` endpoint.
2. **Cache check** — The worker checks an in-memory cache and Workers KV. If a valid key is cached (3-min TTL), it returns immediately.
3. **Proxy fetch** — On cache miss, the worker fetches the key through a residential SOCKS5 proxy using a sticky session (same IP maintained for ~15 min).
4. **Whitelist if needed** — If the proxy IP isn't whitelisted (fake key returned), the worker:
   - Solves reCAPTCHA v3 via a pure HTTP bypass (no browser needed)
   - POSTs the token to DLHD's verify endpoint through the same proxy IP
   - This whitelists the proxy IP for ~20 minutes
   - Retries the key fetch — now gets a real key
5. **Cache and return** — The real key is cached in KV (3-min TTL) and returned.
6. **Background refresh** — When a whitelist session is nearing expiry, the worker proactively refreshes it in the background via `ctx.waitUntil()`.

## Prerequisites

- A Cloudflare account with Workers enabled
- A rotating residential proxy account (this guide uses [ProxyJet](https://proxyjet.io/), but any SOCKS5 provider works with minor code changes)
- Node.js 18+ and `wrangler` CLI installed

## Setup

### Step 1: Create a Workers KV Namespace

The worker uses KV to cache keys globally across all CF edge locations.

```bash
cd dlhd-extractor-worker
npx wrangler kv:namespace create KEY_CACHE_KV
```

This outputs something like:

```
{ binding = "KEY_CACHE_KV", id = "abc123def456..." }
```

Edit `wrangler.toml` and uncomment/update the KV binding:

```toml
[[kv_namespaces]]
binding = "KEY_CACHE_KV"
id = "abc123def456..."
```

### Step 2: Get Residential Proxy Credentials

Sign up at [ProxyJet](https://proxyjet.io/) (or your preferred provider). You need:

| Detail | Example Value |
|--------|--------------|
| SOCKS5 Host | `proxy-jet.io` |
| SOCKS5 Port | `2020` |
| Username | `YOURACCTID-resi-US` |
| Password | `yourpassword` |

The username should include the country code (e.g., `-resi-US`). The worker automatically appends `-ip-{sessionId}` for sticky sessions.

**Cost**: Rotating residential proxies cost ~$1-2/GB. This system uses ~1-2 GB/month for key fetching, so expect **~$1-3/month**.

### Step 3: Configure Worker Secrets

Set the proxy credentials as Cloudflare Worker secrets (not in `wrangler.toml` — secrets are encrypted):

```bash
npx wrangler secret put RESIDENTIAL_PROXY_HOST
# Enter: proxy-jet.io

npx wrangler secret put RESIDENTIAL_PROXY_PORT
# Enter: 2020

npx wrangler secret put RESIDENTIAL_PROXY_USER
# Enter: YOURACCTID-resi-US

npx wrangler secret put RESIDENTIAL_PROXY_PASS
# Enter: yourpassword
```

### Step 4: Deploy

```bash
npx wrangler deploy
```

### Step 5: Verify

Test the key endpoint with a live channel:

```bash
# Get a fresh M3U8 to find the current key URL
KEY_URL=$(curl -s 'https://ai.the-sunmoon.site/proxy/zeko/premium44/mono.css' \
  -H 'Origin: https://enviromentalspace.sbs' \
  -H 'Referer: https://enviromentalspace.sbs/' \
  | grep -oP 'URI="([^"]+)"' | sed 's/URI="//;s/"//')

# Fetch the key through your worker
curl -v "https://your-worker.workers.dev/key?url=https://key.keylocking.ru${KEY_URL}"
```

Check the response headers:
- `X-Key-Source: kv-cache` — served from cache (fastest)
- `X-Key-Source: residential-proxy` — fetched via proxy (cache miss, proxy whitelisted)
- `X-Key-Source: residential-after-whitelist` — fetched after reCAPTCHA whitelist
- `X-Key-Source: rpi-fallback` — fell back to RPI proxy (if configured)
- `X-Key-Source: fallback-fake` — all methods failed, returned fake key

### Step 6: Monitor

Watch live logs:

```bash
npx wrangler tail dlhd
```

Look for these log tags:
- `[reCAPTCHA]` — reCAPTCHA v3 bypass activity
- `[SOCKS5-Resi]` — residential proxy requests
- `[KeyCache]` — cache hits/misses and session management
- `[/key]` — key endpoint request flow

## Using a Different Proxy Provider

The code supports any SOCKS5 proxy provider. The only provider-specific logic is the sticky session username format in `src/direct/socks5-proxy.ts`:

```typescript
// ProxyJet format: USERNAME-resi-US-ip-{sessionId}
export function createStickySession(baseUsername: string, sessionId?: string) {
  const id = sessionId || `s${Date.now().toString(36)}...`;
  const username = `${baseUsername}-ip-${id}`;
  return { username, sessionId: id };
}
```

**To use a different provider**, update this function to match your provider's sticky session format:

| Provider | Sticky Session Format |
|----------|----------------------|
| ProxyJet | `USERNAME-resi-US-ip-{SESSION_ID}` |
| IPRoyal | `USERNAME-sessid-{SESSION_ID}-sesstime-30` |
| PacketStream | `USERNAME-sessid-{SESSION_ID}` |
| Bright Data | `USERNAME-session-{SESSION_ID}` |

Then set the matching host/port/credentials via `wrangler secret put`.

## Feature Flag / Fallback Behavior

The residential proxy path is **feature-flagged**. The worker checks for `RESIDENTIAL_PROXY_HOST` in the environment:

- **If set**: Uses residential proxy as primary, RPI as fallback, direct fetch as last resort.
- **If not set**: Uses the legacy RPI proxy flow (existing behavior, no changes).

This means you can deploy the updated worker without breaking anything — it only activates the new path when proxy secrets are configured.

## Removing the RPI Proxy

Once you've verified the residential proxy works reliably:

1. Remove `RPI_PROXY_URL` and `RPI_PROXY_API_KEY` secrets from the worker
2. The worker will skip the RPI fallback automatically
3. You can decommission the RPI server

## Troubleshooting

### All keys are fake (X-Key-Source: fallback-fake)

- Check `wrangler tail` logs for `[reCAPTCHA]` errors — Google may have changed the reCAPTCHA API.
- Verify your proxy credentials are correct: `wrangler secret list` should show all 4 proxy secrets.
- Test the proxy directly: the worker logs the SOCKS5 connection status.

### reCAPTCHA bypass fails

The bypass uses Google's `api2/anchor` → `api2/reload` flow. If Google changes this:
1. Check `[reCAPTCHA] ❌ no recaptcha-token in anchor page` — the anchor HTML format changed.
2. Check `[reCAPTCHA] ❌ no rresp in reload response` — the reload response format changed.
3. The reCAPTCHA site key may have rotated — check the DLHD player page source for the current key and update `RECAPTCHA_SITE_KEY` in `src/direct/recaptcha-v3.ts`.

### SOCKS5 connection errors

- Verify your provider's SOCKS5 port (ProxyJet uses `2020` for SOCKS5, `1010` for HTTP).
- Check if your proxy account has bandwidth remaining.
- The worker logs `[SOCKS5-Resi] ❌` with the specific error.

### Keys cached but stale

- KV cache TTL is 3 minutes. If DLHD rotates keys faster, reduce `DEFAULT_KEY_TTL_SEC` in `src/direct/key-cache.ts`.
- In-memory cache is per-isolate and may serve stale keys briefly after KV expiry. This is by design — a few seconds of stale key is better than a cache miss.

## File Reference

| File | Purpose |
|------|---------|
| `src/direct/recaptcha-v3.ts` | reCAPTCHA v3 HTTP bypass (ported from rust-fetch) |
| `src/direct/socks5-proxy.ts` | SOCKS5 client with auth, POST support, sticky sessions |
| `src/direct/key-cache.ts` | Two-tier key cache (memory + KV) and whitelist session manager |
| `src/routes.ts` | `/key` endpoint with residential proxy → RPI fallback → direct fetch |
| `src/types.ts` | `Env` interface with proxy config bindings |
| `wrangler.toml` | KV namespace binding and secret documentation |

## Cost Summary

| Component | Monthly Cost |
|-----------|-------------|
| Residential proxy (~1-2 GB bandwidth) | ~$1-3 |
| Cloudflare Workers (free tier: 100k req/day) | $0 |
| Cloudflare KV (free tier: 100k reads/day) | $0 |
| **Total** | **~$1-3/month** |

Compared to running an RPI proxy ($0 if you own one, but single point of failure with no redundancy), this approach is more reliable, globally distributed, and nearly free.
