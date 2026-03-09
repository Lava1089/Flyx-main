#!/usr/bin/env node
/**
 * Extract and analyze the DLHD player script to understand key fetching flow
 */
const https = require('https');

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...headers,
    }, timeout: 15000 }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d, headers: r.headers }));
    }).on('error', reject);
  });
}

async function main() {
  // Fetch the player page for channel 303
  console.log('Fetching player page for channel 303...');
  const res = await fetch('https://www.ksohls.ru/premiumtv/daddyhd.php?id=303', {
    'Referer': 'https://daddylive.mp/',
  });
  
  if (res.status !== 200) { console.log('Failed:', res.status); return; }
  
  // Find the main player script (Script 14 — the one with reCAPTCHA + m3u8 + premium)
  const scripts = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(res.body)) !== null) {
    const s = m[1].trim();
    if (s.length > 5000 && s.includes('premium') && s.includes('m3u8')) {
      scripts.push(s);
    }
  }
  
  if (scripts.length === 0) { console.log('No player script found!'); return; }
  
  const script = scripts[scripts.length - 1];
  console.log(`Player script: ${script.length} chars\n`);
  
  // Extract key sections
  const sections = [
    { name: 'CHANNEL_KEY', regex: /CHANNEL_KEY\s*=\s*'([^']+)'/ },
    { name: 'KEY_SERVERS', regex: /KEY_SERVERS\s*=\s*\[([^\]]+)\]/ },
    { name: 'M3U8_SERVERS', regex: /M3U8_SERVERS\s*=\s*\[([^\]]+)\]/ },
    { name: 'VERIFY_URL', regex: /verify['"]\s*[,;]|verify_url|verifyUrl|\/verify/i },
    { name: 'KEY_URL pattern', regex: /\/key\/[^'"]+/ },
    { name: 'recaptcha action', regex: /action\s*:\s*'([^']+)'/ },
    { name: 'recaptcha sitekey', regex: /sitekey|render=([^&'"]+)/ },
  ];
  
  for (const s of sections) {
    const match = script.match(s.regex);
    console.log(`${s.name}: ${match ? match[0].substring(0, 200) : 'NOT FOUND'}`);
  }
  
  // Find the verify/whitelist flow
  console.log('\n--- VERIFY FLOW ---');
  const verifyMatches = script.match(/verify[\s\S]{0,1000}/g) || [];
  for (const vm of verifyMatches.slice(0, 3)) {
    console.log(vm.substring(0, 300));
    console.log('---');
  }
  
  // Find the key fetch flow
  console.log('\n--- KEY FETCH FLOW ---');
  const keyMatches = script.match(/\/key\/[\s\S]{0,500}/g) || [];
  for (const km of keyMatches.slice(0, 3)) {
    console.log(km.substring(0, 300));
    console.log('---');
  }
  
  // Find the M3U8 construction
  console.log('\n--- M3U8 CONSTRUCTION ---');
  const m3u8Matches = script.match(/m3u8[\s\S]{0,500}/g) || [];
  for (const mm of m3u8Matches.slice(0, 3)) {
    console.log(mm.substring(0, 300));
    console.log('---');
  }
  
  // Find all domain references
  console.log('\n--- DOMAINS IN PLAYER SCRIPT ---');
  const domains = script.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  console.log([...new Set(domains)].join('\n'));
  
  // Find the KEY_SERVERS array and M3U8 server logic
  console.log('\n--- FULL KEY SERVER SECTION ---');
  const keyServerSection = script.match(/KEY_SERVERS[\s\S]{0,3000}/);
  if (keyServerSection) console.log(keyServerSection[0].substring(0, 3000));
  
  // Find how the player initializes HLS
  console.log('\n--- HLS INIT ---');
  const hlsInit = script.match(/(?:new\s+Clappr|new\s+Hls|Clappr\.Player|hlsConfig)[\s\S]{0,1000}/);
  if (hlsInit) console.log(hlsInit[0].substring(0, 1000));
  
  // CRITICAL: Find the token/auth flow that happens BEFORE key fetch
  console.log('\n--- AUTH/TOKEN FLOW ---');
  const authFlow = script.match(/(?:token|auth|Bearer|Authorization)[\s\S]{0,500}/gi) || [];
  for (const af of authFlow.slice(0, 3)) {
    console.log(af.substring(0, 300));
    console.log('---');
  }
}

main().catch(e => console.error(e));
