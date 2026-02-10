/**
 * Test: Full HiAnime → MegaCloud extract5 pipeline
 * Pure fetch + local decryption — no axios, no cheerio, no CryptoJS
 * 
 * Tests:
 * 1. HiAnime episode list → server list → sources (embed URL)
 * 2. MegaCloud client key extraction from embed page
 * 3. MegaCloud getSources v3 API call
 * 4. Local decryption of encrypted sources
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// ============================================================================
// DECRYPTION ENGINE (ported from aniwatch — pure JS, no dependencies)
// ============================================================================

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
  for (let i = 0; i < iKey.length; i++) {
    hashVal = (hashVal * 31n + BigInt(iKey.charCodeAt(i))) & 0xffffffffn;
  }
  let shuffleNum = hashVal;
  const psudoRand = (arg) => {
    shuffleNum = (shuffleNum * 1103515245n + 12345n) & 0x7fffffffn;
    return Number(shuffleNum % BigInt(arg));
  };
  const retStr = [...charArray];
  for (let i = retStr.length - 1; i > 0; i--) {
    const swapIndex = psudoRand(i + 1);
    [retStr[i], retStr[swapIndex]] = [retStr[swapIndex], retStr[i]];
  }
  return retStr;
}

function columnarCipher2(src, ikey) {
  const columnCount = ikey.length;
  const rowCount = Math.ceil(src.length / columnCount);
  const cipherArry = Array(rowCount).fill(null).map(() => Array(columnCount).fill(' '));

  const keyMap = ikey.split('').map((char, index) => ({ char, idx: index }));
  const sortedMap = [...keyMap].sort((a, b) => a.char.charCodeAt(0) - b.char.charCodeAt(0));

  let srcIndex = 0;
  sortedMap.forEach(({ idx: index }) => {
    for (let i = 0; i < rowCount; i++) {
      cipherArry[i][index] = src[srcIndex++];
    }
  });

  let returnStr = '';
  for (let x = 0; x < rowCount; x++) {
    for (let y = 0; y < columnCount; y++) {
      returnStr += cipherArry[x][y];
    }
  }
  return returnStr;
}

function decryptSrc2(src, clientKey, megacloudKey) {
  const layers = 3;
  const genKey = keygen2(megacloudKey, clientKey);
  let decSrc = atob(src);
  const charArray = [...Array(95)].map((_, index) => String.fromCharCode(32 + index));

  const reverseLayer = (iteration) => {
    const layerKey = genKey + iteration;
    let hashVal = 0n;
    for (let i = 0; i < layerKey.length; i++) {
      hashVal = (hashVal * 31n + BigInt(layerKey.charCodeAt(i))) & 0xffffffffn;
    }
    let seed = hashVal;
    const seedRand = (arg) => {
      seed = (seed * 1103515245n + 12345n) & 0x7fffffffn;
      return Number(seed % BigInt(arg));
    };

    decSrc = decSrc.split('').map((char) => {
      const cArryIndex = charArray.indexOf(char);
      if (cArryIndex === -1) return char;
      const randNum = seedRand(95);
      const newCharIndex = (cArryIndex - randNum + 95) % 95;
      return charArray[newCharIndex];
    }).join('');

    decSrc = columnarCipher2(decSrc, layerKey);
    const subValues = seedShuffle2(charArray, layerKey);
    const charMap = {};
    subValues.forEach((char, index) => { charMap[char] = charArray[index]; });
    decSrc = decSrc.split('').map(char => charMap[char] || char).join('');
  };

  for (let i = layers; i > 0; i--) {
    reverseLayer(i);
  }
  const dataLen = parseInt(decSrc.substring(0, 4), 10);
  return decSrc.substring(4, 4 + dataLen);
}

// ============================================================================
// CLIENT KEY EXTRACTION (from MegaCloud embed page)
// ============================================================================

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
  const lkDbRegex = [/x:\s+"[a-zA-Z0-9]+"/, /y:\s+"[a-zA-Z0-9]+"/, /z:\s+"[a-zA-Z0-9]+"/];

  let pass = null;
  let count = 0;
  for (let i = 0; i < regexes.length; i++) {
    pass = text.match(regexes[i]);
    if (pass !== null) { count = i; break; }
  }
  if (!pass) throw new Error('Failed extracting client key segment');

  let clientKey = '';
  if (count === 2) {
    const x = pass[0].match(lkDbRegex[0]);
    const y = pass[0].match(lkDbRegex[1]);
    const z = pass[0].match(lkDbRegex[2]);
    if (!x || !y || !z) throw new Error('Failed building client key (xyz)');
    const p1 = x[0].match(keyRegex), p2 = y[0].match(keyRegex), p3 = z[0].match(keyRegex);
    if (!p1 || !p2 || !p3) throw new Error('Failed building client key (xyz)');
    clientKey = p1[0].replace(/"/g, '') + p2[0].replace(/"/g, '') + p3[0].replace(/"/g, '');
  } else if (count === 1) {
    const keytest = pass[0].match(/:[a-zA-Z0-9]+ /);
    if (!keytest) throw new Error('Failed extracting client key (comment)');
    clientKey = keytest[0].replace(/:/g, '').replace(/ /g, '');
  } else {
    const keytest = pass[0].match(keyRegex);
    if (!keytest) throw new Error('Failed extracting client key');
    clientKey = keytest[0].replace(/"/g, '');
  }
  return clientKey;
}

// ============================================================================
// MEGACLOUD KEY (from GitHub — this is the only external dependency)
// ============================================================================

async function getMegaCloudKey() {
  const res = await fetch('https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json');
  const keys = await res.json();
  return keys.mega;
}

// ============================================================================
// HIANIME API (pure fetch, regex HTML parsing)
// ============================================================================

const HIANIME_DOMAIN = 'hianime.to';

async function hianimeSearch(query) {
  const res = await fetch(`https://${HIANIME_DOMAIN}/search?keyword=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA },
  });
  const html = await res.text();
  
  // Parse search results — extract anime IDs and titles
  const results = [];
  const itemRegex = /<a[^>]*href="\/([^"?]+)"[^>]*class="[^"]*dynamic-name[^"]*"[^>]*data-jname="([^"]*)"[^>]*>([^<]*)<\/a>/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const id = match[1];
    const jname = match[2];
    const name = match[3].trim();
    // Extract numeric ID from slug (e.g., "solo-leveling-18718" → 18718)
    const numId = id.match(/-(\d+)$/)?.[1];
    results.push({ id, name, jname, hianimeId: numId });
  }
  return results;
}

async function getEpisodeList(animeId) {
  const res = await fetch(`https://${HIANIME_DOMAIN}/ajax/v2/episode/list/${animeId}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${HIANIME_DOMAIN}/` },
  });
  const json = await res.json();
  const html = json.html;
  
  // Parse episodes: <a ... data-number="1" data-id="114721" ... href="/watch/solo-leveling-18718?ep=114721" ...>
  const episodes = [];
  const epRegex = /<a[^>]*data-number="(\d+)"[^>]*data-id="(\d+)"[^>]*href="([^"]*)"[^>]*>/g;
  let m;
  while ((m = epRegex.exec(html)) !== null) {
    episodes.push({ number: parseInt(m[1]), dataId: m[2], href: m[3] });
  }
  return episodes;
}

async function getServers(episodeId) {
  const res = await fetch(`https://${HIANIME_DOMAIN}/ajax/v2/episode/servers?episodeId=${episodeId}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${HIANIME_DOMAIN}/` },
  });
  const json = await res.json();
  const html = json.html;
  
  const servers = [];
  // Attributes can be on separate lines, so match each server-item block loosely
  const serverRegex = /<div[^>]*class="[^"]*server-item[^"]*"[^>]*>/gs;
  let m;
  while ((m = serverRegex.exec(html)) !== null) {
    const block = m[0];
    const dataId = block.match(/data-id="(\d+)"/)?.[1];
    const type = block.match(/data-type="(sub|dub|raw)"/)?.[1];
    const serverId = block.match(/data-server-id="(\d+)"/)?.[1];
    if (dataId && type && serverId) {
      servers.push({ dataId, type, serverId });
    }
  }
  return servers;
}

async function getSourceLink(serverId) {
  const res = await fetch(`https://${HIANIME_DOMAIN}/ajax/v2/episode/sources?id=${serverId}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${HIANIME_DOMAIN}/` },
  });
  const json = await res.json();
  return json.link; // e.g., "https://megacloud.blog/embed-2/v3/e-1/XXXXX?k=1"
}

// ============================================================================
// FULL EXTRACTION (extract5 approach)
// ============================================================================

async function extractMegaCloudStream(embedUrl) {
  const url = new URL(embedUrl);
  const sourceId = url.pathname.split('/').pop();
  
  console.log(`  [MegaCloud] sourceId: ${sourceId}`);
  
  // Step 1: Get client key from embed page
  const clientKey = await getMegaCloudClientKey(sourceId);
  console.log(`  [MegaCloud] clientKey: ${clientKey}`);
  
  // Step 2: Get megacloud decryption key from GitHub
  const megacloudKey = await getMegaCloudKey();
  console.log(`  [MegaCloud] megacloudKey: ${megacloudKey.substring(0, 20)}...`);
  
  // Step 3: Call getSources v3 API
  const srcRes = await fetch(`https://megacloud.blog/embed-2/v3/e-1/getSources?id=${sourceId}&_k=${clientKey}`, {
    headers: { 'User-Agent': UA, 'Referer': embedUrl },
  });
  const srcData = await srcRes.json();
  console.log(`  [MegaCloud] encrypted: ${srcData.encrypted}, keys: ${Object.keys(srcData).join(', ')}`);
  
  // Step 4: Decrypt if needed
  let sources;
  if (!srcData.encrypted) {
    sources = srcData.sources;
  } else {
    const encrypted = srcData.sources;
    console.log(`  [MegaCloud] Decrypting ${encrypted.length} chars...`);
    const decrypted = decryptSrc2(encrypted, clientKey, megacloudKey);
    sources = JSON.parse(decrypted);
  }
  
  // Step 5: Parse subtitles
  const subtitles = (srcData.tracks || [])
    .filter(t => t.kind === 'captions')
    .map(t => ({ url: t.file, lang: t.label || t.kind, default: t.default || false }));
  
  return {
    sources: sources.map(s => ({ url: s.file, type: s.type })),
    subtitles,
    intro: srcData.intro || { start: 0, end: 0 },
    outro: srcData.outro || { start: 0, end: 0 },
  };
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log('=== HIANIME + MEGACLOUD EXTRACT5 FULL PIPELINE TEST ===\n');
  
  // Test with Solo Leveling (MAL ID 52299, HiAnime ID 18718)
  const hianimeId = '18718';
  const targetEpisode = 1;
  
  // Step 1: Get episodes
  console.log(`[1] Getting episodes for HiAnime ID ${hianimeId}...`);
  const episodes = await getEpisodeList(hianimeId);
  console.log(`    Found ${episodes.length} episodes`);
  
  const ep = episodes.find(e => e.number === targetEpisode);
  if (!ep) { console.log('    Episode not found!'); return; }
  console.log(`    Episode ${targetEpisode}: dataId=${ep.dataId}`);
  
  // Step 2: Get servers
  console.log(`\n[2] Getting servers for episode ${ep.dataId}...`);
  const servers = await getServers(ep.dataId);
  console.log(`    Found ${servers.length} servers:`);
  servers.forEach(s => console.log(`      ${s.type} serverId=${s.serverId} dataId=${s.dataId}`));
  
  // Step 3: Get source link for first sub server (serverId=4 = VidStreaming/MegaCloud)
  const subServer = servers.find(s => s.type === 'sub' && s.serverId === '4') || servers.find(s => s.type === 'sub');
  const dubServer = servers.find(s => s.type === 'dub' && s.serverId === '4') || servers.find(s => s.type === 'dub');
  
  if (subServer) {
    console.log(`\n[3] Getting SUB source link (dataId=${subServer.dataId})...`);
    const link = await getSourceLink(subServer.dataId);
    console.log(`    Embed URL: ${link}`);
    
    if (link) {
      console.log(`\n[4] Extracting SUB stream from MegaCloud...`);
      try {
        const result = await extractMegaCloudStream(link);
        console.log(`    ✅ SUB Sources: ${result.sources.length}`);
        result.sources.forEach(s => console.log(`      ${s.type}: ${s.url.substring(0, 100)}...`));
        console.log(`    Subtitles: ${result.subtitles.length}`);
        result.subtitles.slice(0, 3).forEach(s => console.log(`      ${s.lang}: ${s.url.substring(0, 80)}...`));
        console.log(`    Intro: ${JSON.stringify(result.intro)}`);
        console.log(`    Outro: ${JSON.stringify(result.outro)}`);
      } catch (e) {
        console.log(`    ❌ SUB extraction failed: ${e.message}`);
      }
    }
  }
  
  if (dubServer) {
    console.log(`\n[5] Getting DUB source link (dataId=${dubServer.dataId})...`);
    const link = await getSourceLink(dubServer.dataId);
    console.log(`    Embed URL: ${link}`);
    
    if (link) {
      console.log(`\n[6] Extracting DUB stream from MegaCloud...`);
      try {
        const result = await extractMegaCloudStream(link);
        console.log(`    ✅ DUB Sources: ${result.sources.length}`);
        result.sources.forEach(s => console.log(`      ${s.type}: ${s.url.substring(0, 100)}...`));
      } catch (e) {
        console.log(`    ❌ DUB extraction failed: ${e.message}`);
      }
    }
  }
  
  console.log('\n=== TEST COMPLETE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
