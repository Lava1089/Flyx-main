#!/usr/bin/env node
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
  const res = await fetch('https://www.ksohls.ru/premiumtv/daddyhd.php?id=303', {
    'Referer': 'https://daddylive.mp/',
  });
  
  const scripts = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(res.body)) !== null) {
    const s = m[1].trim();
    if (s.length > 5000 && s.includes('premium') && s.includes('m3u8')) {
      scripts.push(s);
    }
  }
  
  const script = scripts[scripts.length - 1];
  
  // Find the server lookup section
  console.log('=== SERVER LOOKUP (sk) ===');
  const skSection = script.match(/(?:serverKey|server_key|sk\s*=|getServer|lookupServer|fetchServer)[\s\S]{0,2000}/gi) || [];
  for (const s of skSection.slice(0, 3)) {
    console.log(s.substring(0, 500));
    console.log('---');
  }
  
  // Find what happens after verify succeeds
  console.log('\n=== POST-VERIFY FLOW ===');
  const postVerify = script.match(/data\.success[\s\S]{0,3000}/);
  if (postVerify) console.log(postVerify[0].substring(0, 3000));
  
  // Find the full initPlayer or startStream function
  console.log('\n=== INIT PLAYER / START STREAM ===');
  const initPlayer = script.match(/(?:initPlayer|startStream|loadStream|playStream)\s*\([\s\S]{0,3000}/);
  if (initPlayer) console.log(initPlayer[0].substring(0, 3000));
  
  // Find the server lookup fetch
  console.log('\n=== SERVER LOOKUP FETCH ===');
  const serverFetch = script.match(/(?:lookup|server)[\s\S]{0,200}fetch[\s\S]{0,1000}/gi) || [];
  for (const sf of serverFetch.slice(0, 3)) {
    console.log(sf.substring(0, 500));
    console.log('---');
  }
  
  // Find the M3U8 URL construction in full context
  console.log('\n=== M3U8 URL FULL CONTEXT ===');
  const m3u8Context = script.match(/mono\.css[\s\S]{0,500}/);
  if (m3u8Context) console.log(m3u8Context[0].substring(0, 500));
  
  // Also look backwards from mono.css
  const idx = script.indexOf('mono.css');
  if (idx > 0) {
    console.log('\n=== 2000 chars BEFORE mono.css ===');
    console.log(script.substring(Math.max(0, idx - 2000), idx + 200));
  }
}

main().catch(e => console.error(e));
