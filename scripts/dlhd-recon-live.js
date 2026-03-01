#!/usr/bin/env node
/**
 * DLHD Live Recon - February 28, 2026
 * Probes all DLHD infrastructure to identify current state and failures
 */

async function probe() {
  console.log('=== DLHD RECON - February 28, 2026 ===\n');
  
  // Test 1: Player domain (www.ksohls.ru) - auth source
  console.log('--- Test 1: Player Domain (www.ksohls.ru) ---');
  try {
    const resp = await fetch('https://www.ksohls.ru/premiumtv/daddyhd.php?id=44', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://daddylive.mp/',
      },
    });
    console.log('Status:', resp.status);
    const html = await resp.text();
    console.log('Length:', html.length);
    
    // Check for EPlayerAuth
    const hasEPlayerAuth = html.includes('EPlayerAuth');
    console.log('Has EPlayerAuth:', hasEPlayerAuth);
    
    // Check for XOR encryption pattern
    const hasXorDecrypt = html.includes('_dec_');
    console.log('Has XOR decrypt:', hasXorDecrypt);
    
    // Check for byte arrays
    const byteArrayCount = (html.match(/_init_\w+\s*=\s*\[/g) || []).length;
    console.log('Byte arrays found:', byteArrayCount);
    
    // Extract decoder function name
    const decoderMatch = html.match(/(?:const|var|let)\s+(_dec_\w+)\s*=/);
    console.log('Decoder function:', decoderMatch ? decoderMatch[1] : 'NOT FOUND');
    
    // Check for channelSalt in init
    const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    if (initMatch) {
      const initBlock = initMatch[1];
      console.log('Init block length:', initBlock.length);
      const fields = initBlock.match(/(\w+)\s*:/g);
      console.log('Fields in init:', fields ? fields.map(f => f.replace(':', '').trim()) : 'NONE');
    } else {
      console.log('EPlayerAuth.init NOT FOUND');
      
      // Try to find any auth pattern
      const authPatterns = [
        /EPlayerAuth/g,
        /authToken/g,
        /channelSalt/g,
        /channelKey/g,
        /_dec_/g,
        /_init_/g,
      ];
      for (const pattern of authPatterns) {
        const matches = html.match(pattern);
        console.log(`  Pattern ${pattern.source}: ${matches ? matches.length + ' matches' : 'NOT FOUND'}`);
      }
    }
    
    // Show a snippet around EPlayerAuth or any auth-related content
    const epaIdx = html.indexOf('EPlayerAuth');
    if (epaIdx > -1) {
      console.log('\nEPlayerAuth context (600 chars):');
      console.log(html.substring(Math.max(0, epaIdx - 200), epaIdx + 500).replace(/\n/g, ' ').substring(0, 600));
    }
    
    // Also check for new patterns we might not know about
    const scriptTags = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
    console.log('\nScript tags found:', scriptTags.length);
    for (let i = 0; i < scriptTags.length; i++) {
      const tag = scriptTags[i];
      if (tag.includes('auth') || tag.includes('Auth') || tag.includes('token') || tag.includes('salt') || tag.includes('_dec_') || tag.includes('_init_')) {
        console.log(`\nScript ${i} (auth-related, ${tag.length} chars):`);
        console.log(tag.substring(0, 800));
        if (tag.length > 800) console.log('... (truncated)');
      }
    }
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  
  console.log('\n\n--- Test 2: M3U8 Servers (channel 44 = ESPN) ---');
  const servers = ['ddy6', 'zeko', 'wind', 'dokko1', 'nfs', 'wiki'];
  const domain = 'adsfadfds.cfd';
  const channel = '44';
  
  for (const server of servers) {
    const url = `https://chevy.${domain}/proxy/${server}/premium${channel}/mono.css`;
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
        },
      });
      const text = await resp.text();
      const isM3U8 = text.includes('#EXTM3U');
      console.log(`${server}: ${resp.status} isM3U8=${isM3U8} len=${text.length}`);
      if (isM3U8) {
        const keyMatch = text.match(/URI="([^"]+)"/);
        if (keyMatch) console.log(`  Key URL: ${keyMatch[1]}`);
        const segments = text.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
        console.log(`  Segments: ${segments}`);
      } else if (text.length < 500) {
        console.log(`  Body: ${text.substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`${server}: ERROR ${e.message}`);
    }
  }
  
  // Test soyspace.cyou domain
  console.log('\n--- Test 3: soyspace.cyou domain ---');
  const url2 = `https://chevy.soyspace.cyou/proxy/zeko/premium${channel}/mono.css`;
  try {
    const resp = await fetch(url2, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.ksohls.ru/',
        'Origin': 'https://www.ksohls.ru',
      },
    });
    const text = await resp.text();
    console.log(`soyspace.cyou/zeko: ${resp.status} isM3U8=${text.includes('#EXTM3U')} len=${text.length}`);
  } catch (e) {
    console.log(`soyspace.cyou/zeko: ERROR ${e.message}`);
  }
  
  // Test 4: Check parent domain
  console.log('\n--- Test 4: Parent domain ---');
  try {
    const resp = await fetch('https://daddylive.mp/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'manual',
    });
    console.log(`daddylive.mp: ${resp.status}`);
    if (resp.headers.get('location')) console.log(`Redirects to: ${resp.headers.get('location')}`);
  } catch (e) {
    console.log(`daddylive.mp: ERROR ${e.message}`);
  }
  
  // Test 5: Try multiple channels to check server map accuracy
  console.log('\n--- Test 5: Multi-channel probe (10 random channels) ---');
  const testChannels = [1, 31, 44, 51, 65, 100, 200, 350, 500, 700];
  const serverMap = {
    1: 'nfs', 31: 'nfs', 44: 'zeko', 51: 'zeko', 65: 'dokko1',
    100: 'ddy6', 200: 'nfs', 350: 'dokko1', 500: 'ddy6', 700: 'zeko',
  };
  
  for (const ch of testChannels) {
    const server = serverMap[ch];
    const url = `https://chevy.${domain}/proxy/${server}/premium${ch}/mono.css`;
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
        },
      });
      const text = await resp.text();
      const isM3U8 = text.includes('#EXTM3U');
      console.log(`ch${ch} (${server}): ${resp.status} isM3U8=${isM3U8}`);
    } catch (e) {
      console.log(`ch${ch} (${server}): ERROR ${e.message}`);
    }
  }
  
  // Test 6: Key fetch test (direct from CF - will likely get fake key)
  console.log('\n--- Test 6: Direct key fetch test ---');
  // First get a real key URL from M3U8
  const m3u8Url = `https://chevy.${domain}/proxy/zeko/premium44/mono.css`;
  try {
    const m3u8Resp = await fetch(m3u8Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.ksohls.ru/',
        'Origin': 'https://www.ksohls.ru',
      },
    });
    const m3u8Text = await m3u8Resp.text();
    const keyMatch = m3u8Text.match(/URI="([^"]+)"/);
    if (keyMatch) {
      const keyUri = keyMatch[1];
      const basePath = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
      const keyUrl = keyUri.startsWith('http') ? keyUri : basePath + keyUri;
      console.log(`Key URL: ${keyUrl}`);
      
      // Try fetching key without auth (should fail or get fake)
      const keyResp = await fetch(keyUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
        },
      });
      console.log(`Key fetch (no auth): ${keyResp.status}`);
      if (keyResp.ok) {
        const keyData = await keyResp.arrayBuffer();
        const keyHex = Array.from(new Uint8Array(keyData)).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log(`Key data: ${keyHex} (${keyData.byteLength} bytes)`);
        console.log(`Is fake: ${keyHex.startsWith('455806f8') || keyHex.startsWith('45c6497') || keyHex.startsWith('6572726f72')}`);
      }
    }
  } catch (e) {
    console.log(`Key test ERROR: ${e.message}`);
  }
}

probe().catch(e => console.error('Fatal:', e));
