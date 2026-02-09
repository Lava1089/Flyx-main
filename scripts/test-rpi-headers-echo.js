#!/usr/bin/env node
/**
 * Test what headers the RPI proxy actually sends upstream.
 * Uses httpbin.org/headers to echo back the received headers.
 */
const fs = require('fs');

try {
  const envFile = fs.readFileSync('.env.local', 'utf8');
  for (const line of envFile.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.substring(0, eq).trim();
    let v = t.substring(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const RPI_URL = process.env.RPI_PROXY_URL;
const API_KEY = process.env.RPI_PROXY_KEY;

async function testRoute(route) {
  const testHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Authorization': 'Bearer test_token_123',
    'X-Key-Timestamp': '1770418000',
    'X-Key-Nonce': '42',
    'X-Key-Path': 'abc123def456',
    'X-Fingerprint': '746a23a6a2bf5651',
    'Origin': 'https://epaly.fun',
    'Referer': 'https://epaly.fun/',
  };

  console.log(`\n=== Testing /${route} with httpbin.org ===`);
  console.log('Headers we WANT sent:', JSON.stringify(testHeaders, null, 2));

  const params = new URLSearchParams({
    url: 'https://httpbin.org/headers',
    headers: JSON.stringify(testHeaders),
    key: API_KEY,
  });

  try {
    const res = await fetch(`${RPI_URL}/${route}?${params}`, {
      headers: { 'X-API-Key': API_KEY },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    console.log(`\nStatus: ${res.status}`);
    console.log(`Proxied-By: ${res.headers.get('x-proxied-by')}`);
    console.log(`\nHeaders received by httpbin:`);
    try {
      const data = JSON.parse(text);
      console.log(JSON.stringify(data.headers, null, 2));
    } catch {
      console.log(text.substring(0, 500));
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

async function main() {
  // Also test what headers a DIRECT fetch sends
  console.log('=== DIRECT fetch to httpbin (no RPI) ===');
  const directHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Authorization': 'Bearer test_token_123',
    'X-Key-Timestamp': '1770418000',
    'X-Key-Nonce': '42',
    'X-Key-Path': 'abc123def456',
    'X-Fingerprint': '746a23a6a2bf5651',
    'Origin': 'https://epaly.fun',
    'Referer': 'https://epaly.fun/',
  };

  const directRes = await fetch('https://httpbin.org/headers', { headers: directHeaders });
  const directData = await directRes.json();
  console.log('Headers received by httpbin (DIRECT):');
  console.log(JSON.stringify(directData.headers, null, 2));

  // Test both RPI routes
  await testRoute('fetch');
  await testRoute('fetch-impersonate');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
