#!/usr/bin/env node
const https = require('https');

const RPI = 'https://rpi-proxy.vynx.cc';
const CF = 'https://dlhd.vynx.workers.dev';
const KEY = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';
const CH = '44';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const p = new URL(url);
    https.get({ hostname: p.hostname, path: p.pathname + p.search, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ ms: Date.now() - t0, status: res.statusCode, len: Buffer.concat(chunks).length, headers: res.headers, buf: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== DLHD Latency Breakdown ===\n');

  // 1. CF Worker /play (M3U8 generation)
  console.log('[1] CF Worker /play (M3U8 generation)...');
  const play = await fetch(`${CF}/play/${CH}?key=vynx`);
  console.log(`    ${play.ms}ms — status=${play.status} len=${play.len}`);

  // Parse key URL from M3U8
  const m3u8 = play.buf.toString();
  const keyMatch = m3u8.match(/URI="([^"]+)"/);
  const segUrls = m3u8.split('\n').filter(l => l.trim().startsWith('http') && !l.includes('workers.dev'));

  // 2. CF Worker /key (key fetch — goes through RPI /dlhd-key-v6)
  if (keyMatch) {
    console.log('\n[2] CF Worker /key (→ RPI /dlhd-key-v6 → rust-fetch)...');
    const key = await fetch(keyMatch[1]);
    console.log(`    ${key.ms}ms — status=${key.status} len=${key.len} source=${key.headers['x-key-source']||'?'}`);
  }

  // 3. RPI /dlhd-key-v6 directly
  console.log('\n[3] RPI /dlhd-key-v6 directly...');
  const rpiKey = await fetch(`${RPI}/dlhd-key-v6?url=${encodeURIComponent(`https://chevy.soyspace.cyou/key/premium${CH}/1`)}&key=${KEY}`);
  console.log(`    ${rpiKey.ms}ms — status=${rpiKey.status} len=${rpiKey.len}`);

  // 4. RPI /dlhd-whitelist
  console.log('\n[4] RPI /dlhd-whitelist (should be cached/skipped)...');
  const wl = await fetch(`${RPI}/dlhd-whitelist?channel=premium${CH}&key=${KEY}`);
  console.log(`    ${wl.ms}ms — status=${wl.status} body=${wl.buf.toString().substring(0, 150)}`);

  // 5. Direct segment fetch (CDN)
  if (segUrls.length > 0) {
    console.log('\n[5] Direct segment fetch (CDN)...');
    const seg = await fetch(segUrls[0].trim());
    console.log(`    ${seg.ms}ms — status=${seg.status} len=${seg.len} type=${seg.headers['content-type']}`);
  }

  // 6. Second /play call (should be faster if anything is cached)
  console.log('\n[6] CF Worker /play again (second call)...');
  const play2 = await fetch(`${CF}/play/${CH}?key=vynx`);
  console.log(`    ${play2.ms}ms — status=${play2.status} len=${play2.len}`);

  // 7. Second /key call
  if (keyMatch) {
    console.log('\n[7] CF Worker /key again (second call)...');
    const key2 = await fetch(keyMatch[1]);
    console.log(`    ${key2.ms}ms — status=${key2.status} source=${key2.headers['x-key-source']||'?'}`);
  }

  console.log('\n=== Done ===');
}
main().catch(console.error);
