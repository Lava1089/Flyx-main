const https = require('https');
const fs = require('fs');

async function main() {
  // Load WASM
  const wasmBuffer = fs.readFileSync('pow_wasm_bg.wasm');
  let wasm, mem = null, LEN = 0;
  function getMem() { if (!mem || mem.byteLength === 0) mem = new Uint8Array(wasm.memory.buffer); return mem; }
  const enc = new TextEncoder();
  function pass(arg, malloc) { const buf = enc.encode(arg); const ptr = malloc(buf.length, 1) >>> 0; getMem().subarray(ptr, ptr + buf.length).set(buf); LEN = buf.length; return ptr; }
  
  const { instance } = await WebAssembly.instantiate(wasmBuffer, { './pow_wasm_bg.js': {} });
  wasm = instance.exports;
  
  // Get JWT for channel 35
  const jwt = await new Promise((resolve) => {
    https.get('https://hitsplay.fun/premiumtv/daddyhd.php?id=35', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://dlhd.link/' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const m = data.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        resolve(m ? m[0] : null);
      });
    });
  });
  
  console.log('JWT:', jwt.substring(0, 50) + '...');
  
  // Compute nonce
  const timestamp = Math.floor(Date.now() / 1000);
  const p0 = pass('premium35', wasm.__wbindgen_export); const l0 = LEN;
  const p1 = pass('5893400', wasm.__wbindgen_export); const l1 = LEN;
  const nonce = wasm.compute_nonce(p0, l0, p1, l1, BigInt(timestamp));
  
  console.log('Timestamp:', timestamp);
  console.log('Nonce:', nonce.toString());
  
  // Fetch key
  const keyUrl = 'https://chevy.dvalna.ru/key/premium35/5893400';
  console.log('Fetching:', keyUrl);
  
  const result = await new Promise((resolve) => {
    const url = new URL(keyUrl);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://hitsplay.fun',
        'Referer': 'https://hitsplay.fun/',
        'Authorization': `Bearer ${jwt}`,
        'X-Key-Timestamp': timestamp.toString(),
        'X-Key-Nonce': nonce.toString(),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        resolve({ status: res.statusCode, data, text: data.toString() });
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.end();
  });
  
  console.log('Status:', result.status);
  console.log('Length:', result.data?.length);
  if (result.data?.length === 16) {
    console.log('KEY (hex):', result.data.toString('hex'));
  } else {
    console.log('Response:', result.text?.substring(0, 200));
  }
}

main().catch(console.error);
