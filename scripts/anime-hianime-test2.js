/**
 * HiAnime server + MegaCloud extraction test (debug version)
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function fetchJson(url, referer, extraHeaders = {}) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 15000);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': referer || url, ...extraHeaders },
    signal: controller.signal,
  });
  return { status: res.status, text: await res.text() };
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
  const animeId = 18718;
  const episodeId = '114721';
  
  console.log('=== HIANIME SERVER + MEGACLOUD TEST ===\n');
  
  // Get servers - dump raw HTML for debugging
  console.log('--- Servers HTML Debug ---');
  const serverRes = await fetchJson(
    `https://${domain}/ajax/v2/episode/servers?episodeId=${episodeId}`,
    `https://${domain}/watch/solo-leveling-${animeId}?ep=${episodeId}`
  );
  const serverJson = JSON.parse(serverRes.text);
  const html = serverJson.html;
  
  // Show first 2000 chars of HTML
  console.log('HTML (first 2000 chars):');
  console.log(html.substring(0, 2000));
  console.log('...\n');
  
  // Parse all data-id attributes
  const allDataIds = html.match(/data-id="[^"]+"/g) || [];
  console.log(`All data-id: ${allDataIds.join(', ')}`);
  
  // Parse all data-server-id attributes
  const allServerIds = html.match(/data-server-id="[^"]+"/g) || [];
  console.log(`All data-server-id: ${allServerIds.join(', ')}`);
  
  // Parse all data-type attributes
  const allTypes = html.match(/data-type="[^"]+"/g) || [];
  console.log(`All data-type: ${allTypes.join(', ')}`);
  
  // Try to find server links with all attributes
  const serverLinks = html.match(/<a[^>]*class="[^"]*server-item[^"]*"[^>]*>/g) || [];
  console.log(`\nServer links: ${serverLinks.length}`);
  serverLinks.forEach((link, i) => {
    console.log(`  ${i}: ${link}`);
  });
  
  // Alternative: find all <a> tags with data-id
  const allLinks = html.match(/<a[^>]*data-id="[^"]*"[^>]*>/g) || [];
  console.log(`\nAll <a> with data-id: ${allLinks.length}`);
  allLinks.forEach((link, i) => {
    const id = link.match(/data-id="([^"]+)"/)?.[1];
    const type = link.match(/data-type="([^"]+)"/)?.[1];
    const serverId = link.match(/data-server-id="([^"]+)"/)?.[1];
    console.log(`  ${i}: id=${id} type=${type} serverId=${serverId}`);
  });
  
  // Now test getting sources for each server
  console.log('\n--- Getting Sources ---');
  for (const link of allLinks.slice(0, 8)) {
    const id = link.match(/data-id="([^"]+)"/)?.[1];
    const type = link.match(/data-type="([^"]+)"/)?.[1];
    const serverId = link.match(/data-server-id="([^"]+)"/)?.[1];
    
    if (!id) continue;
    
    try {
      const srcRes = await fetchJson(
        `https://${domain}/ajax/v2/episode/sources?id=${id}`,
        `https://${domain}/watch/solo-leveling-${animeId}?ep=${episodeId}`
      );
      const srcJson = JSON.parse(srcRes.text);
      console.log(`\n  ${type} srv${serverId} (id=${id}):`);
      console.log(`    type: ${srcJson.type}`);
      console.log(`    link: ${srcJson.link}`);
      console.log(`    server: ${srcJson.server}`);
      
      // If it's a megacloud link, try getSources
      if (srcJson.link && srcJson.link.includes('megacloud')) {
        const embedUrl = srcJson.link;
        const embedDomain = new URL(embedUrl).hostname;
        const embedPath = new URL(embedUrl).pathname;
        
        // Parse the embed ID from various URL formats
        // e.g., /embed-2/v3/e-1/zqAeB6Od5pJp?k=1
        const pathParts = embedPath.split('/').filter(Boolean);
        const embedId = pathParts[pathParts.length - 1]; // Last path segment
        console.log(`    embedDomain: ${embedDomain}`);
        console.log(`    embedPath: ${embedPath}`);
        console.log(`    embedId: ${embedId}`);
        
        // Try getSources endpoints
        const endpoints = [
          `/embed-2/ajax/e-1/getSources?id=${embedId}`,
          `/embed-2/ajax/e-1/getSources?id=${embedId}&v=3`,
        ];
        
        for (const ep of endpoints) {
          try {
            const { status, text } = await fetchJson(
              `https://${embedDomain}${ep}`,
              embedUrl,
              { 'X-Requested-With': 'XMLHttpRequest' }
            );
            console.log(`    ${ep}: status=${status} size=${text.length}`);
            if (status === 200 && text.length > 10) {
              try {
                const json = JSON.parse(text);
                console.log(`      Keys: ${Object.keys(json).join(', ')}`);
                if (json.sources) {
                  if (typeof json.sources === 'string') {
                    console.log(`      Sources: ENCRYPTED (${json.sources.length} chars)`);
                    console.log(`      Preview: ${json.sources.substring(0, 100)}...`);
                  } else if (Array.isArray(json.sources)) {
                    json.sources.forEach(s => console.log(`      Source: ${JSON.stringify(s)}`));
                  }
                }
                if (json.encrypted !== undefined) console.log(`      Encrypted: ${json.encrypted}`);
                if (json.tracks) console.log(`      Tracks: ${json.tracks.length}`);
                if (json.intro) console.log(`      Intro: ${JSON.stringify(json.intro)}`);
                if (json.outro) console.log(`      Outro: ${JSON.stringify(json.outro)}`);
                if (json.server) console.log(`      Server: ${json.server}`);
                break;
              } catch {
                console.log(`      Not JSON: ${text.substring(0, 200)}`);
              }
            }
          } catch (e) {
            console.log(`    ${ep}: FAILED - ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.log(`  ${type} srv${serverId} (id=${id}): FAILED - ${e.message}`);
    }
  }
  
  console.log('\n=== TEST COMPLETE ===');
}

main().catch(console.error);
