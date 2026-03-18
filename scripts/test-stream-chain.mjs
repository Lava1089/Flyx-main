// Test the full Flixer stream proxy chain
const BASE = 'https://media-proxy.vynx.workers.dev';

async function main() {
  // Step 1: Extract
  console.log('=== Step 1: Extract ===');
  const r1 = await fetch(`${BASE}/flixer/extract-all?tmdbId=550&type=movie`);
  const d1 = await r1.json();
  const src = d1.sources[0];
  console.log('Source:', src.server, src.url.substring(0, 80));

  // Step 2: Proxy the m3u8
  console.log('\n=== Step 2: Master m3u8 via /flixer/stream ===');
  const proxyUrl = `${BASE}/flixer/stream?url=${encodeURIComponent(src.url)}`;
  let t = Date.now();
  const r2 = await fetch(proxyUrl);
  const m3u8 = await r2.text();
  console.log(`Status: ${r2.status} | Via: ${r2.headers.get('x-proxied-via')} | Len: ${m3u8.length} | ${Date.now()-t}ms`);
  console.log(m3u8.substring(0, 400));

  if (!m3u8.includes('#EXTM3U')) { console.log('NOT a valid m3u8!'); return; }

  // Step 3: Fetch sub-playlist (first non-comment line)
  const urls = m3u8.split('\n').filter(l => !l.startsWith('#') && l.trim());
  if (!urls.length) { console.log('No sub-playlist URLs found'); return; }
  console.log('\n=== Step 3: Sub-playlist ===');
  console.log('URL:', urls[0].substring(0, 150));
  t = Date.now();
  const r3 = await fetch(urls[0]);
  const sub = await r3.text();
  console.log(`Status: ${r3.status} | Via: ${r3.headers.get('x-proxied-via')} | Len: ${sub.length} | ${Date.now()-t}ms`);
  console.log(sub.substring(0, 400));

  // Step 4: Check for EXT-X-KEY (encryption key)
  const keyLine = sub.split('\n').find(l => l.includes('EXT-X-KEY'));
  if (keyLine) {
    const km = keyLine.match(/URI="([^"]+)"/);
    if (km) {
      console.log('\n=== Step 4: AES Key ===');
      console.log('URL:', km[1].substring(0, 150));
      t = Date.now();
      const r4 = await fetch(km[1]);
      const kbuf = await r4.arrayBuffer();
      console.log(`Status: ${r4.status} | Via: ${r4.headers.get('x-proxied-via')} | Bytes: ${kbuf.byteLength} | ${Date.now()-t}ms`);
      if (kbuf.byteLength !== 16) console.log('WARNING: Key should be 16 bytes!');
    }
  }

  // Step 5: Fetch first segment
  const segLines = sub.split('\n');
  for (let i = 0; i < segLines.length; i++) {
    if (segLines[i].startsWith('#EXTINF') && i+1 < segLines.length && !segLines[i+1].startsWith('#')) {
      console.log('\n=== Step 5: First Segment ===');
      console.log('URL:', segLines[i+1].substring(0, 150));
      t = Date.now();
      const r5 = await fetch(segLines[i+1]);
      const sbuf = await r5.arrayBuffer();
      const bytes = new Uint8Array(sbuf);
      console.log(`Status: ${r5.status} | Via: ${r5.headers.get('x-proxied-via')} | Bytes: ${sbuf.byteLength} | ${Date.now()-t}ms`);
      console.log(`Content-Type: ${r5.headers.get('content-type')}`);
      console.log(`First byte: 0x${bytes[0]?.toString(16)} (0x47=MPEG-TS)`);
      if (sbuf.byteLength < 100) console.log('WARNING: Segment too small!');
      break;
    }
  }
}

main().catch(e => console.error('FATAL:', e.message));
