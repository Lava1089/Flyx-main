/**
 * HiAnime + MegaCloud extraction test
 * Tests the full pipeline: search → episodes → servers → sources → MegaCloud extraction
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function fetchJson(url, referer, extraHeaders = {}) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 15000);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': referer || url, ...extraHeaders },
    signal: controller.signal,
  });
  return { status: res.status, text: await res.text(), headers: Object.fromEntries(res.headers.entries()) };
}

async function fetchHtml(url, referer) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 15000);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': referer || url },
    signal: controller.signal,
    redirect: 'follow',
  });
  return { status: res.status, html: await res.text(), finalUrl: res.url };
}

async function main() {
  const domain = 'hianime.to';
  const animeId = 18718; // Solo Leveling
  
  console.log('=== HIANIME FULL PIPELINE TEST ===\n');
  
  // Step 1: Get episodes
  console.log('--- Step 1: Get Episodes ---');
  const epRes = await fetchJson(
    `https://${domain}/ajax/v2/episode/list/${animeId}`,
    `https://${domain}/watch/solo-leveling-${animeId}`
  );
  const epJson = JSON.parse(epRes.text);
  
  // Parse episodes
  const epMatches = epJson.html.match(/data-id="(\d+)"[^>]*data-number="(\d+)"/g) || [];
  const episodes = [];
  for (const m of epMatches) {
    const id = m.match(/data-id="(\d+)"/)?.[1];
    const num = m.match(/data-number="(\d+)"/)?.[1];
    if (id && num) episodes.push({ id, num });
  }
  // Also try reverse order
  const epMatches2 = epJson.html.match(/data-number="(\d+)"[^>]*data-id="(\d+)"/g) || [];
  for (const m of epMatches2) {
    const num = m.match(/data-number="(\d+)"/)?.[1];
    const id = m.match(/data-id="(\d+)"/)?.[1];
    if (id && num && !episodes.find(e => e.id === id)) episodes.push({ id, num });
  }
  
  console.log(`  Found ${episodes.length} episodes`);
  if (episodes.length > 0) {
    console.log(`  First: ep${episodes[0].num} (id: ${episodes[0].id})`);
    console.log(`  Last: ep${episodes[episodes.length-1].num} (id: ${episodes[episodes.length-1].id})`);
  }
  
  if (episodes.length === 0) {
    console.log('  No episodes found, aborting');
    return;
  }
  
  // Step 2: Get servers for episode 1
  const ep1 = episodes[0];
  console.log(`\n--- Step 2: Get Servers for Episode ${ep1.num} ---`);
  const serverRes = await fetchJson(
    `https://${domain}/ajax/v2/episode/servers?episodeId=${ep1.id}`,
    `https://${domain}/watch/solo-leveling-${animeId}?ep=${ep1.id}`
  );
  const serverJson = JSON.parse(serverRes.text);
  
  // Parse servers by type
  const serverHtml = serverJson.html;
  const servers = { sub: [], dub: [], raw: [] };
  
  // Parse each server type section
  for (const type of ['sub', 'dub', 'raw']) {
    const sectionRegex = new RegExp(`servers-${type}[\\s\\S]*?(?=servers-(?:sub|dub|raw)|$)`, 'i');
    const section = serverHtml.match(sectionRegex)?.[0] || '';
    const serverMatches = section.match(/<a[^>]*data-id="(\d+)"[^>]*data-server-id="(\d+)"[^>]*>/g) || [];
    for (const sm of serverMatches) {
      const id = sm.match(/data-id="(\d+)"/)?.[1];
      const serverId = sm.match(/data-server-id="(\d+)"/)?.[1];
      if (id) servers[type].push({ id, serverId });
    }
  }
  
  console.log(`  Sub servers: ${servers.sub.length} (${servers.sub.map(s => `${s.id}:srv${s.serverId}`).join(', ')})`);
  console.log(`  Dub servers: ${servers.dub.length} (${servers.dub.map(s => `${s.id}:srv${s.serverId}`).join(', ')})`);
  console.log(`  Raw servers: ${servers.raw.length}`);
  
  // Step 3: Get embed URLs for each server
  console.log('\n--- Step 3: Get Embed URLs ---');
  const allServers = [
    ...servers.sub.map(s => ({ ...s, type: 'sub' })),
    ...servers.dub.map(s => ({ ...s, type: 'dub' })),
  ];
  
  for (const server of allServers.slice(0, 6)) {
    try {
      const srcRes = await fetchJson(
        `https://${domain}/ajax/v2/episode/sources?id=${server.id}`,
        `https://${domain}/watch/solo-leveling-${animeId}?ep=${ep1.id}`
      );
      const srcJson = JSON.parse(srcRes.text);
      console.log(`  ${server.type} server ${server.id} (srv${server.serverId}): type=${srcJson.type} server=${srcJson.server}`);
      console.log(`    Link: ${srcJson.link}`);
      
      // Step 4: Try to extract from MegaCloud embed
      if (srcJson.link && srcJson.link.includes('megacloud')) {
        const embedUrl = srcJson.link;
        const embedDomain = new URL(embedUrl).hostname;
        const embedPath = new URL(embedUrl).pathname;
        
        // Extract the embed ID
        const embedId = embedPath.match(/\/e(?:mbed)?(?:-\d)?\/(?:v\d\/)?(?:e-\d\/)?([a-zA-Z0-9]+)/)?.[1];
        console.log(`    Embed domain: ${embedDomain}, ID: ${embedId}`);
        
        if (embedId) {
          // Try various getSources endpoints
          const endpoints = [
            `/embed-2/ajax/e-1/getSources?id=${embedId}`,
            `/embed-2/ajax/e-1/getSources?id=${embedId}&v=3`,
            `/ajax/embed/getSources?id=${embedId}`,
            `/embed-2/v3/ajax/e-1/getSources?id=${embedId}`,
          ];
          
          for (const ep of endpoints) {
            try {
              const { status, text } = await fetchJson(
                `https://${embedDomain}${ep}`,
                embedUrl,
                { 'X-Requested-With': 'XMLHttpRequest' }
              );
              if (status === 200 && text.length > 10) {
                try {
                  const json = JSON.parse(text);
                  console.log(`    ✅ ${ep.split('?')[0]}: status=${status}`);
                  console.log(`      Keys: ${Object.keys(json).join(', ')}`);
                  if (json.sources) {
                    if (typeof json.sources === 'string') {
                      console.log(`      Sources: ENCRYPTED (${json.sources.length} chars)`);
                      console.log(`      First 80: ${json.sources.substring(0, 80)}...`);
                    } else if (Array.isArray(json.sources)) {
                      json.sources.forEach(s => console.log(`      Source: ${JSON.stringify(s).substring(0, 150)}`));
                    }
                  }
                  if (json.encrypted !== undefined) console.log(`      Encrypted: ${json.encrypted}`);
                  if (json.tracks) console.log(`      Tracks: ${json.tracks.length}`);
                  if (json.intro) console.log(`      Intro: ${JSON.stringify(json.intro)}`);
                  if (json.outro) console.log(`      Outro: ${JSON.stringify(json.outro)}`);
                  break; // Found working endpoint
                } catch {
                  console.log(`    ${ep.split('?')[0]}: status=${status} (not JSON)`);
                }
              } else {
                console.log(`    ❌ ${ep.split('?')[0]}: status=${status}`);
              }
            } catch (e) {
              console.log(`    ❌ ${ep.split('?')[0]}: ${e.message}`);
            }
          }
        }
      }
    } catch (e) {
      console.log(`  ${server.type} server ${server.id}: FAILED - ${e.message}`);
    }
  }
  
  // Step 5: Also try fetching the embed page directly to look for inline sources
  console.log('\n--- Step 5: Embed Page Analysis ---');
  if (allServers.length > 0) {
    try {
      const srcRes = await fetchJson(
        `https://${domain}/ajax/v2/episode/sources?id=${allServers[0].id}`,
        `https://${domain}/watch/solo-leveling-${animeId}?ep=${ep1.id}`
      );
      const srcJson = JSON.parse(srcRes.text);
      
      if (srcJson.link) {
        const { html: embedHtml } = await fetchHtml(srcJson.link, `https://${domain}/`);
        console.log(`  Embed page size: ${embedHtml.length}`);
        
        // Look for script tags
        const scripts = embedHtml.match(/<script[^>]*src="([^"]+)"[^>]*>/g) || [];
        console.log(`  Scripts: ${scripts.length}`);
        scripts.forEach(s => {
          const src = s.match(/src="([^"]+)"/)?.[1];
          if (src) console.log(`    ${src}`);
        });
        
        // Look for inline data
        const dataMatch = embedHtml.match(/data-encrypted="([^"]+)"/);
        if (dataMatch) console.log(`  Encrypted data attr: ${dataMatch[1].substring(0, 60)}...`);
        
        // Look for window variables
        const windowVars = embedHtml.match(/window\.\w+\s*=\s*["'][^"']+["']/g) || [];
        console.log(`  Window vars: ${windowVars.length}`);
        windowVars.forEach(v => console.log(`    ${v.substring(0, 100)}`));
        
        // Look for any JSON data
        const jsonBlocks = embedHtml.match(/<script[^>]*>[\s\S]*?({[\s\S]*?})[\s\S]*?<\/script>/g) || [];
        console.log(`  Script blocks with JSON: ${jsonBlocks.length}`);
      }
    } catch (e) {
      console.log(`  FAILED: ${e.message}`);
    }
  }
  
  console.log('\n=== TEST COMPLETE ===');
}

main().catch(console.error);
