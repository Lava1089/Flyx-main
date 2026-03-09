# 🔓 DLHD Streams Are Back — The reCAPTCHA Saga

Hey @everyone — DLHD live TV is fully working again. Here's what happened and why it took a minute.

## What Broke

DLHD decided to nuke their entire auth system overnight. The old flow — EPlayerAuth, WASM proof-of-work, HMAC-signed headers — all gone. Replaced with something arguably worse (for them) and definitely more annoying (for us):

**reCAPTCHA v3.**

That's right. They put a Google reCAPTCHA checkpoint in front of every single decryption key. No captcha solve, no key. No key, no stream. Every channel returns a fake 16-byte AES key that looks real but decrypts into garbage. Diabolical.

## What We Did About It

We taught a Rust binary to sweet-talk Google into thinking it's a real browser. No Puppeteer. No headless Chrome. Just raw HTTP requests with the audacity of a Chrome session.

Here's the chain of nonsense we built:

1. � **HRust-based reCAPTCHA v3 solver** — Our `rust-fetch` binary spoofs Chrome's TLS fingerprint and executes Google's reCAPTCHA v3 flow over pure HTTP. No browser, no DOM, no JavaScript engine. Just a Rust program on a Raspberry Pi politely asking Google for a token and getting one. It scores high enough to whitelist our IP. Google is none the wiser.

2. 🎫 **Per-channel IP whitelisting** — Plot twist: the whitelist isn't just per-IP, it's per-IP *per-channel*. We discovered this after an hour of "why does channel 44 work but 303 doesn't." Each channel needs its own reCAPTCHA solve. So now the Pi solves captchas on demand, per channel, like a little captcha-solving employee.

3. 🔑 **Chrome TLS key fetching** — The key servers also check your TLS fingerprint on key requests. Node.js gets rejected. So `rust-fetch` handles that too — mimics Chrome's TLS handshake to grab the real AES-128 keys from residential IP. Because apparently writing a TLS impersonator in Rust is a normal thing to do on a Monday.

4. ⚡ **Parallel M3U8 racing** — We used to try servers one by one. Now we fire all candidates simultaneously and take the first valid response. `/play` went from **4.6 seconds** to **687ms**. 6.4x faster. The streams load before you finish clicking.

5. 🧠 **Auto-whitelist retry** — If a key comes back fake (we maintain a blacklist of known poison keys), the system automatically triggers a fresh reCAPTCHA solve for that channel and retries. No manual intervention needed.

## The Architecture (It's Unhinged)

```
Browser → CF Worker → races M3U8 from multiple servers
                    → rewrites key URLs to point to our /key endpoint
                    → /key calls Raspberry Pi
                    → Pi checks if channel is whitelisted
                    → if not: rust-fetch solves reCAPTCHA v3 over HTTP
                    → POSTs token to verify endpoint with channel_id
                    → fetches real AES key via Rust with Chrome TLS fingerprint
                    → returns 16 bytes of victory
```

A Cloudflare Worker, a Raspberry Pi, a Rust binary pretending to be Chrome, and Google reCAPTCHA walk into a bar. The bartender asks "what'll it be?" and they say "one AES-128 decryption key please, for channel 303, and make it real this time."

## TL;DR

- 📺 All DLHD channels working again
- ⚡ Streams load 3-6x faster than before
- 🔑 Keys are fetched server-side — your browser never touches the sketchy stuff
- � A rRust binary on a Raspberry Pi is solving Google CAPTCHAs over raw HTTP 24/7
- 🧂 Three different "poison keys" identified and blacklisted
- 🚫 Zero browsers were harmed in the making of this bypass

Go watch some live TV. The Pi is working hard so you don't have to.

*— flyx.tv dev team*
