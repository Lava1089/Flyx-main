/**
 * HiAnime + MegaCloud extraction test (fixed parsing)
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
  
  console.log('=== HIANIME + MEGACLOUD EXTRACTION TEST ===\n');
  
  // Get servers
  const serverRes = await fetchJson(
    `https://${domain}/ajax/v2/episode/servers?episodeId=${episodeId}`,
    `https://${domain}/watch/solo-leveling-${animeId}?ep=${episodeId}`
  );
  const serverJson = JSON.parse(serverRes.text);
  const html = serverJson.html;
  
  // Parse servers from <div> elements
  const serverDivs = html.match(/<div[^>]*class="[^"]*server-item[^"]*"[^>]*>/g) || [];
  const servers = [];
  for (const div of serverDivs) {
    const id = div.match(/data-id="(\d+)"/)?.[1];
    const type = div.match(/data-type="(sub|dub|raw)"/)?.[1];
    const serverId = div.match(/data-server-id="(\d+)"/)?.[1];
    if (id && type) servers.push({ id, type, serverId });
  }
  
  console.log(`Found ${servers.length} servers:`);
  servers.forEach(s => console.log(`  ${s.type} id=${s.id} serverId=${s.serverId}`));
  
  // Get sources for each server
  console.log('\n--- Getting Sources + MegaCloud Extraction ---');
  
  for (const server of servers) {
    try {
      const srcRes = await fetchJson(
        `https://${domain}/ajax/v2/episode/sources?id=${server.id}`,
        `https://${domain}/watch/solo-leveling-${animeId}?ep=${episodeId}`
      );
      const srcJson = JSON.parse(srcRes.text);
      console.log(`\n${server.type.toUpperCase()} srv${server.serverId} (id=${server.id}):`);
      console.log(`  type: ${srcJson.type}, server: ${srcJson.server}`);
      console.log(`  link: ${srcJson.link}`);
      
      if (!srcJson.link) continue;
      
      const embedUrl = srcJson.link;
      const embedDomain = new URL(embedUrl).hostname;
      const embedPath = new URL(embedUrl).pathname;
      
      // Parse embed ID - last path segment before query
      const pathParts = embedPath.split('/').filter(Boolean);
      const embedId = pathParts[pathParts.length - 1];
      console.log(`  embedDomain: ${embedDomain}, embedId: ${embedId}`);
      
      // Try getSources
      const getSrcUrl = `https://${embedDomain}/embed-2/ajax/e-1/getSources?id=${embedId}`;
      console.log(`  Trying: ${getSrcUrl}`);
      
      const { status, text } = await fetchJson(getSrcUrl, embedUrl);
      console.log(`  Status: ${status}, Size: ${text.length}`);
      
      if (status === 200 && text.length > 10) {
        try {
          const json = JSON.parse(text);
          console.log(`  Keys: ${Object.keys(json).join(', ')}`);
          
          if (json.sources) {
            if (typeof json.sources === 'string') {
              console.log(`  ✅ Sources: ENCRYPTED (${json.sources.length} chars)`);
              console.log(`  Preview: ${json.sources.substring(0, 120)}...`);
            } else if (Array.isArray(json.sources)) {
              console.log(`  ✅ Sources: ARRAY (${json.sources.length} items)`);
              json.sources.forEach(s => console.log(`    ${JSON.stringify(s)}`));
            }
          }
          if (json.encrypted !== undefined) console.log(`  Encrypted flag: ${json.encrypted}`);
          if (json.tracks) {
            console.log(`  Tracks: ${json.tracks.length}`);
            json.tracks.slice(0, 3).forEach(t => console.log(`    ${t.label || t.kind}: ${(t.file || '').substring(0, 80)}`));
          }
          if (json.intro) console.log(`  Intro: ${JSON.stringify(json.intro)}`);
          if (json.outro) console.log(`  Outro: ${JSON.stringify(json.outro)}`);
          if (json.server) console.log(`  Server: ${json.server}`);
        } catch {
          console.log(`  Not JSON: ${text.substring(0, 200)}`);
        }
      }
    } catch (e) {
      console.log(`  FAILED: ${e.message}`);
    }
  }
  
  console.log('\n=== TEST COMPLETE ===');
}

main().catch(console.error);
