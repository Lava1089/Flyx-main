# Server Infrastructure

## 26 NATO-Named Servers (Validated from live `tmdb-poster-utils.js`)

Hexa.su exposes 26 stream servers using the NATO phonetic alphabet, each mapped to a mythology display name:

| NATO Code | Display Name | Priority |
|-----------|-------------|----------|
| alpha | Ares | ★ High |
| bravo | Balder | ★ High |
| charlie | Circe | ★ High |
| delta | Dionysus | ★ High |
| echo | Eros | ★ High |
| foxtrot | Freya | ★ High |
| golf | Gaia | ★ High |
| hotel | Hades | Medium |
| india | Isis | Medium |
| juliet | Juno | Medium |
| kilo | Kronos | Medium |
| lima | Loki | Medium |
| mike | Medusa | Medium |
| november | Nyx | Medium |
| oscar | Odin | Medium |
| papa | Persephone | Medium |
| quebec | Quirinus | Low |
| romeo | Ra | Low |
| sierra | Selene | Low |
| tango | Thor | Low |
| uniform | Uranus | Low |
| victor | Vulcan | Low |
| whiskey | Woden | Low |
| xray | Xolotl | Low |
| yankee | Ymir | Low |
| zulu | Zeus | Low |

The first 7 servers (alpha–golf) typically return sources most reliably. The remaining servers may return sources for popular content but are less consistent.

Note: Our codebase now correctly uses `india: "Isis"` matching the live backend.

## Client vs Server Extraction Strategy

The live client (`tmdb-image-enhancer.js`) iterates servers **sequentially** in priority order, stopping at the first success. It enforces a 200ms delay between calls and a 50-call session limit.

Our server-side implementation queries servers in small parallel batches (4 at a time) with 150ms delays between batches. This is a compromise between the browser's sequential approach and full parallel — fast enough for good UX while avoiding API rate-limiting. Extraction stops early once 6+ sources are collected.

## CDN Domains

Stream URLs point to CDN subdomains. Known CDN domain patterns:

| Domain | Type |
|--------|------|
| `*.frostcomet.com` | HLS segments |
| `*.thunderleaf.com` | HLS segments |
| `*.skyember.com` | HLS segments |
| `p.XXXXX.workers.dev` | Cloudflare Worker CDN |

CDN subdomains are behind Cloudflare and may block requests from CF Worker IPs (same-network restriction). This requires routing through a residential proxy (RPI) for segment delivery.

## Stream Format

- All streams are HLS (HTTP Live Streaming)
- Master playlist → variant playlists → `.ts` segments
- Multiple quality levels available (typically 360p to 1080p)
- Target segment duration: ~4 seconds
- Segments are MPEG-TS (magic byte `0x47`) or fMP4

## Server Selection Strategy

### Single Server (`/flixer/extract`)
Request a specific server by name. Used for targeted extraction or retry.

### All Servers (`/flixer/extract-all`)
Batched extraction with warm-up-based server discovery:
1. Decrypt the warm-up response to discover which servers are currently available
2. Order servers by priority (alpha → zulu NATO order)
3. Process in batches of 4 with 150ms delay between batches
4. Stop early once 6+ sources are collected
5. Return all collected sources

This typically yields 3–8 working sources while avoiding API rate-limiting.

## Failure Handling

- After 5 consecutive failures across all servers, the WASM state is force-reset
- WASM is re-initialized every 30 minutes regardless of success
- Server time is re-synced if more than 5 minutes have elapsed since last init
- Individual server failures are logged but don't block other servers
- The warm-up response is decrypted to determine available servers (falls back to all 26 if decryption fails)
