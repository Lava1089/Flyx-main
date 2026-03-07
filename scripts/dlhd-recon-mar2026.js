#!/usr/bin/env node
/**
 * DLHD Full Recon - March 2026
 * 
 * Probes all DLHD endpoints to identify what changed and what's broken.
 * Tests: player page auth, server lookup, M3U8 fetch, key fetch, fallback backends
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Test channels
const TEST_CHANNELS = ['44', '51', '35'];

// Known domains
const PLAYER_DOMAINS = [
  'www.ksohls.ru',       // Current primary (Feb 25, 2026)
  'lefttoplay.xyz',      // Previous
  'epaly.fun',           // Previous
  'codepcplay.fun',      // Previous
  'hitsplay.fun',        // Previous
];

const LOOKUP_DOMAINS = ['vovlacosa.sbs', 'soyspace.cyou'];
const M3U8_DOMAIN = 'soyspace.cyou';
const KEY_DOMAIN = 'go.ai-chatx.site';
const SERVERS = ['ddy6', 'zeko', 'wind', 'dokko1', 'nfs', 'wiki'];

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': UA,
        ...(options.headers || {}),
      },
      timeout: options.timeout || 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function testPlayerDomain(domain, channel) {
  const url = `https://${domain}/premiumtv/daddyhd.php?id=${channel}`;
  console.log(`\n  [Player] Testing ${domain} for ch${channel}...`);
  try {
    const res = await fetch(url, {
      headers: { 'Referer': 'https://daddylive.mp/' },
      timeout: 8000,
    });
    console.log(`    Status: ${res.status}`);
    
    if (res.status !== 200) {
      console.log(`    ❌ Non-200 response`);
      return null;
    }
    
    const html = res.body;
    console.log(`    Body length: ${html.length} chars`);
    
    // Check for EPlayerAuth.init
    const hasEPlayerAuth = html.includes('EPlayerAuth.init');
    console.log(`    EPlayerAuth.init: ${hasEPlayerAuth ? '✅ Found' : '❌ Not found'}`);
    
    // Check for XOR-encrypted pattern
    const hasDecFunc = /_dec_\w+/.test(html);
    const hasInitArrays = /_init_\w+/.test(html);
    console.log(`    XOR decoder function: ${hasDecFunc ? '✅ Found' : '❌ Not found'}`);
    console.log(`    XOR byte arrays: ${hasInitArrays ? '✅ Found' : '❌ Not found'}`);
    
    // Check for plain-text auth
    const hasPlainAuth = /authToken\s*:\s*["']/.test(html);
    console.log(`    Plain authToken: ${hasPlainAuth ? '✅ Found' : '❌ Not found'}`);
    
    // Check for channelSalt
    const hasSalt = /channelSalt/.test(html);
    console.log(`    channelSalt field: ${hasSalt ? '✅ Found' : '❌ Not found'}`);
    
    // Try to extract auth data
    if (hasEPlayerAuth) {
      // Try XOR extraction
      if (hasDecFunc && hasInitArrays) {
        const decoderMatch = html.match(/(?:const|var|let)\s+(_dec_\w+)\s*=\s*\(?d\s*,\s*k\)?\s*=>/);
        if (decoderMatch) console.log(`    Decoder func name: ${decoderMatch[1]}`);
        
        // Count byte arrays
        const arrayCount = (html.match(/_init_\w+\s*=\s*\[/g) || []).length;
        console.log(`    Byte array count: ${arrayCount}`);
        
        // Extract and decrypt
        const byteArrays = {};
        const arrayRegex = /(?:const|var|let)\s+(_init_\w+)\s*=\s*\[([0-9,\s]+)\]/g;
        let m;
        while ((m = arrayRegex.exec(html)) !== null) {
          byteArrays[m[1]] = m[2].split(',').map(s => parseInt(s.trim(), 10));
        }
        
        const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([\s\S]*?)\}\s*\)/);
        if (initMatch) {
          const initBlock = initMatch[1];
          const fieldRegex = /(\w+)\s*:\s*_dec_\w+\s*\(\s*(_init_\w+)\s*,\s*(\d+)\s*\)/g;
          let fm;
          const decrypted = {};
          while ((fm = fieldRegex.exec(initBlock)) !== null) {
            const bytes = byteArrays[fm[2]];
            const xorKey = parseInt(fm[3], 10);
            if (bytes) {
              decrypted[fm[1]] = bytes.map(b => String.fromCharCode(b ^ xorKey)).join('');
            }
          }
          
          // Also get plain fields
          const plainRegex = /(\w+)\s*:\s*["']([^"']+)["']/g;
          let pm;
          while ((pm = plainRegex.exec(initBlock)) !== null) {
            if (!decrypted[pm[1]]) decrypted[pm[1]] = pm[2];
          }
          const numRegex = /(\w+)\s*:\s*(\d{8,})/g;
          let nm;
          while ((nm = numRegex.exec(initBlock)) !== null) {
            if (!decrypted[nm[1]]) decrypted[nm[1]] = nm[2];
          }
          
          console.log(`    Decrypted fields: ${Object.keys(decrypted).join(', ')}`);
          for (const [k, v] of Object.entries(decrypted)) {
            const val = String(v);
            console.log(`      ${k}: ${val.length > 50 ? val.substring(0, 50) + '...' : val}`);
          }
          
          return decrypted;
        }
      }
      
      // Check for NEW patterns we haven't seen before
      const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([\s\S]*?)\}\s*\)/);
      if (initMatch) {
        console.log(`    Init block (first 500 chars):`);
        console.log(`      ${initMatch[1].substring(0, 500)}`);
      }
    }
    
    // Check for any NEW auth patterns
    if (!hasEPlayerAuth) {
      // Look for other auth patterns
      const patterns = [
        { name: 'DaddyAuth', regex: /DaddyAuth/ },
        { name: 'StreamAuth', regex: /StreamAuth/ },
        { name: 'PlayerAuth', regex: /PlayerAuth/ },
        { name: 'authToken', regex: /authToken/ },
        { name: 'channelSalt', regex: /channelSalt/ },
        { name: 'Bearer', regex: /Bearer/ },
        { name: 'JWT', regex: /jwt|JWT/ },
        { name: 'init(', regex: /\.init\s*\(/ },
        { name: 'reCAPTCHA', regex: /recaptcha|grecaptcha/i },
        { name: 'turnstile', regex: /turnstile/i },
        { name: 'challenge', regex: /challenge/i },
      ];
      
      console.log(`    Searching for alternative auth patterns...`);
      for (const p of patterns) {
        if (p.regex.test(html)) {
          console.log(`      ✅ Found: ${p.name}`);
        }
      }
      
      // Show script tags
      const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
      console.log(`    Script tags found: ${scripts.length}`);
      for (let i = 0; i < Math.min(scripts.length, 5); i++) {
        const s = scripts[i].substring(0, 200);
        console.log(`      Script ${i}: ${s}...`);
      }
    }
    
    return null;
  } catch (e) {
    console.log(`    ❌ Error: ${e.message}`);
    return null;
  }
}

async function testServerLookup(channel) {
  console.log(`\n  [ServerLookup] Testing for ch${channel}...`);
  for (const domain of LOOKUP_DOMAINS) {
    const url = `https://chevy.${domain}/server_lookup?channel_id=premium${channel}`;
    try {
      const res = await fetch(url, {
        headers: {
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
        },
        timeout: 5000,
      });
      console.log(`    ${domain}: status=${res.status}`);
      if (res.status === 200) {
        try {
          const data = JSON.parse(res.body);
          console.log(`    Response: ${JSON.stringify(data)}`);
          return data.server_key || null;
        } catch {
          console.log(`    Body (not JSON): ${res.body.substring(0, 200)}`);
        }
      } else {
        console.log(`    Body: ${res.body.substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`    ${domain}: ❌ ${e.message}`);
    }
  }
  return null;
}

async function testM3U8Fetch(channel, server) {
  console.log(`\n  [M3U8] Testing ch${channel} on ${server}.${M3U8_DOMAIN}...`);
  const url = `https://chevy.${M3U8_DOMAIN}/proxy/${server}/premium${channel}/mono.css`;
  try {
    const res = await fetch(url, {
      headers: {
        'Referer': 'https://www.ksohls.ru/',
        'Origin': 'https://www.ksohls.ru',
      },
      timeout: 8000,
    });
    console.log(`    Status: ${res.status}`);
    const isM3U8 = res.body.includes('#EXTM3U') || res.body.includes('#EXT-X-');
    console.log(`    Valid M3U8: ${isM3U8 ? '✅' : '❌'}`);
    
    if (isM3U8) {
      // Extract key URL
      const keyMatch = res.body.match(/URI="([^"]+)"/);
      if (keyMatch) {
        console.log(`    Key URI: ${keyMatch[1]}`);
      }
      // Count segments
      const segments = (res.body.match(/\.ts/g) || []).length;
      console.log(`    Segments: ${segments}`);
      // Show first few lines
      const lines = res.body.split('\n').slice(0, 10);
      console.log(`    First 10 lines:`);
      for (const l of lines) console.log(`      ${l}`);
      
      return { valid: true, keyUri: keyMatch ? keyMatch[1] : null, content: res.body };
    } else {
      console.log(`    Body: ${res.body.substring(0, 300)}`);
      return { valid: false };
    }
  } catch (e) {
    console.log(`    ❌ Error: ${e.message}`);
    return { valid: false };
  }
}

async function testKeyDomain() {
  console.log(`\n  [KeyDomain] Testing ${KEY_DOMAIN}...`);
  // Just test if the domain is reachable
  try {
    const res = await fetch(`https://${KEY_DOMAIN}/`, { timeout: 5000 });
    console.log(`    Status: ${res.status}`);
    console.log(`    Body: ${res.body.substring(0, 200)}`);
    
    // Check CORS headers
    const cors = res.headers['access-control-allow-origin'];
    console.log(`    CORS: ${cors || 'not set'}`);
  } catch (e) {
    console.log(`    ❌ Error: ${e.message}`);
  }
}

async function testPlayer6(channel) {
  const streams = {
    '35': 'SkySportsFootballUK',
    '44': 'ESPN',
    '51': null, // Not in player6
  };
  const streamName = streams[channel];
  if (!streamName) {
    console.log(`\n  [Player6] ch${channel} not mapped, skipping`);
    return;
  }
  
  console.log(`\n  [Player6] Testing ch${channel} (${streamName})...`);
  try {
    const res = await fetch(`https://lovetier.bz/player/${streamName}`, {
      headers: { 'Referer': 'https://lovecdn.ru/' },
      timeout: 8000,
    });
    console.log(`    Status: ${res.status}`);
    
    if (res.status === 200) {
      const match = res.body.match(/streamUrl:\s*"([^"]+)"/);
      if (match) {
        const masterUrl = match[1].replace(/\\\//g, '/');
        console.log(`    ✅ Master URL: ${masterUrl}`);
        
        // Try fetching master
        const masterRes = await fetch(masterUrl, {
          headers: { 'Referer': 'https://lovetier.bz/' },
          timeout: 5000,
        });
        console.log(`    Master status: ${masterRes.status}`);
        if (masterRes.body.includes('#EXTM3U')) {
          console.log(`    ✅ Valid master playlist`);
        }
      } else {
        console.log(`    ❌ No streamUrl found`);
        // Look for other patterns
        const configMatch = res.body.match(/config\s*[:=]\s*\{[\s\S]*?\}/);
        if (configMatch) console.log(`    Config: ${configMatch[0].substring(0, 200)}`);
      }
    }
  } catch (e) {
    console.log(`    ❌ Error: ${e.message}`);
  }
}

async function testMoveonjoy(channel) {
  const urls = {
    '44': 'https://fl2.moveonjoy.com/ESPN/index.m3u8',
    '51': 'https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8',
    '35': null,
  };
  const url = urls[channel];
  if (!url) {
    console.log(`\n  [Moveonjoy] ch${channel} not mapped, skipping`);
    return;
  }
  
  console.log(`\n  [Moveonjoy] Testing ch${channel}...`);
  try {
    const res = await fetch(url, { timeout: 8000 });
    console.log(`    Status: ${res.status}`);
    if (res.body.includes('#EXTM3U')) {
      console.log(`    ✅ Valid master playlist`);
      const mediaPath = res.body.split('\n').find(l => l.trim() && !l.startsWith('#'));
      if (mediaPath) console.log(`    Media path: ${mediaPath.trim()}`);
    } else {
      console.log(`    ❌ Not a valid M3U8`);
      console.log(`    Body: ${res.body.substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`    ❌ Error: ${e.message}`);
  }
}

async function testDLHDMainSite() {
  console.log(`\n  [DLHD Main] Testing dlhd.link...`);
  try {
    const res = await fetch('https://dlhd.link/', { timeout: 8000 });
    console.log(`    Status: ${res.status}`);
    console.log(`    Body length: ${res.body.length}`);
    
    // Check if it redirects or has changed domain
    if (res.headers.location) {
      console.log(`    Redirect: ${res.headers.location}`);
    }
    
    // Check for new domain references
    const domainMatches = res.body.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    const uniqueDomains = [...new Set(domainMatches.map(d => new URL(d).hostname))];
    console.log(`    Referenced domains: ${uniqueDomains.slice(0, 20).join(', ')}`);
  } catch (e) {
    console.log(`    ❌ Error: ${e.message}`);
  }
  
  // Also test daddylive.mp
  console.log(`\n  [DLHD Main] Testing daddylive.mp...`);
  try {
    const res = await fetch('https://daddylive.mp/', { timeout: 8000 });
    console.log(`    Status: ${res.status}`);
    if (res.headers.location) {
      console.log(`    Redirect: ${res.headers.location}`);
    }
  } catch (e) {
    console.log(`    ❌ Error: ${e.message}`);
  }
}


// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('DLHD FULL RECON - March 2026');
  console.log('='.repeat(80));
  
  // 1. Test main DLHD site
  console.log('\n' + '='.repeat(60));
  console.log('1. DLHD MAIN SITE');
  console.log('='.repeat(60));
  await testDLHDMainSite();
  
  // 2. Test player domains
  console.log('\n' + '='.repeat(60));
  console.log('2. PLAYER PAGE AUTH DOMAINS');
  console.log('='.repeat(60));
  const authResults = {};
  for (const channel of TEST_CHANNELS) {
    console.log(`\n--- Channel ${channel} ---`);
    for (const domain of PLAYER_DOMAINS) {
      const result = await testPlayerDomain(domain, channel);
      if (result) {
        authResults[channel] = { domain, data: result };
        break; // Found working domain, skip rest
      }
    }
    if (!authResults[channel]) {
      console.log(`  ⚠️ No working player domain found for ch${channel}`);
    }
  }
  
  // 3. Test server lookup API
  console.log('\n' + '='.repeat(60));
  console.log('3. SERVER LOOKUP API');
  console.log('='.repeat(60));
  const serverResults = {};
  for (const channel of TEST_CHANNELS) {
    const server = await testServerLookup(channel);
    serverResults[channel] = server;
  }
  
  // 4. Test M3U8 fetch (primary backend)
  console.log('\n' + '='.repeat(60));
  console.log('4. M3U8 FETCH (dvalna/soyspace)');
  console.log('='.repeat(60));
  for (const channel of TEST_CHANNELS) {
    const server = serverResults[channel] || 'zeko';
    const result = await testM3U8Fetch(channel, server);
    
    // If primary fails, try all servers
    if (!result.valid) {
      console.log(`  Trying all servers for ch${channel}...`);
      for (const s of SERVERS) {
        if (s === server) continue;
        const fallback = await testM3U8Fetch(channel, s);
        if (fallback.valid) break;
      }
    }
  }
  
  // 5. Test key domain
  console.log('\n' + '='.repeat(60));
  console.log('5. KEY DOMAIN');
  console.log('='.repeat(60));
  await testKeyDomain();
  
  // 6. Test Player 6 (lovecdn) fallback
  console.log('\n' + '='.repeat(60));
  console.log('6. PLAYER 6 (LOVECDN) FALLBACK');
  console.log('='.repeat(60));
  for (const channel of TEST_CHANNELS) {
    await testPlayer6(channel);
  }
  
  // 7. Test Moveonjoy fallback
  console.log('\n' + '='.repeat(60));
  console.log('7. MOVEONJOY FALLBACK');
  console.log('='.repeat(60));
  for (const channel of TEST_CHANNELS) {
    await testMoveonjoy(channel);
  }
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  
  for (const channel of TEST_CHANNELS) {
    const auth = authResults[channel];
    const server = serverResults[channel];
    console.log(`\nChannel ${channel}:`);
    console.log(`  Auth: ${auth ? `✅ ${auth.domain}` : '❌ No working domain'}`);
    console.log(`  Server: ${server || '❌ Lookup failed'}`);
    if (auth?.data) {
      console.log(`  Auth fields: ${Object.keys(auth.data).join(', ')}`);
      if (auth.data.channelSalt) {
        console.log(`  Salt: ${String(auth.data.channelSalt).substring(0, 16)}...`);
      }
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
