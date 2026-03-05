const https = require('https');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  const r = await httpsGet('https://codepcplay.fun/obfuscated.js', { 'Referer': 'https://codepcplay.fun/' });
  const js = r.data.toString('utf8');
  
  // The _0x4140 array is shuffled by the self-invoking function at the top
  // We need to actually run the decoder to get the right mapping
  // Let's extract and run it
  
  // Actually, let's just run the whole obfuscated.js in a sandboxed context
  // and extract the EPlayerAuth object
  
  const vm = require('vm');
  
  // Create a fake browser environment
  const sandbox = {
    window: {},
    document: {
      querySelector: () => null,
      createElement: () => ({ style: {}, appendChild: () => {} }),
      cookie: '',
    },
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      language: 'en-US',
    },
    screen: { width: 1920, height: 1080 },
    Intl: {
      DateTimeFormat: function() {
        return { resolvedOptions: () => ({ timeZone: 'America/New_York' }) };
      },
    },
    console: console,
    Date: Date,
    Math: Math,
    parseInt: parseInt,
    CryptoJS: null, // Will need to provide this
    location: { hostname: 'codepcplay.fun' },
    setTimeout: setTimeout,
    Error: Error,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  
  // Load CryptoJS first
  const cryptoJsR = await httpsGet('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js');
  const cryptoJsCode = cryptoJsR.data.toString('utf8');
  
  const context = vm.createContext(sandbox);
  
  // Run CryptoJS
  vm.runInContext(cryptoJsCode, context);
  
  // Run the obfuscated code
  try {
    vm.runInContext(js, context);
  } catch (e) {
    console.log('Obfuscated.js error (expected):', e.message);
  }
  
  // Check what we got
  console.log('EPlayerAuth exists:', !!sandbox.EPlayerAuth);
  
  if (sandbox.EPlayerAuth) {
    console.log('Methods:', Object.keys(sandbox.EPlayerAuth));
    
    // Initialize it
    const authResult = await httpsGet('https://codepcplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
    const html = authResult.data.toString('utf8');
    const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
    const authToken = initMatch[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
    const channelSalt = initMatch[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];
    
    console.log('\nInitializing EPlayerAuth...');
    try {
      sandbox.EPlayerAuth.init({
        authToken,
        channelKey: 'premium51',
        country: 'US',
        timestamp: Math.floor(Date.now() / 1000),
        validDomain: 'codepcplay.fun',
        channelSalt,
      });
      console.log('Init OK');
    } catch (e) {
      console.log('Init error:', e.message);
    }
    
    // Get the xhrSetup function
    const xhrSetup = sandbox.EPlayerAuth.getXhrSetup();
    console.log('xhrSetup type:', typeof xhrSetup);
    console.log('xhrSetup source:', xhrSetup.toString().substring(0, 500));
    
    // Simulate an XHR for a key request
    const collectedHeaders = {};
    const fakeXhr = {
      setRequestHeader: (name, value) => {
        collectedHeaders[name] = value;
      },
    };
    
    const keyUrl = 'https://chevy.dvalna.ru/key/premium51/5901482';
    console.log('\nSimulating xhrSetup for key URL:', keyUrl);
    try {
      xhrSetup(fakeXhr, keyUrl);
      console.log('\nHeaders the BROWSER would send:');
      Object.entries(collectedHeaders).forEach(([k, v]) => {
        if (k === 'Authorization') {
          console.log(`  ${k}: ${v.substring(0, 60)}...`);
        } else {
          console.log(`  ${k}: ${v}`);
        }
      });
    } catch (e) {
      console.log('xhrSetup error:', e.message);
    }
    
    // Also test for M3U8 URL
    const m3u8Url = 'https://zekonew.dvalna.ru/zeko/premium51/mono.css';
    const m3u8Headers = {};
    const fakeXhr2 = { setRequestHeader: (n, v) => { m3u8Headers[n] = v; } };
    console.log('\nSimulating xhrSetup for M3U8 URL:', m3u8Url);
    try {
      xhrSetup(fakeXhr2, m3u8Url);
      console.log('M3U8 headers:');
      Object.entries(m3u8Headers).forEach(([k, v]) => {
        console.log(`  ${k}: ${typeof v === 'string' && v.length > 60 ? v.substring(0, 60) + '...' : v}`);
      });
    } catch (e) {
      console.log('M3U8 xhrSetup error:', e.message);
    }
  }
}

main().catch(console.error);
