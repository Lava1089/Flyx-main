/**
 * Deep extraction recon - MegaCloud sources API + AnimeKai encrypted episodes
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function fetchText(url, referer, extraHeaders = {}) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': referer || url, ...extraHeaders },
    signal: controller.signal,
  });
  return { status: res.status, text: await res.text(), headers: Object.fromEntries(res.headers.entries()) };
}

// ============================================================================
// MEGACLOUD SOURCES API DISCOVERY
// ============================================================================

async function probeMegaCloud() {
  console.log('=== MEGACLOUD SOURCES API DISCOVERY ===\n');
  
  const embedUrl = 'https://megacloud.blog/embed-2/v3/e-1/zqAeB6Od5pJp?k=1';
  const embedId = 'zqAeB6Od5pJp';
  const domain = 'megacloud.blog';
  
  // First, fetch the player JS to find the API endpoint
  console.log('--- Fetching Player JS ---');
  try {
    const { text: playerJs } = await fetchText(
      `https://${domain}/js/player/a/v3/pro/embed-1.min.js?v=1770662272`,
      embedUrl
    );
    console.log(`  Player JS size: ${playerJs.length}`);
    
    // Look for API endpoints
    const ajaxPatterns = playerJs.match(/["']\/ajax\/[^"']+["']/g) || [];
    console.log(`  AJAX patterns: ${[...new Set(ajaxPatterns)].join(', ')}`);
    
    // Look for getSources patterns
    const getSourcesPatterns = playerJs.match(/getSources[^"'\s)]{0,50}/g) || [];
    console.log(`  getSources patterns: ${[...new Set(getSourcesPatterns)].join(', ')}`);
    
    // Look for URL construction patterns
    const urlPatterns = playerJs.match(/["'][^"']*(?:source|embed|ajax)[^"']*["']/gi) || [];
    console.log(`  URL patterns: ${[...new Set(urlPatterns)].slice(0, 10).join(', ')}`);
    
    // Look for encryption/decryption patterns
    const cryptoPatterns = playerJs.match(/(?:encrypt|decrypt|cipher|aes|crypto|CryptoJS)[a-zA-Z.()]{0,30}/gi) || [];
    console.log(`  Crypto patterns: ${[...new Set(cryptoPatterns)].join(', ')}`);
    
    // Look for the specific path construction
    const pathPatterns = playerJs.match(/["']\/embed-2\/ajax\/[^"']+["']/g) || [];
    console.log(`  embed-2 paths: ${[...new Set(pathPatterns)].join(', ')}`);
    
    // Search for fetch/XMLHttpRequest calls
    const fetchCalls = playerJs.match(/fetch\s*\(\s*["'][^"']+["']/g) || [];
    console.log(`  fetch() calls: ${[...new Set(fetchCalls)].join(', ')}`);
    
    // Look for any URL with 'source' in it
    const sourceUrls = playerJs.match(/[a-zA-Z/.-]*source[a-zA-Z/.-]*/gi) || [];
    console.log(`  Source URL fragments: ${[...new Set(sourceUrls)].slice(0, 10).join(', ')}`);
    
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Try various API endpoint patterns
  console.log('\n--- Trying API Endpoints ---');
  const endpoints = [
    `/embed-2/ajax/e-1/getSources?id=${embedId}`,
    `/embed-2/ajax/v3/e-1/getSources?id=${embedId}`,
    `/ajax/embed/getSources?id=${embedId}`,
    `/ajax/v2/embed/getSources?id=${embedId}`,
    `/embed-2/ajax/e-1/getSources?id=${embedId}&v=3`,
    `/embed-2/v3/ajax/e-1/getSources?id=${embedId}`,
    `/embed-2/ajax/getSources?id=${embedId}`,
  ];
  
  for (const ep of endpoints) {
    try {
      const { status, text } = await fetchText(
        `https://${domain}${ep}`,
        embedUrl,
        { 'X-Requested-With': 'XMLHttpRequest' }
      );
      console.log(`  ${ep}: status=${status}`);
      if (status === 200 && text.length > 10) {
        try {
          const json = JSON.parse(text);
          console.log(`    Keys: ${Object.keys(json).join(', ')}`);
          if (json.sources) {
            const srcType = typeof json.sources;
            console.log(`    Sources type: ${srcType}`);
            if (srcType === 'string') {
              console.log(`    Encrypted (${json.sources.length} chars): ${json.sources.substring(0, 80)}...`);
            } else if (Array.isArray(json.sources)) {
              json.sources.forEach(s => console.log(`    Source: ${JSON.stringify(s).substring(0, 150)}`));
            }
          }
          if (json.encrypted !== undefined) console.log(`    Encrypted: ${json.encrypted}`);
          if (json.tracks) console.log(`    Tracks: ${json.tracks.length}`);
          if (json.intro) console.log(`    Intro: ${JSON.stringify(json.intro)}`);
          if (json.outro) console.log(`    Outro: ${JSON.stringify(json.outro)}`);
        } catch {
          console.log(`    Raw: ${text.substring(0, 200)}`);
        }
      }
    } catch (e) {
      console.log(`  ${ep}: FAILED`);
    }
  }
  
  // Also try the second sub server (1080106) which might use a different embed
  console.log('\n--- Trying Second Sub Server ---');
  try {
    const { text } = await fetchText(
      'https://hianime.to/ajax/v2/episode/sources?id=1080106',
      'https://hianime.to/watch/solo-leveling-18718?ep=114721',
      { 'X-Requested-With': 'XMLHttpRequest' }
    );
    const json = JSON.parse(text);
    console.log(`  Server 1080106: type=${json.type} link=${json.link} server=${json.server}`);
    
    if (json.link) {
      const embedDomain2 = new URL(json.link).hostname;
      const embedId2 = json.link.match(/\/e(?:mbed)?(?:-\d)?\/(?:v\d\/)?(?:e-\d\/)?([a-zA-Z0-9]+)/)?.[1];
      console.log(`  Domain: ${embedDomain2}, ID: ${embedId2}`);
      
      // Try getSources on this domain
      if (embedId2) {
        const tryEndpoints = [
          `https://${embedDomain2}/embed-2/ajax/e-1/getSources?id=${embedId2}`,
          `https://${embedDomain2}/ajax/embed-6/getSources?id=${embedId2}`,
        ];
        for (const ep of tryEndpoints) {
          try {
            const { status, text: srcText } = await fetchText(ep, json.link, { 'X-Requested-With': 'XMLHttpRequest' });
            console.log(`  ${ep.split(embedDomain2)[1]}: status=${status}`);
            if (status === 200) {
              try {
                const srcJson = JSON.parse(srcText);
                console.log(`    Keys: ${Object.keys(srcJson).join(', ')}`);
                if (srcJson.sources) console.log(`    Sources: ${typeof srcJson.sources === 'string' ? srcJson.sources.substring(0, 80) + '...' : JSON.stringify(srcJson.sources).substring(0, 150)}`);
              } catch {
                console.log(`    Raw: ${srcText.substring(0, 200)}`);
              }
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }
  
  // Try third sub server
  console.log('\n--- Trying Third Sub Server (1162054) ---');
  try {
    const { text } = await fetchText(
      'https://hianime.to/ajax/v2/episode/sources?id=1162054',
      'https://hianime.to/watch/solo-leveling-18718?ep=114721',
      { 'X-Requested-With': 'XMLHttpRequest' }
    );
    const json = JSON.parse(text);
    console.log(`  Server 1162054: type=${json.type} link=${json.link} server=${json.server}`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }
}

// ============================================================================
// ANIMEKAI ENCRYPTED EPISODES
// ============================================================================

async function probeAnimeKaiEncryption() {
  console.log('\n\n=== ANIMEKAI ENCRYPTION PROBE ===\n');
  
  const domain = 'anikai.to';
  
  // The watch page had window.__$ with encrypted data
  // And data-id values like "c4G99qc" 
  // Let's check if the episode endpoint needs the encrypted ID
  
  console.log('--- Encrypted Episode Fetch ---');
  
  // The page had data-id="c4G99qc" which looks like a content ID
  const contentId = 'c4G99qc';
  
  // Try various encrypted formats
  const idFormats = [
    contentId,
    btoa(contentId),
    encodeURIComponent(contentId),
  ];
  
  for (const id of idFormats) {
    const endpoints = [
      `https://${domain}/ajax/episodes/list?ani_id=${id}`,
      `https://${domain}/ajax/episodes/list?ani_id=${id}&_=test`,
    ];
    
    for (const ep of endpoints) {
      try {
        const { status, text } = await fetchText(ep, `https://${domain}/watch/solo-leveling-93rg`, { 'X-Requested-With': 'XMLHttpRequest' });
        console.log(`  ${ep.split(domain)[1]}: status=${status} size=${text.length}`);
        try {
          const json = JSON.parse(text);
          if (json.result && typeof json.result === 'string' && json.result.length > 50) {
            console.log(`    ✅ GOT EPISODES! (${json.result.length} chars)`);
            const tokens = json.result.match(/data-token="([^"]+)"/g) || [];
            console.log(`    Tokens: ${tokens.length}`);
          } else {
            console.log(`    Keys: ${Object.keys(json).join(', ')}, status: ${json.status}, msg: ${json.message || json.messages || ''}`);
          }
        } catch {
          console.log(`    Raw: ${text.substring(0, 200)}`);
        }
      } catch (e) {
        console.log(`  FAILED: ${e.message}`);
      }
    }
  }
  
  // The old system used encrypt(contentId) as the _ parameter
  // Let's check what the bundle.js reveals about the new encryption
  console.log('\n--- Bundle.js Analysis ---');
  try {
    const { text: bundleJs } = await fetchText(
      `https://${domain}/assets/build/37585a39fe8c8d8fafaa2c7beead/dist/bundle.js?1knb246`,
      `https://${domain}/`
    );
    console.log(`  Bundle size: ${bundleJs.length}`);
    
    // Look for AJAX endpoint patterns
    const ajaxEps = bundleJs.match(/["']\/ajax\/[^"']+["']/g) || [];
    console.log(`  AJAX endpoints: ${[...new Set(ajaxEps)].join(', ')}`);
    
    // Look for encryption function patterns
    const encPatterns = bundleJs.match(/(?:encrypt|decrypt|cipher|encode|decode)[a-zA-Z(]{0,30}/gi) || [];
    console.log(`  Enc/Dec patterns: ${[...new Set(encPatterns)].slice(0, 15).join(', ')}`);
    
    // Look for the episode list fetch
    const epListPatterns = bundleJs.match(/episodes\/list[^"'\s]{0,50}/g) || [];
    console.log(`  Episode list patterns: ${[...new Set(epListPatterns)].join(', ')}`);
    
    // Look for ani_id parameter construction
    const aniIdPatterns = bundleJs.match(/ani_id[^"'\s]{0,80}/g) || [];
    console.log(`  ani_id patterns: ${[...new Set(aniIdPatterns)].join(', ')}`);
    
    // Look for the _ parameter (encryption token)
    const underscorePatterns = bundleJs.match(/_=["'][^"']+["']|_:\s*[a-zA-Z]+\(/g) || [];
    console.log(`  _ param patterns: ${[...new Set(underscorePatterns)].slice(0, 10).join(', ')}`);
    
    // Look for window.__$ usage
    const windowPatterns = bundleJs.match(/window\.__\$[^;]{0,50}/g) || [];
    console.log(`  window.__$ patterns: ${[...new Set(windowPatterns)].slice(0, 5).join(', ')}`);
    
    // Look for fetch/axios calls near episode
    const fetchNearEp = bundleJs.match(/.{0,50}episode.{0,100}/gi) || [];
    console.log(`  Code near 'episode': ${fetchNearEp.slice(0, 3).map(s => s.substring(0, 100)).join(' | ')}`);
    
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }
  
  // Check the inline window.__$ value - it might be a key/token
  console.log('\n--- window.__$ Analysis ---');
  const windowValue = 'ZZYdbXagjEpeaR4SF5y_Ccp_Y07nNw7xYW8dkjfW2k5qNK0ZeAcmgFulISFLvUvM0X_T6lQg_jIQEWBTGcEuZH6u9gzEXMIDmTpLYrAGCw';
  console.log(`  Value: ${windowValue}`);
  console.log(`  Length: ${windowValue.length}`);
  
  // Try base64 decode
  try {
    const decoded = Buffer.from(windowValue, 'base64').toString('utf8');
    console.log(`  Base64 decoded: ${decoded.substring(0, 100)}`);
  } catch {
    console.log('  Not valid base64');
  }
  
  // Try URL-safe base64
  try {
    const safe = windowValue.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(safe, 'base64');
    console.log(`  URL-safe base64 decoded (hex): ${decoded.toString('hex').substring(0, 60)}`);
    console.log(`  Decoded length: ${decoded.length} bytes`);
  } catch {
    console.log('  Not valid URL-safe base64');
  }
}

async function main() {
  await probeMegaCloud();
  await probeAnimeKaiEncryption();
}

main().catch(console.error);
