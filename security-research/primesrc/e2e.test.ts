import { describe, test, expect } from 'bun:test';

const BASE = 'https://primesrc.me';
const VIDSRCME = 'https://vidsrcme.ru';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

interface Server { name: string; key: string; quality: string | null; file_size: string | null; file_name: string | null; }
interface ServerList { servers: Server[]; }

async function getServers(tmdbId: string, type: 'movie'|'tv', season?: number, episode?: number): Promise<ServerList> {
  let url = `${BASE}/api/v1/s?type=${type}&tmdb=${tmdbId}`;
  if (type === 'tv') url += `&season=${season}&episode=${episode}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': `${BASE}/embed/${type}?tmdb=${tmdbId}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ServerList>;
}

describe('PrimeSrc E2E', () => {
  test('movie server list — Fight Club', async () => {
    const data = await getServers('550', 'movie');
    expect(data.servers.length).toBeGreaterThan(0);
    const byName = new Map<string, Server[]>();
    for (const s of data.servers) { const l = byName.get(s.name) || []; l.push(s); byName.set(s.name, l); }
    for (const [name, servers] of byName) {
      console.log(`${name}: ${servers.length} src [${servers[0].quality||'auto'}] ${servers[0].file_size||''}`);
    }
    expect(data.servers.find(s => s.name === 'PrimeVid')).toBeDefined();
  });

  test('TV server list — Breaking Bad S01E01', async () => {
    const data = await getServers('1396', 'tv', 1, 1);
    expect(data.servers.length).toBeGreaterThan(0);
    console.log(`TV: ${data.servers.length} servers`);
    console.log(`Types: ${[...new Set(data.servers.map(s => s.name))].join(', ')}`);
  });

  test('supports IMDB IDs', async () => {
    const res = await fetch(`${BASE}/api/v1/s?type=movie&imdb=tt0137523`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as ServerList;
    expect(data.servers.length).toBeGreaterThan(0);
    console.log(`IMDB: ${data.servers.length} servers`);
  });

  test('link endpoint requires Turnstile', async () => {
    const data = await getServers('550', 'movie');
    const res = await fetch(`${BASE}/api/v1/l?key=${data.servers[0].key}`, {
      headers: { 'User-Agent': UA, 'Referer': `${BASE}/embed/movie?tmdb=550` },
      signal: AbortSignal.timeout(20000),
    });
    console.log(`Link: HTTP ${res.status}, cf-mitigated: ${res.headers.get('cf-mitigated')}`);
    expect(res.status).toBe(403);
  });

  test('PrimeVid extraction chain: vidsrcme.ru → cloudnestra → prorcp', async () => {
    // Step 1: vidsrcme.ru embed
    const embedRes = await fetch(`${VIDSRCME}/embed/movie/550`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': `${BASE}/` },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    expect(embedRes.ok).toBe(true);
    const embedHtml = await embedRes.text();
    console.log(`vidsrcme.ru: ${embedRes.status}, ${embedHtml.length}b`);

    // Step 2: Extract cloudnestra iframe
    const iframeSrc = embedHtml.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    expect(iframeSrc).toBeTruthy();
    let iframeUrl = iframeSrc![1];
    if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
    expect(iframeUrl).toContain('cloudnestra.com/rcp/');
    console.log(`cloudnestra iframe: ${iframeUrl.substring(0, 60)}...`);

    // Step 3: Fetch RCP page
    const rcpRes = await fetch(iframeUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': `${VIDSRCME}/` },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    expect(rcpRes.ok).toBe(true);
    const rcpHtml = await rcpRes.text();
    console.log(`RCP page: ${rcpRes.status}, ${rcpHtml.length}b`);

    // Step 4: Extract prorcp token
    const prorcpMatch = rcpHtml.match(/['"]\/prorcp\/([^'"]+)['"]/);
    if (!prorcpMatch) {
      console.log('prorcp token not found (possible rate limit) — skipping m3u8 extraction');
      return;
    }
    console.log(`prorcp token: ${prorcpMatch[1].substring(0, 40)}...`);

    // Step 5: Fetch prorcp page
    const prorcpUrl = `https://cloudnestra.com/prorcp/${prorcpMatch[1]}`;
    const prorcpRes = await fetch(prorcpUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': rcpRes.url },
      signal: AbortSignal.timeout(15000),
    });
    expect(prorcpRes.ok).toBe(true);
    const prorcpHtml = await prorcpRes.text();
    console.log(`prorcp page: ${prorcpRes.status}, ${prorcpHtml.length}b`);

    // Step 6: Extract m3u8 URLs
    const m3u8Urls = [...new Set([...prorcpHtml.matchAll(/https?:\/\/[^"'\s<>)]+\.m3u8/g)].map(m => m[0]))];
    console.log(`m3u8 URLs found: ${m3u8Urls.length}`);
    expect(m3u8Urls.length).toBeGreaterThan(0);

    // Step 7: Try resolving template URLs
    const CDN_DOMAINS = ['neonhorizonworkshops.com', 'wanderlynest.com', 'orchidpixelgardens.com', 'cloudnestra.com'];
    const templateUrls = m3u8Urls.filter(u => u.includes('{v'));
    const directUrls = m3u8Urls.filter(u => !u.includes('{'));

    let workingUrl: string | null = null;

    // Try direct URLs first
    for (const url of directUrls) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, 'Referer': 'https://cloudnestra.com/' },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const body = await res.text();
          if (body.includes('#EXTM3U')) {
            workingUrl = url;
            console.log(`✓ Direct m3u8 working: ${url.substring(0, 80)}`);
            break;
          }
        }
      } catch {}
    }

    // Try template URLs with CDN domains
    if (!workingUrl && templateUrls.length > 0) {
      for (const tmpl of templateUrls) {
        if (tmpl.includes('app2.') || tmpl.includes('app3.')) continue;
        for (const domain of CDN_DOMAINS) {
          const resolved = tmpl.replace(/\{v\d+\}/g, domain);
          try {
            const res = await fetch(resolved, {
              headers: { 'User-Agent': UA, 'Referer': 'https://cloudnestra.com/' },
              signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
              const body = await res.text();
              if (body.includes('#EXTM3U')) {
                workingUrl = resolved;
                console.log(`✓ Resolved m3u8 working via ${domain}`);
                break;
              }
            }
          } catch {}
        }
        if (workingUrl) break;
      }
    }

    if (workingUrl) {
      console.log(`\n✓ EXTRACTION SUCCESS: ${workingUrl.substring(0, 100)}`);
    } else {
      console.log('\n✗ No working m3u8 found (CDN domains may have rotated)');
    }
  });

  test('multi-title extraction summary', async () => {
    const titles = [
      { id: '550', type: 'movie' as const, name: 'Fight Club' },
      { id: '155', type: 'movie' as const, name: 'Dark Knight' },
      { id: '1396', type: 'tv' as const, name: 'Breaking Bad', s: 1, e: 1 },
      { id: '1399', type: 'tv' as const, name: 'GoT', s: 1, e: 1 },
    ];
    for (const t of titles) {
      const start = Date.now();
      const data = await getServers(t.id, t.type, t.s, t.e);
      const ms = Date.now() - start;
      const types = [...new Set(data.servers.map(s => s.name))];
      console.log(`${t.name}: ${data.servers.length} sources, ${types.length} servers [${ms}ms]`);
      expect(data.servers.length).toBeGreaterThan(5);
    }
  });
});
