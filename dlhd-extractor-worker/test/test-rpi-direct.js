/**
 * Test RPI proxy directly with the exact same request the worker would make
 */

const RPI_PROXY_URL = 'https://rpi-proxy.vynx.cc';
const RPI_API_KEY = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';

async function debug() {
  // Simulate what the worker does for a segment fetch
  const segmentUrl = 'https://chevy.dvalna.ru/9aa4a6a6a06a605c959c';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
  };
  
  // Build the proxy URL exactly like the worker does
  const proxyUrl = new URL('/dlhdprivate', RPI_PROXY_URL);
  proxyUrl.searchParams.set('url', segmentUrl);
  proxyUrl.searchParams.set('headers', JSON.stringify(headers));
  
  console.log('Testing RPI proxy with exact worker request...');
  console.log(`Proxy URL: ${proxyUrl.toString().substring(0, 100)}...`);
  
  const res = await fetch(proxyUrl.toString(), {
    headers: {
      'X-API-Key': RPI_API_KEY,
    },
  });
  
  console.log(`Status: ${res.status}`);
  console.log(`Content-Type: ${res.headers.get('content-type')}`);
  console.log(`Content-Length: ${res.headers.get('content-length')}`);
  
  if (res.ok) {
    const buffer = await res.arrayBuffer();
    console.log(`Got ${buffer.byteLength} bytes`);
    const bytes = new Uint8Array(buffer);
    console.log(`First 10 bytes: ${Array.from(bytes.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  } else {
    const text = await res.text();
    console.log(`Error: ${text}`);
  }
}

debug().catch(console.error);
