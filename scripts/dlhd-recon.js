#!/usr/bin/env node
/**
 * DLHD Recon — Fetch the player page + all JS files to find new security measures.
 * Dumps everything we need to reverse-engineer the current auth system.
 */
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHANNEL = process.argv[2] || '51';
const OUT_DIR = path.join(__dirname, '..', 'dlhd-extractor-worker', 'test-artifacts');

async function fetchText(url, referer) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': referer || 'https://dlhd.link/' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  return { status: res.status, text: await res.text(), url: res.url, headers: Object.fromEntries(res.headers) };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. Fetch codepcplay player page
  console.log(`\n=== 1. Fetching codepcplay player page for channel ${CHANNEL} ===`);
  const codepc = await fetchText(`https://epaly.fun/premiumtv/daddyhd.php?id=${CHANNEL}`);
  fs.writeFileSync(path.join(OUT_DIR, `codepcplay-ch${CHANNEL}.html`), codepc.text);
  console.log(`   Status: ${codepc.status}, Size: ${codepc.text.length}`);

  // 2. Fetch hitsplay player page
  console.log(`\n=== 2. Fetching hitsplay player page for channel ${CHANNEL} ===`);
  const hitsplay = await fetchText(`https://hitsplay.fun/premiumtv/daddyhd.php?id=${CHANNEL}`);
  fs.writeFileSync(path.join(OUT_DIR, `hitsplay-ch${CHANNEL}.html`), hitsplay.text);
  console.log(`   Status: ${hitsplay.status}, Size: ${hitsplay.text.length}`);

  // 3. Extract all script src URLs from both pages
  console.log(`\n=== 3. Extracting script URLs ===`);
  const scriptUrls = new Set();
  for (const html of [codepc.text, hitsplay.text]) {
    const matches = html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi);
    for (const m of matches) {
      let src = m[1];
      if (src.startsWith('//')) src = 'https:' + src;
      else if (src.startsWith('/')) src = 'https://epaly.fun' + src;
      scriptUrls.add(src);
    }
  }
  console.log(`   Found ${scriptUrls.size} script URLs:`);
  for (const u of scriptUrls) console.log(`     ${u}`);

  // 4. Fetch each script
  console.log(`\n=== 4. Fetching scripts ===`);
  let scriptIdx = 0;
  for (const scriptUrl of scriptUrls) {
    try {
      const s = await fetchText(scriptUrl, 'https://epaly.fun/');
      const fname = `script-${scriptIdx++}-${scriptUrl.split('/').pop().split('?')[0] || 'inline'}.js`;
      fs.writeFileSync(path.join(OUT_DIR, fname), s.text);
      console.log(`   ${fname}: ${s.status}, ${s.text.length} bytes`);
    } catch (e) {
      console.log(`   FAIL: ${scriptUrl} — ${e.message}`);
    }
  }

  // 5. Extract EPlayerAuth config
  console.log(`\n=== 5. EPlayerAuth config ===`);
  for (const [name, html] of [['codepcplay', codepc.text], ['hitsplay', hitsplay.text]]) {
    const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
    if (initMatch) {
      console.log(`   [${name}] EPlayerAuth.init found:`);
      console.log(`     ${initMatch[1].trim()}`);
    } else {
      console.log(`   [${name}] NO EPlayerAuth.init found`);
    }
  }

  // 6. Look for WASM references
  console.log(`\n=== 6. WASM references ===`);
  for (const [name, html] of [['codepcplay', codepc.text], ['hitsplay', hitsplay.text]]) {
    const wasmRefs = html.match(/['"](https?:\/\/[^'"]*\.wasm[^'"]*)['"]/g) || [];
    const wasmRefs2 = html.match(/WebAssembly/g) || [];
    const wasmRefs3 = html.match(/\.wasm/g) || [];
    console.log(`   [${name}] .wasm URLs: ${wasmRefs.length}, WebAssembly refs: ${wasmRefs2.length}, .wasm refs: ${wasmRefs3.length}`);
    for (const w of wasmRefs) console.log(`     ${w}`);
  }

  // 7. Look for new auth patterns, key fetch code, PoW code
  console.log(`\n=== 7. Auth patterns in HTML ===`);
  for (const [name, html] of [['codepcplay', codepc.text], ['hitsplay', hitsplay.text]]) {
    const patterns = [
      /X-Key-Timestamp/g, /X-Key-Nonce/g, /X-Key-Path/g, /X-Fingerprint/g,
      /X-Key-Signature/g, /X-Client-Token/g, /X-Pow-/g,
      /computeNonce|compute_nonce|pow_nonce/g,
      /heartbeat/g, /generateFingerprint/g, /channelSalt/g,
      /EPlayerAuth/g, /keyPath/g, /fetchKey/g,
      /Authorization.*Bearer/g,
    ];
    console.log(`   [${name}]:`);
    for (const p of patterns) {
      const matches = html.match(p);
      if (matches && matches.length > 0) {
        console.log(`     ${p.source}: ${matches.length} matches`);
      }
    }
  }

  // 8. Check for new domains / CDN changes
  console.log(`\n=== 8. Domain references ===`);
  for (const [name, html] of [['codepcplay', codepc.text], ['hitsplay', hitsplay.text]]) {
    const domains = new Set();
    const domainMatches = html.matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
    for (const m of domainMatches) domains.add(m[1]);
    console.log(`   [${name}] Domains found:`);
    for (const d of [...domains].sort()) console.log(`     ${d}`);
  }

  // 9. Check the WASM PoW URL for changes
  console.log(`\n=== 9. Checking WASM PoW endpoint ===`);
  try {
    const wasmRes = await fetch('https://333418.fun/pow/pow_wasm_bg.wasm', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    const wasmBuf = await wasmRes.arrayBuffer();
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(Buffer.from(wasmBuf)).digest('hex');
    console.log(`   333418.fun WASM: status=${wasmRes.status}, size=${wasmBuf.byteLength}, sha256=${hash}`);
    
    // Compare with cached WASM on RPI
    const cachedPath = path.join(__dirname, '..', 'rpi-proxy', 'pow_wasm_bg.wasm');
    if (fs.existsSync(cachedPath)) {
      const cached = fs.readFileSync(cachedPath);
      const cachedHash = crypto.createHash('sha256').update(cached).digest('hex');
      console.log(`   Cached WASM:     size=${cached.length}, sha256=${cachedHash}`);
      console.log(`   Match: ${hash === cachedHash ? '✅ SAME' : '❌ DIFFERENT — WASM HAS CHANGED!'}`);
      if (hash !== cachedHash) {
        // Save new WASM
        fs.writeFileSync(path.join(OUT_DIR, 'pow_wasm_bg_NEW.wasm'), Buffer.from(wasmBuf));
        console.log(`   Saved new WASM to test-artifacts/pow_wasm_bg_NEW.wasm`);
      }
    }
  } catch (e) {
    console.log(`   WASM fetch failed: ${e.message}`);
  }

  // 10. Extract inline JS that contains auth logic
  console.log(`\n=== 10. Inline script analysis ===`);
  for (const [name, html] of [['codepcplay', codepc.text], ['hitsplay', hitsplay.text]]) {
    const inlineScripts = html.match(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi) || [];
    let authScriptIdx = 0;
    for (const script of inlineScripts) {
      if (script.includes('src=')) continue; // Skip external scripts
      const content = script.replace(/<\/?script[^>]*>/gi, '').trim();
      if (content.length < 20) continue;
      
      const hasAuth = /EPlayerAuth|channelSalt|authToken|fetchKey|computeNonce|X-Key|heartbeat|fingerprint/i.test(content);
      if (hasAuth || content.length > 500) {
        const fname = `${name}-inline-${authScriptIdx++}.js`;
        fs.writeFileSync(path.join(OUT_DIR, fname), content);
        console.log(`   [${name}] ${fname}: ${content.length} chars ${hasAuth ? '⚡ HAS AUTH CODE' : ''}`);
        // Show first 300 chars
        console.log(`     Preview: ${content.substring(0, 300).replace(/\n/g, ' ')}...`);
      }
    }
  }

  console.log(`\n=== Done! Artifacts saved to ${OUT_DIR} ===`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
