# 🔧 Videasy Provider — Decryption Overhaul

**Date:** February 11, 2026

---

## What happened

The external decryption service we relied on (`enc-dec.app`) for Videasy streams went down — returning 500 errors on every request. This meant **all movies and TV shows through Videasy were completely broken**. No sources, no playback, nothing.

## What we did

Instead of waiting for a third-party service to come back online, we reverse-engineered the entire Videasy player decryption pipeline and built our own from scratch.

### The deep dive

We pulled apart the player at `player.videasy.net` and traced the full encryption flow across multiple JS chunks and a WebAssembly module:

1. **Discovered the two-layer encryption** — Videasy's API returns hex-encoded encrypted data. The player decrypts it in two stages: first through a WASM module (`module.wasm`), then through CryptoJS AES.

2. **Cracked the WASM anti-tamper protection** — The WASM module has a `serve()` → `verify()` → `decrypt()` chain. `serve()` spits out ~112KB of heavily obfuscated JavaScript that computes a hash from 50 large numeric variables. This hash must be passed to `verify()` before `decrypt()` will work. The obfuscated JS is deliberately designed to be a memory bomb (~4GB allocation) to prevent server-side execution.

3. **Binary-patched the WASM** — Instead of fighting the obfuscated JS, we analyzed the WASM bytecode directly. Found the verification check at byte offset 46439: a `global.get` → `i32.eqz` → `if` pattern that gates the decrypt function. Patched `global.get $46` to `i32.const 1`, making the verification always pass. Two bytes changed, anti-tamper defeated.

4. **Figured out the AES key is empty** — The second decryption layer uses CryptoJS AES with a key derived from `Hashids.encode(xorResult)`. The XOR result is a hex string, but `Hashids.encode()` only accepts numbers — passing a hex string returns `""`. So the AES key is literally an empty string. Sometimes the simplest answer is the right one.

### Result

- **3 quality tiers** now coming through (1080p, 720p, 360p) with subtitles
- **Zero external dependencies** — no more relying on third-party decryption services
- **Faster decryption** — WASM runs locally instead of round-tripping to an external API
- All 17 Videasy server endpoints working (Neon, Sage, Cypher, Yoru, etc.)

## TL;DR

Videasy's decryption service died. We ripped apart their player, binary-patched their WASM module, and now run the entire decryption pipeline ourselves. Streams are back up across all sources and languages.
