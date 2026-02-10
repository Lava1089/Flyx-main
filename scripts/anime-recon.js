/**
 * Anime Provider Recon - AnimeKai + HiAnime
 * Tests the full extraction pipeline for both providers
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// ============================================================================
// ANIMEKAI RECON
// ============================================================================

async function reconAnimeKai() {
  console.log('=== ANIMEKAI RECON ===\n');
  
  // Step 1: Check if site is up
  console.log('--- Step 1: Site Check ---');
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const res = await fetch('https://animekai.to/', {
      headers: { 'User-Agent': UA },
      signal: controller.signal,
      redirect: 'follow',
    });
    console.log(`  Status: ${res.status}`);
    console.log(`  URL: ${res.url}`);
    const html = await res.text();
    console.log(`  Size: ${html.length}`);
    console.log(`  Has content: ${html.includes('animekai') || html.includes('anime')}`);
    
    // Check for CF challenge
    if (html.includes('challenge-platform') || html.includes('cf-browser-verification')) {
      console.log('  ⚠️ Cloudflare challenge detected!');
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Step 2: Search for a known anime (Solo Leveling)
  console.log('\n--- Step 2: Search ---');
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const searchUrl = 'https://animekai.to/browser?keyword=solo+leveling';
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://animekai.to/' },
      signal: controller.signal,
    });
    const html = await res.text();
    console.log(`  Status: ${res.status}, Size: ${html.length}`);
    
    // Look for anime links
    const links = html.match(/href="\/watch\/[^"]+"/g) || [];
    console.log(`  Watch links found: ${links.length}`);
    if (links.length > 0) {
      console.log(`  First: ${links[0]}`);
    }
    
    // Look for content IDs
    const dataIds = html.match(/data-id="([^"]+)"/g) || [];
    console.log(`  Data IDs: ${dataIds.length}`);
    if (dataIds.length > 0) console.log(`  First: ${dataIds[0]}`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Step 3: Test AJAX endpoints
  console.log('\n--- Step 3: AJAX Endpoints ---');
  const ajaxEndpoints = [
    'https://animekai.to/ajax/anime/search?keyword=solo+leveling',
    'https://animekai.to/ajax/anime/list?keyword=solo+leveling',
  ];
  
  for (const url of ajaxEndpoints) {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://animekai.to/',
        },
        signal: controller.signal,
      });
      const text = await res.text();
      console.log(`  ${url.split('?')[0].split('/').pop()}: status=${res.status} size=${text.length}`);
      
      // Try to parse as JSON
      try {
        const json = JSON.parse(text);
        console.log(`    JSON keys: ${Object.keys(json).join(', ')}`);
        if (json.result) console.log(`    result type: ${typeof json.result}, length: ${typeof json.result === 'string' ? json.result.length : 'N/A'}`);
        if (json.html) console.log(`    html length: ${json.html.length}`);
      } catch {
        console.log(`    Not JSON, first 200: ${text.substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`  ${url.split('/').pop()}: FAILED - ${e.message}`);
    }
  }

  // Step 4: Test a known anime page
  console.log('\n--- Step 4: Anime Page ---');
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    // Solo Leveling Season 2
    const res = await fetch('https://animekai.to/watch/solo-leveling-season-2-arise-from-the-shadow.o5r17', {
      headers: { 'User-Agent': UA, 'Referer': 'https://animekai.to/' },
      signal: controller.signal,
    });
    const html = await res.text();
    console.log(`  Status: ${res.status}, Size: ${html.length}`);
    
    // Look for episode data
    const dataIds = html.match(/data-id="([^"]+)"/g) || [];
    const contentId = html.match(/content-id="([^"]+)"/);
    const kaiId = html.match(/data-kai-id="([^"]+)"/);
    console.log(`  data-id count: ${dataIds.length}`);
    console.log(`  content-id: ${contentId ? contentId[1] : 'NOT FOUND'}`);
    console.log(`  kai-id: ${kaiId ? kaiId[1] : 'NOT FOUND'}`);
    
    // Look for any ID patterns
    const idPatterns = html.match(/id="([^"]*(?:anime|episode|content)[^"]*)"/gi) || [];
    console.log(`  ID patterns: ${idPatterns.slice(0, 5).join(', ')}`);
    
    // Check for encryption/security changes
    const scriptTags = html.match(/<script[^>]*src="([^"]+)"[^>]*>/g) || [];
    console.log(`  External scripts: ${scriptTags.length}`);
    scriptTags.forEach(s => {
      const src = s.match(/src="([^"]+)"/)?.[1];
      if (src && !src.includes('jquery') && !src.includes('bootstrap') && !src.includes('google')) {
        console.log(`    ${src}`);
      }
    });
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Step 5: Test episode AJAX
  console.log('\n--- Step 5: Episode AJAX ---');
  // Try fetching episodes for a known anime
  const testIds = ['o5r17', 'MjE1Mg', 'MjE1Mg=='];
  for (const id of testIds) {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 8000);
      const url = `https://animekai.to/ajax/episodes/list?ani_id=${id}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://animekai.to/',
        },
        signal: controller.signal,
      });
      const text = await res.text();
      console.log(`  ani_id=${id}: status=${res.status} size=${text.length}`);
      try {
        const json = JSON.parse(text);
        if (json.result) {
          const epLinks = json.result.match(/data-token="([^"]+)"/g) || [];
          const epNums = json.result.match(/data-num="([^"]+)"/g) || [];
          console.log(`    Episodes found: ${epLinks.length}, nums: ${epNums.slice(0, 5).join(', ')}`);
        }
        if (json.html) {
          const epLinks = json.html.match(/data-token="([^"]+)"/g) || [];
          console.log(`    Episodes in html: ${epLinks.length}`);
        }
      } catch {
        console.log(`    Response: ${text.substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`  ani_id=${id}: FAILED - ${e.message}`);
    }
  }
}

// ============================================================================
// HIANIME RECON
// ============================================================================

async function reconHiAnime() {
  console.log('\n\n=== HIANIME RECON ===\n');
  
  // Step 1: Check if site is up
  console.log('--- Step 1: Site Check ---');
  const domains = ['hianime.to', 'hianime.nz', 'hianime.sx', 'aniwatch.to'];
  for (const domain of domains) {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`https://${domain}/`, {
        headers: { 'User-Agent': UA },
        signal: controller.signal,
        redirect: 'manual',
      });
      console.log(`  ${domain}: status=${res.status} location=${res.headers.get('location') || 'none'}`);
      if (res.status === 200) {
        const html = await res.text();
        console.log(`    Size: ${html.length}, Has anime content: ${html.includes('anime') || html.includes('hianime')}`);
        if (html.includes('challenge-platform')) console.log('    ⚠️ CF challenge!');
      }
    } catch (e) {
      console.log(`  ${domain}: FAILED - ${e.message}`);
    }
  }

  // Step 2: Search on working domain
  console.log('\n--- Step 2: Search ---');
  const workingDomain = 'hianime.to';
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`https://${workingDomain}/search?keyword=solo+leveling`, {
      headers: { 'User-Agent': UA, 'Referer': `https://${workingDomain}/` },
      signal: controller.signal,
    });
    const html = await res.text();
    console.log(`  Status: ${res.status}, Size: ${html.length}`);
    
    const watchLinks = html.match(/href="\/watch\/[^"]+"/g) || [];
    console.log(`  Watch links: ${watchLinks.length}`);
    if (watchLinks.length > 0) console.log(`  First: ${watchLinks[0]}`);
    
    const dataIds = html.match(/data-id="([^"]+)"/g) || [];
    console.log(`  Data IDs: ${dataIds.length}`);
    if (dataIds.length > 0) console.log(`  First: ${dataIds[0]}`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Step 3: Test AJAX endpoints
  console.log('\n--- Step 3: AJAX Endpoints ---');
  const ajaxUrls = [
    `https://${workingDomain}/ajax/search/suggest?keyword=solo+leveling`,
    `https://${workingDomain}/ajax/home`,
  ];
  
  for (const url of ajaxUrls) {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `https://${workingDomain}/`,
        },
        signal: controller.signal,
      });
      const text = await res.text();
      const endpoint = url.split(workingDomain)[1].split('?')[0];
      console.log(`  ${endpoint}: status=${res.status} size=${text.length}`);
      try {
        const json = JSON.parse(text);
        console.log(`    Keys: ${Object.keys(json).join(', ')}`);
        if (json.html) {
          const links = json.html.match(/href="\/watch\/[^"]+"/g) || [];
          console.log(`    Watch links in html: ${links.length}`);
          if (links.length > 0) console.log(`    First: ${links[0]}`);
        }
      } catch {
        console.log(`    Not JSON: ${text.substring(0, 150)}`);
      }
    } catch (e) {
      console.log(`  FAILED: ${e.message}`);
    }
  }

  // Step 4: Test anime page
  console.log('\n--- Step 4: Anime Page ---');
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`https://${workingDomain}/watch/solo-leveling-18718`, {
      headers: { 'User-Agent': UA, 'Referer': `https://${workingDomain}/` },
      signal: controller.signal,
    });
    const html = await res.text();
    console.log(`  Status: ${res.status}, Size: ${html.length}`);
    
    // Look for episode/server data
    const dataIds = html.match(/data-id="([^"]+)"/g) || [];
    console.log(`  data-id count: ${dataIds.length}`);
    if (dataIds.length > 0) console.log(`  First few: ${dataIds.slice(0, 3).join(', ')}`);
    
    // Look for server types (sub/dub/raw)
    const serverTypes = html.match(/data-type="(sub|dub|raw)"/g) || [];
    console.log(`  Server types: ${serverTypes.join(', ') || 'none'}`);
    
    // Look for episode tokens
    const tokens = html.match(/data-token="([^"]+)"/g) || [];
    console.log(`  Tokens: ${tokens.length}`);
    
    // Check for API patterns
    const apiPatterns = html.match(/\/ajax\/[a-z/]+/g) || [];
    const uniqueApis = [...new Set(apiPatterns)];
    console.log(`  AJAX patterns: ${uniqueApis.join(', ')}`);
    
    // Check scripts
    const scripts = html.match(/<script[^>]*src="([^"]+)"[^>]*>/g) || [];
    console.log(`  Scripts: ${scripts.length}`);
    scripts.forEach(s => {
      const src = s.match(/src="([^"]+)"/)?.[1];
      if (src && !src.includes('jquery') && !src.includes('bootstrap') && !src.includes('google') && !src.includes('cdn')) {
        console.log(`    ${src}`);
      }
    });
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Step 5: Test episode AJAX
  console.log('\n--- Step 5: Episode AJAX ---');
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    // HiAnime uses numeric IDs
    const res = await fetch(`https://${workingDomain}/ajax/v2/episode/list/18718`, {
      headers: {
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `https://${workingDomain}/watch/solo-leveling-18718`,
      },
      signal: controller.signal,
    });
    const text = await res.text();
    console.log(`  Status: ${res.status}, Size: ${text.length}`);
    try {
      const json = JSON.parse(text);
      console.log(`  Keys: ${Object.keys(json).join(', ')}`);
      if (json.html) {
        const epIds = json.html.match(/data-id="(\d+)"/g) || [];
        const epNums = json.html.match(/data-number="(\d+)"/g) || [];
        console.log(`  Episodes: ${epIds.length}`);
        console.log(`  First 5 IDs: ${epIds.slice(0, 5).join(', ')}`);
        console.log(`  First 5 nums: ${epNums.slice(0, 5).join(', ')}`);
      }
    } catch {
      console.log(`  Response: ${text.substring(0, 300)}`);
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Step 6: Test server AJAX
  console.log('\n--- Step 6: Server AJAX ---');
  try {
    // First get an episode ID
    const controller1 = new AbortController();
    setTimeout(() => controller1.abort(), 8000);
    const epRes = await fetch(`https://${workingDomain}/ajax/v2/episode/list/18718`, {
      headers: {
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `https://${workingDomain}/watch/solo-leveling-18718`,
      },
      signal: controller1.signal,
    });
    const epJson = await epRes.json();
    const firstEpId = epJson.html?.match(/data-id="(\d+)"/)?.[1];
    
    if (firstEpId) {
      console.log(`  Using episode ID: ${firstEpId}`);
      
      const controller2 = new AbortController();
      setTimeout(() => controller2.abort(), 8000);
      const serverRes = await fetch(`https://${workingDomain}/ajax/v2/episode/servers?episodeId=${firstEpId}`, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `https://${workingDomain}/watch/solo-leveling-18718?ep=${firstEpId}`,
        },
        signal: controller2.signal,
      });
      const serverText = await serverRes.text();
      console.log(`  Status: ${serverRes.status}, Size: ${serverText.length}`);
      
      try {
        const serverJson = JSON.parse(serverText);
        if (serverJson.html) {
          // Parse server types
          const subServers = serverJson.html.match(/data-type="sub"[^>]*data-id="(\d+)"/g) || [];
          const dubServers = serverJson.html.match(/data-type="dub"[^>]*data-id="(\d+)"/g) || [];
          const rawServers = serverJson.html.match(/data-type="raw"[^>]*data-id="(\d+)"/g) || [];
          
          // Also try reverse order
          const subServers2 = serverJson.html.match(/data-id="(\d+)"[^>]*data-type="sub"/g) || [];
          const dubServers2 = serverJson.html.match(/data-id="(\d+)"[^>]*data-type="dub"/g) || [];
          
          console.log(`  Sub servers: ${subServers.length + subServers2.length}`);
          console.log(`  Dub servers: ${dubServers.length + dubServers2.length}`);
          console.log(`  Raw servers: ${rawServers.length}`);
          
          // Get server names
          const serverNames = serverJson.html.match(/data-server-id="(\d+)"[^>]*>[^<]*<span[^>]*>([^<]+)/g) || [];
          console.log(`  Server names: ${serverNames.length}`);
          
          // Get all server IDs
          const allServerIds = serverJson.html.match(/data-id="(\d+)"/g) || [];
          console.log(`  All server IDs: ${allServerIds.slice(0, 10).join(', ')}`);
          
          // Show raw HTML snippet for analysis
          console.log(`  HTML snippet: ${serverJson.html.substring(0, 500)}`);
        }
      } catch {
        console.log(`  Response: ${serverText.substring(0, 300)}`);
      }
    } else {
      console.log('  No episode ID found');
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Step 7: Test source AJAX (get embed URL)
  console.log('\n--- Step 7: Source/Embed AJAX ---');
  try {
    // Get episode ID first
    const controller1 = new AbortController();
    setTimeout(() => controller1.abort(), 8000);
    const epRes = await fetch(`https://${workingDomain}/ajax/v2/episode/list/18718`, {
      headers: {
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `https://${workingDomain}/watch/solo-leveling-18718`,
      },
      signal: controller1.signal,
    });
    const epJson = await epRes.json();
    const firstEpId = epJson.html?.match(/data-id="(\d+)"/)?.[1];
    
    if (firstEpId) {
      // Get servers
      const controller2 = new AbortController();
      setTimeout(() => controller2.abort(), 8000);
      const serverRes = await fetch(`https://${workingDomain}/ajax/v2/episode/servers?episodeId=${firstEpId}`, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `https://${workingDomain}/watch/solo-leveling-18718?ep=${firstEpId}`,
        },
        signal: controller2.signal,
      });
      const serverJson = await serverRes.json();
      
      // Get first server ID
      const firstServerId = serverJson.html?.match(/data-id="(\d+)"/)?.[1];
      if (firstServerId) {
        console.log(`  Using server ID: ${firstServerId}`);
        
        // Try to get source/embed
        const sourceUrls = [
          `https://${workingDomain}/ajax/v2/episode/sources?id=${firstServerId}`,
          `https://${workingDomain}/ajax/episode/sources?id=${firstServerId}`,
        ];
        
        for (const sourceUrl of sourceUrls) {
          try {
            const controller3 = new AbortController();
            setTimeout(() => controller3.abort(), 8000);
            const sourceRes = await fetch(sourceUrl, {
              headers: {
                'User-Agent': UA,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `https://${workingDomain}/watch/solo-leveling-18718?ep=${firstEpId}`,
              },
              signal: controller3.signal,
            });
            const sourceText = await sourceRes.text();
            const endpoint = sourceUrl.split(workingDomain)[1];
            console.log(`  ${endpoint}: status=${sourceRes.status}`);
            
            try {
              const sourceJson = JSON.parse(sourceText);
              console.log(`    Keys: ${Object.keys(sourceJson).join(', ')}`);
              if (sourceJson.link) console.log(`    Link: ${sourceJson.link}`);
              if (sourceJson.type) console.log(`    Type: ${sourceJson.type}`);
            } catch {
              console.log(`    Response: ${sourceText.substring(0, 300)}`);
            }
          } catch (e) {
            console.log(`  FAILED: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('ANIME PROVIDER RECON');
  console.log('Time:', new Date().toISOString());
  console.log('='.repeat(60));
  
  await reconAnimeKai();
  await reconHiAnime();
  
  console.log('\n' + '='.repeat(60));
  console.log('RECON COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);
