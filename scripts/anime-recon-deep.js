/**
 * Deep recon - AnimeKai domain change + HiAnime embed extraction
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function fetchJson(url, referer) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': referer || 'https://animekai.to/',
    },
    signal: controller.signal,
  });
  return { status: res.status, text: await res.text(), url: res.url };
}

async function fetchHtml(url, referer) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': referer || url },
    signal: controller.signal,
    redirect: 'follow',
  });
  return { status: res.status, html: await res.text(), finalUrl: res.url };
}

// ============================================================================
// ANIMEKAI DEEP RECON
// ============================================================================

async function deepAnimeKai() {
  console.log('=== ANIMEKAI DEEP RECON ===\n');
  
  // The site redirected to anikai.to - check both domains
  console.log('--- Domain Check ---');
  for (const domain of ['animekai.to', 'anikai.to']) {
    try {
      const { status, html, finalUrl } = await fetchHtml(`https://${domain}/`);
      console.log(`  ${domain}: status=${status} finalUrl=${finalUrl} size=${html.length}`);
    } catch (e) {
      console.log(`  ${domain}: FAILED - ${e.message}`);
    }
  }

  // Check the new domain's AJAX structure
  console.log('\n--- New Domain AJAX ---');
  const newDomain = 'anikai.to';
  
  // Search
  try {
    const { status, text } = await fetchJson(
      `https://${newDomain}/ajax/anime/search?keyword=solo+leveling`,
      `https://${newDomain}/`
    );
    console.log(`  search: status=${status}`);
    try {
      const json = JSON.parse(text);
      console.log(`    Keys: ${Object.keys(json).join(', ')}`);
      if (json.result && typeof json.result === 'object') {
        console.log(`    Result keys: ${Object.keys(json.result).join(', ')}`);
        if (json.result.html) {
          const links = json.result.html.match(/href="[^"]+"/g) || [];
          console.log(`    Links: ${links.slice(0, 3).join(', ')}`);
        }
      }
      if (json.status === false) console.log(`    Message: ${json.message || json.messages}`);
    } catch {
      console.log(`    Raw: ${text.substring(0, 300)}`);
    }
  } catch (e) {
    console.log(`  search: FAILED - ${e.message}`);
  }

  // Try the watch page on new domain
  console.log('\n--- Watch Page (new domain) ---');
  try {
    const { status, html, finalUrl } = await fetchHtml(
      `https://${newDomain}/watch/solo-leveling-93rg`,
      `https://${newDomain}/`
    );
    console.log(`  Status: ${status}, Final URL: ${finalUrl}, Size: ${html.length}`);
    
    // Look for content IDs
    const contentId = html.match(/data-content-id="([^"]+)"/);
    const animeId = html.match(/data-anime-id="([^"]+)"/);
    const kaiId = html.match(/data-kai-id="([^"]+)"/);
    const dataId = html.match(/data-id="([^"]+)"/);
    console.log(`  content-id: ${contentId?.[1] || 'NOT FOUND'}`);
    console.log(`  anime-id: ${animeId?.[1] || 'NOT FOUND'}`);
    console.log(`  kai-id: ${kaiId?.[1] || 'NOT FOUND'}`);
    console.log(`  first data-id: ${dataId?.[1] || 'NOT FOUND'}`);
    
    // Look for the bundle.js to check for crypto changes
    const bundleMatch = html.match(/bundle\.js\?([a-z0-9]+)/);
    console.log(`  Bundle version: ${bundleMatch?.[1] || 'NOT FOUND'}`);
    
    // Look for any inline JS with crypto/encryption
    const inlineScripts = html.match(/<script>([^<]{50,})<\/script>/g) || [];
    console.log(`  Inline scripts: ${inlineScripts.length}`);
    for (const script of inlineScripts.slice(0, 3)) {
      const content = script.replace(/<\/?script>/g, '').substring(0, 200);
      console.log(`    ${content}...`);
    }
    
    // Find all data attributes
    const dataAttrs = html.match(/data-[a-z-]+="[^"]+"/g) || [];
    const uniqueAttrs = [...new Set(dataAttrs.map(a => a.split('=')[0]))];
    console.log(`  Unique data attrs: ${uniqueAttrs.join(', ')}`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }

  // Try episode list with different ID formats
  console.log('\n--- Episode List (new domain) ---');
  // First get the anime page to find the correct ID
  try {
    const { html } = await fetchHtml(`https://${newDomain}/watch/solo-leveling-93rg`);
    
    // Try to find the anime ID in the page
    const allIds = html.match(/data-id="([^"]+)"/g) || [];
    console.log(`  All data-ids on page: ${allIds.join(', ')}`);
    
    // Try the slug-based ID
    const slugMatch = html.match(/\/watch\/([^"?]+)/);
    console.log(`  Slug: ${slugMatch?.[1] || 'NOT FOUND'}`);
    
    // Try various episode endpoints
    const endpoints = [
      `https://${newDomain}/ajax/episodes/list?ani_id=93rg`,
      `https://${newDomain}/ajax/episode/list?id=93rg`,
      `https://${newDomain}/ajax/v2/episode/list/93rg`,
    ];
    
    for (const ep of endpoints) {
      try {
        const { status, text } = await fetchJson(ep, `https://${newDomain}/watch/solo-leveling-93rg`);
        console.log(`  ${ep.split(newDomain)[1]}: status=${status} size=${text.length}`);
        try {
          const json = JSON.parse(text);
          console.log(`    Keys: ${Object.keys(json).join(', ')}`);
          if (json.result && typeof json.result === 'string' && json.result.length > 50) {
            const epTokens = json.result.match(/data-token="([^"]+)"/g) || [];
            const epNums = json.result.match(/data-num="([^"]+)"/g) || [];
            console.log(`    Tokens: ${epTokens.length}, Nums: ${epNums.slice(0, 5).join(', ')}`);
            console.log(`    HTML snippet: ${json.result.substring(0, 300)}`);
          }
        } catch {
          console.log(`    Raw: ${text.substring(0, 200)}`);
        }
      } catch (e) {
        console.log(`  FAILED: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
  }
}

// ============================================================================
// HIANIME DEEP RECON - Full extraction test
// ============================================================================

async function deepHiAnime() {
  console.log('\n\n=== HIANIME DEEP RECON ===\n');
  
  const domain = 'hianime.to';
  
  // Step 1: Get episode ID for Solo Leveling ep 1
  console.log('--- Step 1: Get Episode ID ---');
  let episodeId;
  try {
    const { text } = await fetchJson(
      `https://${domain}/ajax/v2/episode/list/18718`,
      `https://${domain}/watch/solo-leveling-18718`
    );
    const json = JSON.parse(text);
    episodeId = json.html?.match(/data-id="(\d+)"/)?.[1];
    console.log(`  Episode 1 ID: ${episodeId}`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    return;
  }

  // Step 2: Get servers for this episode
  console.log('\n--- Step 2: Get Servers ---');
  let subServerId, dubServerId;
  try {
    const { text } = await fetchJson(
      `https://${domain}/ajax/v2/episode/servers?episodeId=${episodeId}`,
      `https://${domain}/watch/solo-leveling-18718?ep=${episodeId}`
    );
    const json = JSON.parse(text);
    
    // Parse sub and dub servers
    const html = json.html;
    
    // Find sub servers
    const subSection = html.match(/servers-sub[\s\S]*?(?=servers-dub|servers-raw|$)/)?.[0] || '';
    const subIds = subSection.match(/data-id="(\d+)"/g)?.map(m => m.match(/\d+/)[0]) || [];
    
    // Find dub servers
    const dubSection = html.match(/servers-dub[\s\S]*?(?=servers-raw|$)/)?.[0] || '';
    const dubIds = dubSection.match(/data-id="(\d+)"/g)?.map(m => m.match(/\d+/)[0]) || [];
    
    // Get server names
    const serverNameMap = {};
    const serverBlocks = html.match(/<a[^>]*data-id="(\d+)"[^>]*>[\s\S]*?<\/a>/g) || [];
    for (const block of serverBlocks) {
      const id = block.match(/data-id="(\d+)"/)?.[1];
      const name = block.match(/>([^<]+)<\/a>/)?.[1]?.trim() || 
                   block.match(/data-server-id="(\d+)"/)?.[1];
      if (id) serverNameMap[id] = name;
    }
    
    console.log(`  Sub servers: ${subIds.join(', ')}`);
    console.log(`  Dub servers: ${dubIds.join(', ')}`);
    console.log(`  Server names: ${JSON.stringify(serverNameMap)}`);
    
    subServerId = subIds[0];
    dubServerId = dubIds[0];
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    return;
  }

  // Step 3: Get embed URLs for sub and dub
  console.log('\n--- Step 3: Get Embed URLs ---');
  
  for (const [label, serverId] of [['SUB', subServerId], ['DUB', dubServerId]]) {
    if (!serverId) {
      console.log(`  ${label}: No server ID`);
      continue;
    }
    
    try {
      const { text } = await fetchJson(
        `https://${domain}/ajax/v2/episode/sources?id=${serverId}`,
        `https://${domain}/watch/solo-leveling-18718?ep=${episodeId}`
      );
      const json = JSON.parse(text);
      console.log(`  ${label} (server ${serverId}):`);
      console.log(`    Type: ${json.type}`);
      console.log(`    Link: ${json.link}`);
      console.log(`    Server: ${json.server}`);
      
      if (json.tracks) {
        console.log(`    Tracks: ${json.tracks.length}`);
        json.tracks.slice(0, 3).forEach(t => console.log(`      ${t.label}: ${t.file?.substring(0, 80)}`));
      }
      
      // Step 4: Try to extract from the embed URL
      if (json.link) {
        console.log(`\n  --- ${label} Embed Extraction ---`);
        try {
          const embedUrl = json.link;
          const embedDomain = new URL(embedUrl).hostname;
          console.log(`    Embed domain: ${embedDomain}`);
          
          // Fetch the embed page
          const { html: embedHtml } = await fetchHtml(embedUrl, `https://${domain}/`);
          console.log(`    Embed page size: ${embedHtml.length}`);
          
          // Look for source URLs
          const m3u8Match = embedHtml.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
          const sourceMatch = embedHtml.match(/sources?\s*[:=]\s*\[?\s*\{[^}]*url[^}]*\}/);
          const fileMatch = embedHtml.match(/file\s*[:=]\s*["']([^"']+)/);
          
          console.log(`    Direct m3u8: ${m3u8Match?.[0]?.substring(0, 100) || 'NOT FOUND'}`);
          console.log(`    Source object: ${sourceMatch?.[0]?.substring(0, 100) || 'NOT FOUND'}`);
          console.log(`    File: ${fileMatch?.[1]?.substring(0, 100) || 'NOT FOUND'}`);
          
          // Check for encrypted data
          const encryptedData = embedHtml.match(/data-encrypted="([^"]+)"/);
          const cipherText = embedHtml.match(/ciphertext\s*[:=]\s*["']([^"']+)/);
          console.log(`    Encrypted data: ${encryptedData ? 'YES (' + encryptedData[1].substring(0, 50) + '...)' : 'NO'}`);
          console.log(`    Cipher text: ${cipherText ? 'YES' : 'NO'}`);
          
          // Look for API calls in scripts
          const apiCalls = embedHtml.match(/\/ajax\/[^"'\s]+/g) || [];
          console.log(`    API calls in embed: ${[...new Set(apiCalls)].join(', ')}`);
          
          // Look for script sources
          const embedScripts = embedHtml.match(/src="([^"]+\.js[^"]*)"/g) || [];
          console.log(`    Scripts: ${embedScripts.length}`);
          embedScripts.forEach(s => console.log(`      ${s}`));
          
          // Check for known embed patterns (megacloud, rapid-cloud, etc.)
          if (embedDomain.includes('megacloud') || embedDomain.includes('rapid-cloud')) {
            // Try the sources API
            const embedId = embedUrl.match(/\/e(?:mbed)?(?:-\d)?\/(?:v\d\/)?(?:e-\d\/)?([a-zA-Z0-9]+)/)?.[1];
            console.log(`    Embed ID: ${embedId}`);
            
            if (embedId) {
              // Try various source endpoints
              const sourceEndpoints = [
                `https://${embedDomain}/ajax/embed-6/getSources?id=${embedId}`,
                `https://${embedDomain}/ajax/embed-6-v2/getSources?id=${embedId}`,
                `https://${embedDomain}/embed-2/ajax/e-1/getSources?id=${embedId}`,
              ];
              
              for (const srcUrl of sourceEndpoints) {
                try {
                  const { status, text: srcText } = await fetchJson(srcUrl, embedUrl);
                  console.log(`    ${srcUrl.split(embedDomain)[1]}: status=${status}`);
                  if (status === 200) {
                    try {
                      const srcJson = JSON.parse(srcText);
                      console.log(`      Keys: ${Object.keys(srcJson).join(', ')}`);
                      if (srcJson.sources) {
                        console.log(`      Sources type: ${typeof srcJson.sources}`);
                        if (typeof srcJson.sources === 'string') {
                          console.log(`      Encrypted sources (${srcJson.sources.length} chars): ${srcJson.sources.substring(0, 80)}...`);
                        } else if (Array.isArray(srcJson.sources)) {
                          srcJson.sources.forEach(s => console.log(`      Source: ${JSON.stringify(s).substring(0, 150)}`));
                        }
                      }
                      if (srcJson.encrypted !== undefined) console.log(`      Encrypted flag: ${srcJson.encrypted}`);
                      if (srcJson.tracks) console.log(`      Tracks: ${srcJson.tracks.length}`);
                      if (srcJson.intro) console.log(`      Intro: ${JSON.stringify(srcJson.intro)}`);
                      if (srcJson.outro) console.log(`      Outro: ${JSON.stringify(srcJson.outro)}`);
                    } catch {
                      console.log(`      Raw: ${srcText.substring(0, 200)}`);
                    }
                  }
                } catch (e) {
                  console.log(`    FAILED: ${e.message}`);
                }
              }
            }
          }
        } catch (e) {
          console.log(`    Embed extraction FAILED: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`  ${label}: FAILED - ${e.message}`);
    }
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('ANIME DEEP RECON');
  console.log('Time:', new Date().toISOString());
  console.log('='.repeat(60));
  
  await deepAnimeKai();
  await deepHiAnime();
  
  console.log('\n' + '='.repeat(60));
  console.log('DEEP RECON COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);
