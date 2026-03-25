# Live TV Update — They Moved Everything. We Followed.

@everyone — DLHD live TV streams are being restored. Here's the full breakdown of what happened and what they tried.

## What DLHD Did This Time

They went full witness protection. Moved *everything* — the main site, the player domain, the key servers, and even the streaming architecture itself. Simultaneously. At the same time. Like rearranging every piece of furniture in your house while the house is on a flatbed truck driving to a new address.

Here's the damage report:

### The Great Domain Migration

The main site now bounces through **four** 301 redirects before you land anywhere:

```
thedaddy.top → daddylivestream.com → dlhd.dad → dlhd.link → dlstreams.top
```

`daddylive.mp` is dead. Won't even accept a connection. Our code was pointing at a ghost.

### New Player Domain

The player page moved from `ksohls.ru` to **`enviromentalspace.sbs`** — yes, they misspelled "environmental." They also put it behind Cloudflare this time. The page is still serving reCAPTCHA v3 with the same site key, same verification flow, same 20-minute whitelist timer. They didn't change the lock, they just moved the door.

### New Key Servers

The old key server `go.ai-chatx.site` is completely dead — connection refused. Keys are now served from **`key.keylocking.ru`** (creative name, really). The browser-side player code patches `fetch()` and `XMLHttpRequest` at runtime to silently redirect key requests between `key2.keylocking.ru` and `key.keylocking.ru`. Because apparently intercepting your own API calls is a normal thing to do.

The old chevy servers (`soyspace.cyou`, `vmvmv.shop`, `vovlacosa.sbs`) are still alive but still returning poison keys to non-whitelisted IPs. Same three fake keys as before. `45db13cf` still haunts us.

### New M3U8 Server

There's a brand new M3U8 proxy server at **`ai.the-sunmoon.site`** that handles server lookups, M3U8 delivery, and the reCAPTCHA `/verify` endpoint. `chevy.soyspace.cyou` still works as fallback. The player page now does a `/status` health check on the M3U8 servers before picking one — load balancing for pirated streams. Professional.

### The P2P Experiment (Channel 44)

Here's where it gets interesting. Some channels — we caught ESPN (channel 44) — have been moved to a **completely different streaming architecture**. No reCAPTCHA at all. Instead:

- **Clappr player** with **P2P WebRTC** via `p2p-media-loader`
- Streams served from `py3hsjj2.04334746.net:8443` with **token-signed M3U8 URLs** that expire
- WebSocket tracker at `wss://hlspatch.net:3000` for peer discovery
- Embed domain: `goalwagon.net` → `extinctdeprive.net` (another redirect, naturally)

They're making viewers share bandwidth with each other to reduce their CDN costs. Your browser becomes a node in their streaming network. Clever, but it means they're offloading infrastructure costs onto their users' upload bandwidth.

### Tighter Channel Limits

The error messages in the new player code confirm stricter limits: **4 channels simultaneously**, max **13 different channels per 30-minute window**. Channel 14 in 30 minutes? Come back later.

## What We Did About It

Updated every domain reference across the Cloudflare Worker and RPI Proxy. The auth flow now tries `enviromentalspace.sbs` first and falls back to `ksohls.ru`. Server lookups hit `ai.the-sunmoon.site` before falling back to the chevy domains. Key requests now target `key.keylocking.ru`. The domain allowlist has been expanded to cover every new domain they introduced.

All the redirect chains, all the domain swaps, all the key server shuffles — mapped and patched. Our code now knows about more of their domains than they probably remember having.

## TL;DR

- DLHD moved their main site through 4 redirects, swapped the player domain, introduced new key servers, and launched a P2P streaming experiment
- `daddylive.mp` and `go.ai-chatx.site` are dead
- New player: `enviromentalspace.sbs` (yes, misspelled)
- New key server: `key.keylocking.ru`
- New M3U8 server: `ai.the-sunmoon.site`
- Some channels now use P2P/WebRTC (no reCAPTCHA)
- Channel limits tightened to 4 concurrent / 13 per 30 min
- All changes patched. Streams should be coming back online

They moved to a new house. We already had the spare key.

*— vynx*
