// Test: Are we IP banned from DLHD (dvalna.ru)?
// Tests from THIS machine's IP (your home network) against:
// 1. dvalna.ru key servers (players 1-5 backend)
// 2. The M3U8 playlist endpoints
// 3. The player page itself (codepcplay.fun / dlhd.link)
//
// If everything 429s or times out from home but works on phone,
// your home IP is banned.
const https = require('https');
const http = require('http');

function req(url, headers = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const start = Date.now();
    const r = mod.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout, family: 4,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        data: Buffer.concat(chunks),
        time: Date.now() - start,
        ip: res.socket?.remoteAddress,
      }));
    });
    r.on('error', (e) => reject({ message: e.message, time: Date.now() - start }));
    r.on('timeout', () => { r.destroy(); reject({ message: 'timeout', time: Date.now() - start }); });
    r.end();
  });
}

async function testEndpoint(label, url, headers = {}) {
  process.stdout.write(`  ${label}: `);
  try {
    const res = await req(url, headers);
    const body = res.data.toString('utf8').substring(0, 200);
    const isM3u8 = body.includes('#EXTM3U');
    const is429 = res.status === 429;
    const isForbid = res.status === 403;
    const icon = res.status === 200 ? '✅' : is429 ? '🚫' : isForbid ? '🔒' : '❌';
    console.log(`${icon} ${res.status} (${res.time}ms) ${isM3u8 ? '[valid M3U8]' : `[${body.substring(0, 80)}]`}`);
    return { status: res.status, ok: res.status === 200 };
  } catch (e) {
    console.log(`💀 ${e.message} (${e.time}ms)`);
    return { status: 0, ok: false, error: e.message };
  }
}

async function main() {
  console.log('=== DLHD IP Ban Test ===');
  console.log('Time:', new Date().toISOString());
  console.log('Running from: YOUR HOME NETWORK (this machine)\n');

  // 1. Test DNS resolution for dvalna.ru servers
  console.log('--- DNS Resolution ---');
  const dns = require('dns');
  for (const host of ['chevy.dvalna.ru', 'chevynew.dvalna.ru', 'zeko.dvalna.ru', 'zekonew.dvalna.ru']) {
    try {
      const addrs = await new Promise((res, rej) => dns.resolve4(host, (e, a) => e ? rej(e) : res(a)));
      console.log(`  ${host}: ${addrs.join(', ')}`);
    } catch (e) {
      console.log(`  ${host}: DNS FAILED (${e.message})`);
    }
  }

  // 2. Test player pages (dlhd.link)
  console.log('\n--- Player Pages (dlhd.link) ---');
  await testEndpoint('dlhd.link homepage', 'https://dlhd.link/', { 'Accept': 'text/html' });
  await testEndpoint('Player page ch44', 'https://dlhd.link/player/stream-44.php', { 'Referer': 'https://dlhd.link/' });

  // 3. Test codepcplay.fun (auth page)
  console.log('\n--- Auth Page (codepcplay.fun) ---');
  await testEndpoint('codepcplay.fun ch44', 'https://codepcplay.fun/premiumtv/daddyhd.php?id=premium44', {
    'Referer': 'https://dlhd.link/',
  });

  // 4. Test M3U8 playlist endpoints (dvalna.ru) - these need auth headers
  console.log('\n--- M3U8 Playlists (dvalna.ru) - no auth ---');
  const servers = ['chevy', 'zeko', 'ddy6', 'ddy10', 'ddy11'];
  for (const srv of servers) {
    await testEndpoint(
      `${srv}.dvalna.ru M3U8`,
      `https://${srv}new.dvalna.ru/${srv}/premium44/mono.css`,
      { 'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun' }
    );
  }

  // 5. Test key servers (dvalna.ru) - the ones that were 429ing
  console.log('\n--- Key Servers (dvalna.ru) - no auth ---');
  for (const srv of servers) {
    await testEndpoint(
      `${srv}.dvalna.ru key`,
      `https://${srv}new.dvalna.ru/key/premium44/1`,
      { 'Referer': 'https://codepcplay.fun/', 'Origin': 'https://codepcplay.fun' }
    );
  }

  // 6. Test kiko2.ru and giokko.ru (alternative domains)
  console.log('\n--- Alternative Domains ---');
  await testEndpoint('chevy.kiko2.ru M3U8', 'https://chevynew.kiko2.ru/chevy/premium44/mono.css', {
    'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun',
  });
  await testEndpoint('chevy.giokko.ru M3U8', 'https://chevynew.giokko.ru/chevy/premium44/mono.css', {
    'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun',
  });

  // 7. Test player 6 (lovecdn/lovetier) - should work regardless
  console.log('\n--- Player 6 (lovecdn/lovetier) - control test ---');
  await testEndpoint('lovetier.bz ESPN', 'https://lovetier.bz/player/ESPN', {
    'Referer': 'https://lovecdn.ru/',
  });

  // 8. Test moveonjoy - should work regardless
  console.log('\n--- Moveonjoy - control test ---');
  await testEndpoint('moveonjoy ABC', 'https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8');

  // 9. Get our public IP for reference
  console.log('\n--- Your Public IP ---');
  try {
    const ipRes = await req('https://api.ipify.org?format=json', {}, 5000);
    console.log(`  Public IP: ${ipRes.data.toString('utf8')}`);
  } catch (e) {
    console.log(`  Could not determine: ${e.message}`);
  }

  console.log('\n=== INTERPRETATION ===');
  console.log('If dvalna.ru returns 429/403/timeout but lovetier.bz and moveonjoy work:');
  console.log('  → Your home IP is banned/rate-limited by dvalna.ru');
  console.log('If everything works: the ban may have been temporary or DNS-level');
  console.log('If everything fails: network issue, not IP ban');
}

main().catch(console.error);
