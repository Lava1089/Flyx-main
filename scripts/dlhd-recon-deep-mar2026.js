#!/usr/bin/env node
/**
 * DLHD Deep Recon - March 2026
 * 
 * Analyzes the new player page format on www.ksohls.ru
 * and the new dlstreams.top domain
 */

const https = require('https');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: { 'User-Agent': UA, ...(options.headers || {}) },
      timeout: options.timeout || 15000,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http') 
          ? res.headers.location 
          : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
        console.log(`  → Redirect: ${redirectUrl}`);
        return fetch(redirectUrl, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function analyzePlayerPage() {
  console.log('='.repeat(80));
  console.log('DEEP ANALYSIS: www.ksohls.ru player page');
  console.log('='.repeat(80));
  
  const url = 'https://www.ksohls.ru/premiumtv/daddyhd.php?id=44';
  const res = await fetch(url, {
    headers: { 'Referer': 'https://daddylive.mp/' },
  });
  
  console.log(`Status: ${res.status}`);
  console.log(`Body length: ${res.body.length}`);
  
  const html = res.body;
  
  // 1. Analyze the obfuscated window variable
  const windowVarMatch = html.match(/window\['([^']+)'\]\s*=\s*'([^']+)'/);
  if (windowVarMatch) {
    console.log(`\n--- Obfuscated Window Variable ---`);
    console.log(`Variable name: window['${windowVarMatch[1]}']`);
    console.log(`Value length: ${windowVarMatch[2].length} chars`);
    console.log(`Value (first 100): ${windowVarMatch[2].substring(0, 100)}`);
    
    // Try base64 decode
    try {
      const decoded = Buffer.from(windowVarMatch[2], 'base64').toString('utf-8');
      console.log(`Base64 decoded (first 200): ${decoded.substring(0, 200)}`);
    } catch (e) {
      console.log(`Not standard base64`);
    }
    
    // Check if it's a custom encoding
    const val = windowVarMatch[2];
    const charSet = new Set(val.split(''));
    console.log(`Unique chars: ${charSet.size}`);
    console.log(`Chars: ${[...charSet].sort().join('')}`);
  }
  
  // 2. Find all script sources
  console.log(`\n--- External Scripts ---`);
  const srcMatches = html.match(/<script[^>]+src="([^"]+)"/gi) || [];
  for (const m of srcMatches) {
    const srcMatch = m.match(/src="([^"]+)"/);
    if (srcMatch) console.log(`  ${srcMatch[1]}`);
  }
  
  // 3. Find all inline scripts and analyze them
  console.log(`\n--- Inline Scripts Analysis ---`);
  const scripts = [];
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRegex.exec(html)) !== null) {
    if (sm[1].trim().length > 0) {
      scripts.push(sm[1].trim());
    }
  }
  
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    console.log(`\n  Script ${i} (${s.length} chars):`);
    
    // Check for interesting patterns
    const patterns = [
      { name: 'EPlayerAuth', regex: /EPlayerAuth/ },
      { name: 'authToken', regex: /authToken/ },
      { name: 'channelSalt', regex: /channelSalt/ },
      { name: 'channelKey', regex: /channelKey/ },
      { name: 'reCAPTCHA', regex: /recaptcha|grecaptcha/i },
      { name: 'turnstile', regex: /turnstile/i },
      { name: 'window[', regex: /window\[/ },
      { name: 'atob', regex: /atob/ },
      { name: 'btoa', regex: /btoa/ },
      { name: 'eval', regex: /\beval\b/ },
      { name: 'Function(', regex: /Function\s*\(/ },
      { name: 'fromCharCode', regex: /fromCharCode/ },
      { name: 'XOR (^)', regex: /\^\s*\d/ },
      { name: 'crypto', regex: /crypto/ },
      { name: 'fetch(', regex: /fetch\s*\(/ },
      { name: 'XMLHttpRequest', regex: /XMLHttpRequest/ },
      { name: 'iframe', regex: /iframe/i },
      { name: 'hls', regex: /hls/i },
      { name: 'm3u8', regex: /m3u8/i },
      { name: 'premium', regex: /premium\d+/ },
      { name: 'daddyhd', regex: /daddyhd/ },
      { name: 'key/', regex: /key\// },
      { name: 'Bearer', regex: /Bearer/ },
      { name: 'Authorization', regex: /Authorization/ },
      { name: 'X-Key', regex: /X-Key/ },
    ];
    
    const found = patterns.filter(p => p.regex.test(s));
    if (found.length > 0) {
      console.log(`    Patterns: ${found.map(f => f.name).join(', ')}`);
    }
    
    // Show first 300 chars
    console.log(`    Content: ${s.substring(0, 300)}${s.length > 300 ? '...' : ''}`);
  }
  
  // 4. Look for iframes
  console.log(`\n--- Iframes ---`);
  const iframes = html.match(/<iframe[^>]*>/gi) || [];
  for (const iframe of iframes) {
    console.log(`  ${iframe}`);
  }
  
  // 5. Look for reCAPTCHA details
  console.log(`\n--- reCAPTCHA Analysis ---`);
  const recaptchaKey = html.match(/sitekey['":\s]+['"]([^'"]+)['"]/i);
  if (recaptchaKey) console.log(`  Site key: ${recaptchaKey[1]}`);
  
  const recaptchaScript = html.match(/recaptcha\/api\.js[^"']*/i);
  if (recaptchaScript) console.log(`  Script: ${recaptchaScript[0]}`);
  
  // 6. Check for new domain references
  console.log(`\n--- Domain References ---`);
  const domains = html.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const uniqueDomains = [...new Set(domains.map(d => { try { return new URL(d).hostname; } catch { return d; } }))];
  for (const d of uniqueDomains) {
    console.log(`  ${d}`);
  }
}

async function analyzeNewDomain() {
  console.log('\n' + '='.repeat(80));
  console.log('DEEP ANALYSIS: dlstreams.top (new DLHD domain)');
  console.log('='.repeat(80));
  
  // Test the new domain
  try {
    const res = await fetch('https://dlstreams.top/', { timeout: 10000 });
    console.log(`Status: ${res.status}`);
    console.log(`Body length: ${res.body.length}`);
    
    // Check for stream/watch pages
    const links = res.body.match(/href="([^"]*(?:watch|stream|channel)[^"]*)"/gi) || [];
    console.log(`Stream-related links: ${links.length}`);
    for (const l of links.slice(0, 10)) {
      console.log(`  ${l}`);
    }
    
    // Check for player domain references
    const playerDomains = res.body.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    const unique = [...new Set(playerDomains.map(d => { try { return new URL(d).hostname; } catch { return d; } }))];
    console.log(`\nReferenced domains:`);
    for (const d of unique) {
      console.log(`  ${d}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
  
  // Try watch page on new domain
  console.log(`\n--- Watch Page ---`);
  try {
    const res = await fetch('https://dlstreams.top/watch.php?id=44', { timeout: 10000 });
    console.log(`Status: ${res.status}`);
    
    if (res.status === 200) {
      // Look for iframe to stream page
      const iframes = res.body.match(/<iframe[^>]*src="([^"]+)"/gi) || [];
      console.log(`Iframes: ${iframes.length}`);
      for (const iframe of iframes) {
        const src = iframe.match(/src="([^"]+)"/);
        if (src) console.log(`  ${src[1]}`);
      }
      
      // Look for stream page references
      const streamRefs = res.body.match(/stream[^"']*\.php[^"']*/gi) || [];
      console.log(`Stream refs: ${streamRefs.length}`);
      for (const ref of streamRefs) {
        console.log(`  ${ref}`);
      }
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
  
  // Try stream page on new domain
  console.log(`\n--- Stream Page ---`);
  try {
    const res = await fetch('https://dlstreams.top/stream/stream-44.php', {
      headers: { 'Referer': 'https://dlstreams.top/' },
      timeout: 10000,
    });
    console.log(`Status: ${res.status}`);
    
    if (res.status === 200) {
      const iframes = res.body.match(/<iframe[^>]*src="([^"]+)"/gi) || [];
      console.log(`Iframes: ${iframes.length}`);
      for (const iframe of iframes) {
        const src = iframe.match(/src="([^"]+)"/);
        if (src) console.log(`  ${src[1]}`);
      }
      
      // Look for player domain
      const domains = res.body.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
      const unique = [...new Set(domains.map(d => { try { return new URL(d).hostname; } catch { return d; } }))];
      console.log(`Domains:`);
      for (const d of unique) console.log(`  ${d}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

async function testKeyFetchDirect() {
  console.log('\n' + '='.repeat(80));
  console.log('KEY FETCH TEST (direct, no auth)');
  console.log('='.repeat(80));
  
  // The M3U8 has key URI: /key/premium44/5909692
  // Try fetching from go.ai-chatx.site and chevy.soyspace.cyou
  const keyUrls = [
    'https://go.ai-chatx.site/key/premium44/5909692',
    'https://chevy.soyspace.cyou/key/premium44/5909692',
  ];
  
  for (const keyUrl of keyUrls) {
    console.log(`\n  Testing: ${keyUrl}`);
    try {
      // First try without auth
      const res = await fetch(keyUrl, {
        headers: {
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
        },
        timeout: 5000,
      });
      console.log(`    Status: ${res.status}`);
      console.log(`    CORS: ${res.headers['access-control-allow-origin'] || 'not set'}`);
      console.log(`    Content-Type: ${res.headers['content-type'] || 'not set'}`);
      console.log(`    Body length: ${res.body.length}`);
      
      if (res.body.length === 16) {
        const hex = Buffer.from(res.body, 'binary').toString('hex');
        console.log(`    Key hex: ${hex}`);
        const isFake = hex.startsWith('455806f8') || hex.startsWith('45c6497') || hex === '00000000000000000000000000000000';
        console.log(`    Fake key: ${isFake ? '⚠️ YES' : '✅ NO'}`);
      } else if (res.body.length < 200) {
        console.log(`    Body: ${res.body}`);
      }
    } catch (e) {
      console.log(`    Error: ${e.message}`);
    }
  }
}

async function main() {
  await analyzePlayerPage();
  await analyzeNewDomain();
  await testKeyFetchDirect();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
