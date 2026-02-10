/**
 * Test: Can we actually PLAY the HiAnime/MegaCloud HLS streams?
 * Tests the full chain: extraction → m3u8 fetch → segment fetch
 * This tells us if the CDN blocks us or not.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// ── Decryption engine (same as test-hianime-extract5.js) ──

function keygen2(megacloudKey, clientKey) {
  const keygenHashMultVal = 31n;
  const keygenXORVal = 247;
  const keygenShiftVal = 5;
  let tempKey = megacloudKey + clientKey;
  let hashVal = 0n;
  for (let i = 0; i < tempKey.length; i++) {
    hashVal = BigInt(tempKey.charCodeAt(i)) + hashVal * keygenHashMultVal + (hashVal << 7n) - hashVal;
  }
  hashVal = hashVal < 0n ? -hashVal : hashVal;
  const lHash = Number(hashVal % 0x7fffffffffffffffn);
  tempKey = tempKey.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ keygenXORVal)).join('');
  const pivot = (lHash % tempKey.length) + keygenShiftVal;
  tempKey = tempKey.slice(pivot) + tempKey.slice(0, pivot);
  const leafStr = clientKey.split('').reverse().join('');
  let returnKey = '';
  for (let i = 0; i < Math.max(tempKey.length, leafStr.length); i++) {
    returnKey += (tempKey[i] || '') + (leafStr[i] || '');
  }
  returnKey = returnKey.substring(0, 96 + (lHash % 33));
  returnKey = [...returnKey].map(c => String.fromCharCode((c.charCodeAt(0) % 95) + 32)).join('');
  return returnKey;
}
function seedShuffle2(charArray, iKey) {
  let hashVal = 0n;
  for (let i = 0; i < iKey.length; i++) hashVal = (hashVal * 31n + BigInt(iKey.charCodeAt(i))) & 0xffffffffn;
  let shuffleNum = hashVal;
  const psudoRand = (arg) => { shuffleNum = (shuffleNum * 1103515245n + 12345n) & 0x7fffffffn; return Number(shuffleNum % BigInt(arg)); };
  const retStr = [...charArray];
  for (let i = retStr.length - 1; i > 0; i--) { const s = psudoRand(i + 1); [retStr[i], retStr[s]] = [retStr[s], retStr[i]]; }
  return retStr;
}
function columnarCipher2(src, ikey) {
  const cc = ikey.length, rc = Math.ceil(src.length / cc);
  const ca = Array(rc).fill(null).map(() => Array(cc).fill(' '));
  const sm = [...ikey.split('').map((c, i) => ({ c, i }))].sort((a, b) => a.c.charCodeAt(0) - b.c.charCodeAt(0));
  let si = 0;
  sm.forEach(({ i }) => { for (let r = 0; r < rc; r++) ca[r][i] = src[si++]; });
  let ret = '';
  for (let x = 0; x < rc; x++) for (let y = 0; y < cc; y++) ret += ca[x][y];
  return ret;
}
function decryptSrc2(src, clientKey, megacloudKey) {
  const layers = 3, genKey = keygen2(megacloudKey, clientKey);
  let decSrc = atob(src);
  const charArray = [...Array(95)].map((_, i) => String.fromCharCode(32 + i));
  const reverseLayer = (iter) => {
    const lk = genKey + iter;
    let hv = 0n;
    for (let i = 0; i < lk.length; i++) hv = (hv * 31n + BigInt(lk.charCodeAt(i))) & 0xffffffffn;
    let seed = hv;
    const sr = (a) => { seed = (seed * 1103515245n + 12345n) & 0x7fffffffn; return Number(seed % BigInt(a)); };
    decSrc = decSrc.split('').map(c => { const ci = charArray.indexOf(c); if (ci === -1) return c; return charArray[(ci - sr(95) + 95) % 95]; }).join('');
    decSrc = columnarCipher2(decSrc, lk);
    const sv = seedShuffle2(charArray, lk), cm = {};
    sv.forEach((c, i) => { cm[c] = charArray[i]; });
    decSrc = decSrc.split('').map(c => cm[c] || c).join('');
  };
  for (let i = layers; i > 0; i--) reverseLayer(i);
  const dl = parseInt(decSrc.substring(0, 4), 10);
  return decSrc.substring(4, 4 + dl);
}

async function getMegaCloudClientKey(sourceId) {
  const res = await fetch(`https://megacloud.blog/embed-2/v3/e-1/${sourceId}`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://hianime.to/' },
  });
  const text = await res.text();
  const regexes = [
    /<meta name="_gg_fb" content="[a-zA-Z0-9]+">/,
    /<!--\s+_is_th:[0-9a-zA-Z]+\s+-->/,
    /<script>window\._lk_db\s+=\s+\{[xyz]:\s+["'][a-zA-Z0-9]+["'],\s+[xyz]:\s+["'][a-zA-Z0-9]+["'],\s+[xyz]:\s+["'][a-zA-Z0-9]+["']\};<\/script>/,
    /<div\s+data-dpi="[0-9a-zA-Z]+"\s+.*><\/div>/,
    /<script nonce="[0-9a-zA-Z]+">/,
    /<script>window\._xy_ws = ['"`][0-9a-zA-Z]+['"`];<\/script>/,
  ];
  const keyRegex = /"[a-zA-Z0-9]+"/;
  let pass = null, count = 0;
  for (let i = 0; i < regexes.length; i++) { pass = text.match(regexes[i]); if (pass) { count = i; break; } }
  if (!pass) throw new Error('Failed extracting client key');
  let ck = '';
  if (count === 1) { const kt = pass[0].match(/:[a-zA-Z0-9]+ /); ck = kt[0].replace(/:/g, '').replace(/ /g, ''); }
  else { const kt = pass[0].match(keyRegex); ck = kt[0].replace(/"/g, ''); }
  return ck;
}

// ── Main test ──

async function main() {
  console.log('=== HIANIME STREAM PLAYBACK TEST ===\n');
  
  const hianimeId = '18718'; // Solo Leveling
  const domain = 'hianime.to';
  
  // Step 1: Get episode 1 servers
  console.log('[1] Getting episode list...');
  const epRes = await fetch(`https://${domain}/ajax/v2/episode/list/${hianimeId}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${domain}/` },
  });
  const epJson = await epRes.json();
  const epMatch = epJson.html.match(/<a[^>]*data-number="1"[^>]*data-id="(\d+)"[^>]*>/);
  const epDataId = epMatch[1];
  console.log(`   Episode 1 dataId: ${epDataId}`);
  
  // Step 2: Get sub server (serverId=4)
  console.log('[2] Getting servers...');
  const srvRes = await fetch(`https://${domain}/ajax/v2/episode/servers?episodeId=${epDataId}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${domain}/` },
  });
  const srvJson = await srvRes.json();
  const srvRegex = /<div[\s\S]*?class="[^"]*server-item[^"]*"[\s\S]*?>/g;
  let m, subServerId = null;
  while ((m = srvRegex.exec(srvJson.html)) !== null) {
    const block = m[0];
    const type = block.match(/data-type="(sub|dub)"/)?.[1];
    const sid = block.match(/data-server-id="(\d+)"/)?.[1];
    const did = block.match(/data-id="(\d+)"/)?.[1];
    if (type === 'sub' && sid === '4') { subServerId = did; break; }
  }
  console.log(`   Sub server (VidStreaming) dataId: ${subServerId}`);
  
  // Step 3: Get embed URL
  console.log('[3] Getting source link...');
  const srcRes = await fetch(`https://${domain}/ajax/v2/episode/sources?id=${subServerId}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${domain}/` },
  });
  const srcJson = await srcRes.json();
  const embedUrl = srcJson.link;
  console.log(`   Embed URL: ${embedUrl}`);
  
  // Step 4: Extract HLS URL
  console.log('[4] Extracting MegaCloud stream...');
  const sourceId = new URL(embedUrl).pathname.split('/').pop();
  const clientKey = await getMegaCloudClientKey(sourceId);
  const megaKeyRes = await fetch('https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json');
  const megaKeys = await megaKeyRes.json();
  const megacloudKey = megaKeys.mega;
  
  const getSrcRes = await fetch(`https://megacloud.blog/embed-2/v3/e-1/getSources?id=${sourceId}&_k=${clientKey}`, {
    headers: { 'User-Agent': UA, 'Referer': embedUrl },
  });
  const getSrcData = await getSrcRes.json();
  
  let hlsUrl;
  if (!getSrcData.encrypted) {
    hlsUrl = getSrcData.sources[0].file;
  } else {
    const decrypted = decryptSrc2(getSrcData.sources, clientKey, megacloudKey);
    hlsUrl = JSON.parse(decrypted)[0].file;
  }
  console.log(`   ✅ HLS URL: ${hlsUrl}`);
  
  // Step 5: TEST — Can we fetch the master m3u8?
  console.log('\n[5] Testing m3u8 fetch (NO proxy, direct)...');
  const m3u8Res = await fetch(hlsUrl, {
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
  });
  console.log(`   Status: ${m3u8Res.status}`);
  console.log(`   Content-Type: ${m3u8Res.headers.get('content-type')}`);
  const m3u8Text = await m3u8Res.text();
  console.log(`   Size: ${m3u8Text.length} bytes`);
  console.log(`   First 500 chars:\n${m3u8Text.substring(0, 500)}`);
  
  if (m3u8Res.status !== 200) {
    console.log('\n   ❌ DIRECT FETCH BLOCKED! CDN blocks datacenter IPs.');
    console.log('   Need to proxy through residential IP or CF Worker.');
    return;
  }
  
  // Step 6: Parse variant playlists and test one
  const variantLines = m3u8Text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (variantLines.length > 0) {
    const variantUrl = variantLines[0].startsWith('http') 
      ? variantLines[0] 
      : new URL(variantLines[0], hlsUrl).href;
    
    console.log(`\n[6] Testing variant playlist: ${variantUrl.substring(0, 100)}...`);
    const varRes = await fetch(variantUrl, {
      headers: { 'User-Agent': UA, 'Accept': '*/*' },
    });
    console.log(`   Status: ${varRes.status}`);
    const varText = await varRes.text();
    console.log(`   Size: ${varText.length} bytes`);
    
    // Try fetching first segment
    const segLines = varText.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    if (segLines.length > 0) {
      const segUrl = segLines[0].startsWith('http')
        ? segLines[0]
        : new URL(segLines[0], variantUrl).href;
      
      console.log(`\n[7] Testing segment fetch: ${segUrl.substring(0, 100)}...`);
      const segRes = await fetch(segUrl, {
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
      });
      console.log(`   Status: ${segRes.status}`);
      console.log(`   Content-Type: ${segRes.headers.get('content-type')}`);
      const segBuf = await segRes.arrayBuffer();
      console.log(`   Size: ${segBuf.byteLength} bytes`);
      
      if (segRes.status === 200 && segBuf.byteLength > 1000) {
        console.log('\n   ✅ STREAMS PLAY DIRECTLY! No proxy needed for MegaCloud CDN.');
      } else {
        console.log('\n   ❌ Segment fetch failed. CDN may be blocking.');
      }
    }
  }
  
  // Step 8: Test what the CURRENT anime stream API returns
  console.log('\n\n[8] Testing current /api/anime/stream endpoint...');
  console.log('   (This tests what the frontend actually gets)');
  
  // Simulate what the frontend does — call the local API
  // We can't call localhost here, but we can check what the animekai extractor returns
  console.log('   Skipping (need running server). Check browser network tab.');
  
  console.log('\n=== TEST COMPLETE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
