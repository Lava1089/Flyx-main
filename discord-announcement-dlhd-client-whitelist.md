# ⚡ Live TV Update — We Won (Again)

@everyone — channel switching went from 6-8 seconds to ~1. Let me set the scene.

## The Fortress DLHD Built

DLHD has been on a personal vendetta against people like us. Here's what they've stacked up to stop third-party playback:

🔐 **Google reCAPTCHA v3** — not once on login. On *every single channel switch.* Want ESPN? Prove you're human. Want Fox Sports 30 seconds later? Prove it again. Google is their full-time bouncer and he does NOT remember your face.

📋 **Per-IP, per-channel whitelist** — your IP gets approved for one channel at a time, max 13 per 30-minute rolling window. Channel 14? Come back later. They built a velvet rope system for pirated sports streams. Respect, honestly.

🕵️ **TLS fingerprint checking** — if your request doesn't look like it came from real Chrome, you get a fake 16-byte key. It *looks* valid. It decrypts into digital confetti. We spent an embarrassing amount of time debugging "why is the stream just green squares" before we figured that one out.

🎭 **Rotating player domains** — they've moved three times since January. `epaly.fun` → `lefttoplay.xyz` → `www.ksohls.ru`. Every time they move, every hardcoded URL in our codebase catches fire simultaneously.

🧅 **Obfuscated JS** — the player code randomizes itself on every page load. Variable names, function order, string encoding — all shuffled. Reading it is like doing a crossword puzzle in a language that changes every time you blink.

🧂 **Poison keys** — we've catalogued at least three different fake keys they serve to unauthorized requests. They all pass format validation. They all produce garbage. One of them (`455806f8bc...`) haunts my dreams.

That's reCAPTCHA, IP whitelisting, TLS fingerprinting, domain rotation, code obfuscation, AND booby-trapped decoy keys. For a sports stream. These people are building Fort Knox around a livestream of guys kicking a ball.

## What We Did About It

Before today, every key request had to travel through five servers, cross the Atlantic Ocean twice, and pass through a Raspberry Pi sitting on in an apartment on Wi-Fi. For **16 bytes.** That key saw more of the world than I have. It had a longer commute than most people in London.

We found a shorter path. Keys now arrive in about a second.

How? No. I will not be elaborating. Certain people read these announcements and I refuse to write their patch notes for free. Fix your own stuff. 👀

## The Pi's Retirement

The Raspberry Pi has been honorably discharged from CAPTCHA-solving duty after days of continuous service. Since February it has been sitting in a dark corner of my apartment, on Wi-Fi, solving Google CAPTCHAs around the clock like a little silicon prisoner of war who never once complained. It didn't ask for overtime. It didn't unionize. It just solved. Absolute soldier.

It's free now. It can finally know peace. 🫡

## What You Need To Know

- ⚡ Channels load 3-6x faster
- 🛡️ Zero Google scripts in your browser — same as before
- 🚫 Zero tracking, zero ads, zero third-party anything
- 🔄 If the fast path ever breaks, auto-fallback to the old method — you won't even notice

**Ctrl+Shift+R** and go watch something. You'll feel the difference immediately.

*— flyx.tv* 🫡
