# Flixer / Hexa.su — Infrastructure Recon & Reverse Engineering

Full reverse engineering documentation of the Flixer and Hexa streaming infrastructure.
Two frontends (`flixer.su`, `hexa.su`) sharing the same backend.

## Contents

| File | Description |
|------|-------------|
| `DOMAIN-HISTORY.md` | Domain migration timeline, live domain inventory, architecture diagram |
| `API-ARCHITECTURE.md` | Complete API endpoint mapping, client module loading, rate limits |
| `WASM-REVERSE-ENGINEERING.md` | WASM module analysis — keygen, decryption, browser fingerprinting |
| `AUTH-PROTOCOL.md` | HMAC-SHA256 auth scheme, time sync, nonce generation, header rules |
| `SERVER-INFRASTRUCTURE.md` | 26 NATO-named CDN servers, failover strategy, CDN domains |
| `ANTI-BOT-DEFENSES.md` | 11 defense layers: JS challenges, header traps, fingerprinting, rate limits |
| `PROXY-ARCHITECTURE.md` | Our extraction pipeline — CF Worker, RPI proxy, Docker proxy |
| `EXTRACTION-FLOW.md` | Step-by-step extraction walkthrough from TMDB ID to playable HLS |

## Quick Reference

- **Flixer frontend**: `https://flixer.su`
- **Hexa frontend**: `https://hexa.su`
- **Flixer TMDB API**: `https://plsdontscrapemelove.flixer.su`
- **Hexa TMDB API**: `https://themoviedb.hexa.su` (used by our codebase)
- **Flixer user API**: `https://api.flixer.su`
- **Hexa user API**: `https://api.hexa.su`
- **WASM module**: `img_data_bg.wasm` (Rust-compiled, wasm-bindgen) — served at `/assets/wasm/`
- **Auth**: HMAC-SHA256 signed requests with server-synced timestamps, 64-char WASM-generated key
- **Output**: HLS m3u8 streams via CDN subdomains (e.g., `*.frostcomet.com`)
- **Servers**: 26 (alpha–zulu), NATO alphabet mapped to mythology names
- **Client rate limit**: 50 decrypt calls per session (bypassed server-side)

## Codebase Corrections ✅

All codebase references have been corrected:
- `flixer.cc` → `flixer.su` across all files
- `india: "Iris"` → `india: "Isis"` in all SERVER_NAMES maps
- Domain allowlist updated with `flixer.su`
- Docker proxy API base updated from dead `flixer.sh` to `themoviedb.hexa.su`
