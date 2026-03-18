// Test if Flixer CDN URLs work with direct fetch from this machine
const BASE = 'https://media-proxy.vynx.workers.dev';

async function main() {
  const r1 = await fetch(`${BASE}/flixer/extract-all?tmdbId=550&type=movie`);
  const d1 = await r1.json();
  const src = d1.sources[0];
  console.log('Source URL:', src.url.substring(0, 100));

  // Try direct fetch of the m3u8 (no proxy)
  console.log('\n=== Direct fetch (no proxy) ===');
  let t = Date.now();
  try {
    const r = await fetch(src.url, {
      headers: {
        'Referer': 'https://hexa.su/',
        'Origin': 'https://hexa.su',
      },
      signal: AbortSignal.timeout(10000),
    });
    const body = await r.text();
    console.log(`Status: ${r.status} | Len: ${body.length} | ${Date.now()-t}ms`);
    console.log('Preview:', body.substring(0, 200));
  } catch(e) { console.log(`Error: ${e.message} | ${Date.now()-t}ms`); }

  // Try with flixer.su referer
  console.log('\n=== Direct fetch (flixer.su referer) ===');
  t = Date.now();
  try {
    const r = await fetch(src.url, {
      headers: {
        'Referer': 'https://flixer.su/',
        'Origin': 'https://flixer.su',
      },
      signal: AbortSignal.timeout(10000),
    });
    const body = await r.text();
    console.log(`Status: ${r.status} | Len: ${body.length} | ${Date.now()-t}ms`);
    console.log('Preview:', body.substring(0, 200));
  } catch(e) { console.log(`Error: ${e.message} | ${Date.now()-t}ms`); }

  // Try with no referer at all
  console.log('\n=== Direct fetch (no referer) ===');
  t = Date.now();
  try {
    const r = await fetch(src.url, {
      signal: AbortSignal.timeout(10000),
    });
    const body = await r.text();
    console.log(`Status: ${r.status} | Len: ${body.length} | ${Date.now()-t}ms`);
    console.log('Preview:', body.substring(0, 200));
  } catch(e) { console.log(`Error: ${e.message} | ${Date.now()-t}ms`); }
}

main().catch(e => console.error('FATAL:', e));
