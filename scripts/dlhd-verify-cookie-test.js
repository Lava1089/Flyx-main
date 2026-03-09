#!/usr/bin/env node
/**
 * Test if the verify endpoint returns cookies that are needed for key access.
 * Also test if passing those cookies to key requests changes the result.
 */
const https = require('https');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        ...options.headers,
      },
      timeout: 20000,
    };
    const req = https.request(opts, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve({
        status: r.statusCode,
        headers: r.headers,
        buf: Buffer.concat(chunks),
        cookies: r.headers['set-cookie'] || [],
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  console.log('=== VERIFY COOKIE TEST ===\n');

  // Step 1: Fetch key WITHOUT any verify (baseline)
  console.log('[1] Baseline key fetch (no verify):');
  const baseline = await request('https://go.ai-chatx.site/key/premium303/5909740', {
    headers: { 'Referer': 'https://adffdafdsafds.sbs/', 'Origin': 'https://adffdafdsafds.sbs' },
  });
  console.log(`    Status: ${baseline.status}, Size: ${baseline.buf.length}`);
  console.log(`    Key: ${baseline.buf.length === 16 ? baseline.buf.toString('hex') : baseline.buf.toString().substring(0, 100)}`);
  console.log(`    Set-Cookie from key server: ${JSON.stringify(baseline.cookies)}`);
  console.log(`    All response headers:`);
  for (const [k, v] of Object.entries(baseline.headers)) {
    if (k.startsWith('x-') || k === 'set-cookie' || k === 'cf-ray') {
      console.log(`      ${k}: ${JSON.stringify(v)}`);
    }
  }

  // Step 2: POST to verify endpoint and capture cookies
  console.log('\n[2] POST to verify endpoint:');
  const postData = JSON.stringify({ 'recaptcha-token': 'fake-token-for-testing', 'channel_id': 'premium303' });
  const verify = await request('https://go.ai-chatx.site/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'Origin': 'https://adffdafdsafds.sbs',
      'Referer': 'https://adffdafdsafds.sbs/',
    },
    body: postData,
  });
  console.log(`    Status: ${verify.status}`);
  console.log(`    Body: ${verify.buf.toString().substring(0, 300)}`);
  console.log(`    Set-Cookie: ${JSON.stringify(verify.cookies)}`);
  console.log(`    All response headers:`);
  for (const [k, v] of Object.entries(verify.headers)) {
    console.log(`      ${k}: ${typeof v === 'string' ? v.substring(0, 200) : JSON.stringify(v)}`);
  }

  // Step 3: If verify returned cookies, try key fetch WITH those cookies
  if (verify.cookies.length > 0) {
    console.log('\n[3] Key fetch WITH verify cookies:');
    const cookieStr = verify.cookies.map(c => c.split(';')[0]).join('; ');
    console.log(`    Cookie header: ${cookieStr}`);
    const withCookie = await request('https://go.ai-chatx.site/key/premium303/5909740', {
      headers: {
        'Referer': 'https://adffdafdsafds.sbs/',
        'Origin': 'https://adffdafdsafds.sbs',
        'Cookie': cookieStr,
      },
    });
    console.log(`    Status: ${withCookie.status}, Size: ${withCookie.buf.length}`);
    console.log(`    Key: ${withCookie.buf.length === 16 ? withCookie.buf.toString('hex') : withCookie.buf.toString().substring(0, 100)}`);
  } else {
    console.log('\n[3] No cookies from verify — skipping cookie test');
  }

  // Step 4: Check if there's a Cloudflare cookie requirement
  // Try fetching the main page first to get cf cookies
  console.log('\n[4] Fetch adffdafdsafds.sbs main page for CF cookies:');
  const mainPage = await request('https://adffdafdsafds.sbs/', {
    headers: { 'Accept': 'text/html' },
  });
  console.log(`    Status: ${mainPage.status}`);
  console.log(`    Set-Cookie: ${JSON.stringify(mainPage.cookies)}`);
  
  if (mainPage.cookies.length > 0) {
    console.log('\n[5] Key fetch with CF cookies from main page:');
    const cfCookieStr = mainPage.cookies.map(c => c.split(';')[0]).join('; ');
    console.log(`    Cookie: ${cfCookieStr.substring(0, 100)}`);
    const withCfCookie = await request('https://go.ai-chatx.site/key/premium303/5909740', {
      headers: {
        'Referer': 'https://adffdafdsafds.sbs/',
        'Origin': 'https://adffdafdsafds.sbs',
        'Cookie': cfCookieStr,
      },
    });
    console.log(`    Status: ${withCfCookie.status}, Size: ${withCfCookie.buf.length}`);
    console.log(`    Key: ${withCfCookie.buf.length === 16 ? withCfCookie.buf.toString('hex') : 'not 16 bytes'}`);
  }
}

main().catch(e => console.error(e));
