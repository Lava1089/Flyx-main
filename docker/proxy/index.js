/**
 * Flyx Local Stream Proxy - All-in-One
 * Replaces Cloudflare Workers + RPI Proxy for self-hosted Docker deployment.
 * 
 * Since Docker runs on the user's home network (residential IP), we don't need
 * the RPI residential proxy — direct fetch works for most CDNs.
 * 
 * Routes:
 *   /stream?url=<url>                    - Generic HLS stream proxy
 *   /flixer/extract?tmdbId=X&type=Y...   - Flixer WASM extraction
 *   /vidsrc/extract?tmdbId=X&type=Y...   - VidSrc 2embed API extraction
 *   /vidsrc/stream?url=<url>             - VidSrc stream proxy
 *   /hianime/extract?malId=X&title=Y...  - HiAnime full pipeline
 *   /hianime/stream?url=<url>            - HiAnime stream proxy
 *   /animekai?url=<url>                  - AnimeKai/MegaUp CDN proxy
 *   /tmdb/*                              - TMDB API proxy
 *   /analytics/*                         - Analytics sink (no-op)
 *   /health                              - Health check
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, X-Request-ID, Authorization',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  'Access-Control-Max-Age': '86400',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const metrics = { requests: 0, errors: 0, startTime: Date.now() };

function jsonRes(data, status = 200) {
  return { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify(data) };
}

function sendResponse(res, { status = 200, headers = {}, body = '' }) {
  res.writeHead(status, headers);
  res.end(body);
}

// ============================================================================
// HTTP Fetch Utility (works with both http and https)
// ============================================================================

function nodeFetch(targetUrl, reqHeaders = {}, method = 'GET', timeout = 20000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    const headers = { 'User-Agent': UA, ...reqHeaders };
    delete headers['host']; delete headers['Host'];

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
    };

    const req = mod.request(options, (proxyRes) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        const redirectUrl = new URL(proxyRes.headers.location, targetUrl).toString();
        return nodeFetch(redirectUrl, reqHeaders, method, timeout).then(resolve).catch(reject);
      }
      const chunks = [];
      proxyRes.on('data', (chunk) => chunks.push(chunk));
      proxyRes.on('end', () => {
        resolve({ status: proxyRes.statusCode, headers: proxyRes.headers, body: Buffer.concat(chunks) });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function fetchText(url, headers = {}) {
  const r = await nodeFetch(url, headers);
  return { status: r.status, text: r.body.toString('utf-8'), headers: r.headers };
}

async function fetchJson(url, headers = {}) {
  const r = await fetchText(url, headers);
  return { status: r.status, data: JSON.parse(r.text), headers: r.headers };
}

// ============================================================================
// M3U8 Rewriting
// ============================================================================

function rewriteM3U8(content, baseUrl, proxyBase, route) {
  return content.split('\n').map(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      if (t.includes('URI="')) {
        return t.replace(/URI="([^"]+)"/, (_, uri) => {
          const abs = uri.startsWith('http') ? uri : new URL(uri, baseUrl).toString();
          return `URI="${proxyBase}/${route}/stream?url=${encodeURIComponent(abs)}"`;
        });
      }
      return line;
    }
    const abs = t.startsWith('http') ? t : new URL(t, baseUrl).toString();
    return `${proxyBase}/${route}/stream?url=${encodeURIComponent(abs)}`;
  }).join('\n');
}

// ============================================================================
// Generic Stream Proxy (used by /stream, /animekai, /cdn-live, etc.)
// ============================================================================

async function handleStreamProxy(query, reqHeaders, proxyBase, route) {
  const targetUrl = query.get('url');
  const referer = query.get('referer') || '';
  const noReferer = query.get('noreferer') === 'true';
  if (!targetUrl) return jsonRes({ error: 'Missing url parameter' }, 400);

  try {
    const hdrs = {};
    if (reqHeaders['range']) hdrs['Range'] = reqHeaders['range'];
    if (referer && !noReferer) { hdrs['Referer'] = referer; hdrs['Origin'] = new URL(referer).origin; }
    
    const result = await nodeFetch(targetUrl, hdrs);
    const ct = result.headers['content-type'] || '';
    const rh = { ...CORS_HEADERS };
    if (result.headers['content-type']) rh['Content-Type'] = result.headers['content-type'];
    if (result.headers['content-length']) rh['Content-Length'] = result.headers['content-length'];
    if (result.headers['content-range']) rh['Content-Range'] = result.headers['content-range'];
    if (result.headers['accept-ranges']) rh['Accept-Ranges'] = result.headers['accept-ranges'];

    let body = result.body;
    if (ct.includes('mpegurl') || ct.includes('m3u8') || targetUrl.includes('.m3u8')) {
      const text = body.toString('utf-8');
      const base = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      body = Buffer.from(rewriteM3U8(text, base, proxyBase, route));
      rh['Content-Type'] = 'application/vnd.apple.mpegurl';
      rh['Content-Length'] = String(body.length);
    }
    return { status: result.status, headers: rh, body };
  } catch (err) {
    metrics.errors++;
    return jsonRes({ error: `${route} proxy error`, message: err.message }, 502);
  }
}

// ============================================================================
// TMDB Proxy — translates custom routes to TMDB API v3 paths
// Mirrors cloudflare-proxy/src/tmdb-proxy.ts
// ============================================================================

async function tmdbFetch(endpoint, extraParams = {}) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  url.searchParams.set('language', 'en-US');
  if (TMDB_API_KEY.startsWith('ey')) {
    // Bearer token — don't add api_key param
  } else {
    url.searchParams.set('api_key', TMDB_API_KEY);
  }
  for (const [k, v] of Object.entries(extraParams)) { if (v) url.searchParams.set(k, v); }
  const headers = {};
  if (TMDB_API_KEY.startsWith('ey')) headers['Authorization'] = `Bearer ${TMDB_API_KEY}`;
  const r = await nodeFetch(url.toString(), headers);
  return { ok: r.status >= 200 && r.status < 300, data: JSON.parse(r.body.toString('utf-8')), status: r.status };
}

function tmdbJson(data, status = 200, cacheSec = 300) {
  return { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cacheSec}`, ...CORS_HEADERS }, body: JSON.stringify(data) };
}

async function handleTMDBProxy(pathname, query) {
  if (!TMDB_API_KEY) return jsonRes({ error: 'TMDB API key not configured' }, 500);
  const route = pathname.replace(/^\/tmdb\/?/, '').replace(/\/$/, '') || '';

  try {
    if (route === 'health' || route === '') {
      return tmdbJson({ status: 'healthy', hasApiKey: true });
    }
    if (route === 'search') {
      const q = query.get('query'), type = query.get('type') || 'multi', page = query.get('page') || '1';
      if (!q) return jsonRes({ error: 'Missing query parameter' }, 400);
      const ep = type === 'multi' ? '/search/multi' : `/search/${type}`;
      const r = await tmdbFetch(ep, { query: q, page });
      if (!r.ok) return tmdbJson({ error: `TMDB error: ${r.status}`, results: [] }, r.status);
      const results = (r.data.results || []).map(i => ({ ...i, media_type: i.media_type || type, mediaType: i.media_type || type }));
      return tmdbJson({ ...r.data, results }, 200, 300);
    }
    if (route === 'trending') {
      const type = query.get('type') || 'all', time = query.get('time') || 'week', page = query.get('page') || '1';
      const r = await tmdbFetch(`/trending/${type}/${time}`, { page });
      if (!r.ok) return tmdbJson({ error: `TMDB error: ${r.status}`, results: [] }, r.status);
      return tmdbJson(r.data, 200, 600);
    }
    if (route === 'details') {
      const id = query.get('id'), type = query.get('type') || 'movie';
      if (!id) return jsonRes({ error: 'Missing id parameter' }, 400);
      const r = await tmdbFetch(`/${type}/${id}`, { append_to_response: 'credits,videos,external_ids,content_ratings,release_dates' });
      if (!r.ok) return tmdbJson({ error: `TMDB error: ${r.status}` }, r.status);
      return tmdbJson({ ...r.data, media_type: type, mediaType: type }, 200, 3600);
    }
    if (route === 'recommendations') {
      const id = query.get('id'), type = query.get('type') || 'movie';
      if (!id) return jsonRes({ error: 'Missing id parameter' }, 400);
      let r = await tmdbFetch(`/${type}/${id}/recommendations`);
      if (!r.ok || !r.data?.results?.length) r = await tmdbFetch(`/${type}/${id}/similar`);
      const results = (r.data?.results || []).map(i => ({ ...i, media_type: type, mediaType: type }));
      return tmdbJson({ results }, 200, 3600);
    }
    if (route === 'season') {
      const id = query.get('id'), season = query.get('season');
      if (!id || !season) return jsonRes({ error: 'Missing id or season parameter' }, 400);
      const r = await tmdbFetch(`/tv/${id}/season/${season}`);
      if (!r.ok) return tmdbJson({ error: `TMDB error: ${r.status}` }, r.status);
      return tmdbJson(r.data, 200, 3600);
    }
    if (route === 'movies') {
      const cat = query.get('category') || 'popular', page = query.get('page') || '1';
      const r = await tmdbFetch(`/movie/${cat}`, { page });
      if (!r.ok) return tmdbJson({ error: `TMDB error: ${r.status}`, results: [] }, r.status);
      const results = (r.data.results || []).map(i => ({ ...i, media_type: 'movie', mediaType: 'movie' }));
      return tmdbJson({ ...r.data, results }, 200, 600);
    }
    if (route === 'series') {
      const cat = query.get('category') || 'popular', page = query.get('page') || '1';
      const r = await tmdbFetch(`/tv/${cat}`, { page });
      if (!r.ok) return tmdbJson({ error: `TMDB error: ${r.status}`, results: [] }, r.status);
      const results = (r.data.results || []).map(i => ({ ...i, media_type: 'tv', mediaType: 'tv' }));
      return tmdbJson({ ...r.data, results }, 200, 600);
    }
    if (route === 'discover') {
      const type = query.get('type') || 'movie', page = query.get('page') || '1';
      const genres = query.get('genres'), sortBy = query.get('sort_by') || 'popularity.desc', year = query.get('year');
      const params = { page, sort_by: sortBy };
      if (genres) params.with_genres = genres;
      if (year) params[type === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = year;
      const r = await tmdbFetch(`/discover/${type}`, params);
      if (!r.ok) return tmdbJson({ error: `TMDB error: ${r.status}`, results: [] }, r.status);
      const results = (r.data.results || []).map(i => ({ ...i, media_type: type, mediaType: type }));
      return tmdbJson({ ...r.data, results }, 200, 600);
    }
    return jsonRes({ error: 'Unknown TMDB route' }, 404);
  } catch (err) { return jsonRes({ error: 'TMDB proxy error', message: err.message }, 502); }
}

// ============================================================================
// VidSrc Extraction (/vidsrc/extract, /vidsrc/stream)
// Port of cloudflare-proxy/src/vidsrc-proxy.ts
// ============================================================================

const EMBED_API_BASE = 'https://v1.2embed.stream';

async function handleVidSrcExtract(query) {
  const tmdbId = query.get('tmdbId');
  const type = query.get('type') || 'movie';
  const season = query.get('season');
  const episode = query.get('episode');
  if (!tmdbId) return jsonRes({ error: 'Missing tmdbId' }, 400);
  if (type === 'tv' && (!season || !episode)) return jsonRes({ error: 'Season and episode required for TV' }, 400);

  const startTime = Date.now();
  try {
    const apiPath = type === 'tv' ? `/api/m3u8/tv/${tmdbId}/${season}/${episode}` : `/api/m3u8/movie/${tmdbId}`;
    const { status, data } = await fetchJson(`${EMBED_API_BASE}${apiPath}`, { Referer: EMBED_API_BASE + '/' });
    
    if (data.success && data.m3u8_url && !data.fallback) {
      const proxiedUrl = `/vidsrc/stream?url=${encodeURIComponent(data.m3u8_url)}`;
      return jsonRes({ success: true, m3u8_url: data.m3u8_url, proxied_url: proxiedUrl, source: data.source, duration_ms: Date.now() - startTime });
    }
    return jsonRes({ success: false, error: data.message || data.error || 'No m3u8_url', duration_ms: Date.now() - startTime }, 404);
  } catch (err) {
    return jsonRes({ success: false, error: err.message, duration_ms: Date.now() - startTime }, 500);
  }
}

async function handleVidSrcStream(query, proxyBase) {
  const streamUrl = query.get('url');
  if (!streamUrl) return jsonRes({ error: 'Missing url parameter' }, 400);

  try {
    let referer = EMBED_API_BASE + '/';
    try {
      const h = new URL(streamUrl).hostname;
      if (h.includes('cloudnestra') || h.includes('shadowlandschronicles') || h.includes('embedsito')) referer = `https://${h}/`;
    } catch {}

    const result = await nodeFetch(streamUrl, { Referer: referer, Accept: '*/*' });
    const ct = result.headers['content-type'] || '';

    if (ct.includes('mpegurl') || streamUrl.includes('.m3u8')) {
      let manifest = result.body.toString('utf-8');
      // Rewrite absolute URLs
      manifest = manifest.replace(/https:\/\/(?:v1\.2embed\.stream|[^\/\s]*cloudnestra\.[a-z]+|[^\/\s]*shadowlandschronicles\.[a-z]+|[^\/\s]*embedsito\.com)\/[^\s\n]+/g,
        (m) => `${proxyBase}/vidsrc/stream?url=${encodeURIComponent(m)}`);
      manifest = manifest.replace(/URI="(https?:\/\/[^"]+)"/g, (_, u) => `URI="${proxyBase}/vidsrc/stream?url=${encodeURIComponent(u)}"`);
      // Rewrite relative URLs
      const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);
      manifest = manifest.split('\n').map(line => {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('/vidsrc/')) return line;
        if (t.startsWith('http://') || t.startsWith('https://')) {
          if (t.includes('.ts') || t.includes('.m3u8') || t.includes('/key') || t.includes('.key'))
            return `${proxyBase}/vidsrc/stream?url=${encodeURIComponent(t)}`;
          return line;
        }
        return `${proxyBase}/vidsrc/stream?url=${encodeURIComponent(new URL(t, baseUrl).toString())}`;
      }).join('\n');
      return { status: 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl', ...CORS_HEADERS }, body: Buffer.from(manifest) };
    }
    return { status: 200, headers: { 'Content-Type': ct || 'application/octet-stream', ...CORS_HEADERS }, body: result.body };
  } catch (err) { return jsonRes({ error: err.message }, 500); }
}

// ============================================================================
// HiAnime Extraction (/hianime/extract, /hianime/stream)
// Port of cloudflare-proxy/src/hianime-proxy.ts
// ============================================================================

const HIANIME_DOMAIN = 'aniwatchtv.to';
const MEGACLOUD_KEYS_URLS = [
  'https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json',
  'https://raw.githubusercontent.com/CattoFish/MegacloudKeys/refs/heads/main/keys.json',
  'https://raw.githubusercontent.com/ghoshRitesh12/aniwatch/refs/heads/main/src/extractors/megacloud-keys.json',
];

// MegaCloud decryption engine
function keygen2(megacloudKey, clientKey) {
  const keygenHashMultVal = 31n;
  let tempKey = megacloudKey + clientKey;
  let hashVal = 0n;
  for (let i = 0; i < tempKey.length; i++) hashVal = BigInt(tempKey.charCodeAt(i)) + hashVal * keygenHashMultVal + (hashVal << 7n) - hashVal;
  hashVal = hashVal < 0n ? -hashVal : hashVal;
  const lHash = Number(hashVal % 0x7fffffffffffffffn);
  tempKey = tempKey.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ 247)).join('');
  const pivot = (lHash % tempKey.length) + 5;
  tempKey = tempKey.slice(pivot) + tempKey.slice(0, pivot);
  const leafStr = clientKey.split('').reverse().join('');
  let returnKey = '';
  for (let i = 0; i < Math.max(tempKey.length, leafStr.length); i++) returnKey += (tempKey[i] || '') + (leafStr[i] || '');
  returnKey = returnKey.substring(0, 96 + (lHash % 33));
  return [...returnKey].map(c => String.fromCharCode((c.charCodeAt(0) % 95) + 32)).join('');
}

function seedShuffle2(charArray, iKey) {
  let hashVal = 0n;
  for (let i = 0; i < iKey.length; i++) hashVal = (hashVal * 31n + BigInt(iKey.charCodeAt(i))) & 0xffffffffn;
  let shuffleNum = hashVal;
  const psudoRand = (arg) => { shuffleNum = (shuffleNum * 1103515245n + 12345n) & 0x7fffffffn; return Number(shuffleNum % BigInt(arg)); };
  const ret = [...charArray];
  for (let i = ret.length - 1; i > 0; i--) { const j = psudoRand(i + 1); [ret[i], ret[j]] = [ret[j], ret[i]]; }
  return ret;
}

function columnarCipher2(src, ikey) {
  const cc = ikey.length, rc = Math.ceil(src.length / cc);
  const arr = Array(rc).fill(null).map(() => Array(cc).fill(' '));
  const sorted = ikey.split('').map((c, i) => ({ c, i })).sort((a, b) => a.c.charCodeAt(0) - b.c.charCodeAt(0));
  let si = 0;
  sorted.forEach(({ i }) => { for (let r = 0; r < rc; r++) arr[r][i] = src[si++]; });
  let ret = '';
  for (let x = 0; x < rc; x++) for (let y = 0; y < cc; y++) ret += arr[x][y];
  return ret;
}

function decryptSrc2(src, clientKey, megacloudKey) {
  const genKey = keygen2(megacloudKey, clientKey);
  let decSrc = Buffer.from(src, 'base64').toString('binary');
  const charArray = [...Array(95)].map((_, i) => String.fromCharCode(32 + i));
  for (let iteration = 3; iteration > 0; iteration--) {
    const layerKey = genKey + iteration;
    let hv = 0n;
    for (let i = 0; i < layerKey.length; i++) hv = (hv * 31n + BigInt(layerKey.charCodeAt(i))) & 0xffffffffn;
    let seed = hv;
    const seedRand = (arg) => { seed = (seed * 1103515245n + 12345n) & 0x7fffffffn; return Number(seed % BigInt(arg)); };
    decSrc = decSrc.split('').map(ch => {
      const idx = charArray.indexOf(ch);
      if (idx === -1) return ch;
      return charArray[(idx - seedRand(95) + 95) % 95];
    }).join('');
    decSrc = columnarCipher2(decSrc, layerKey);
    const subValues = seedShuffle2(charArray, layerKey);
    const charMap = {};
    subValues.forEach((ch, i) => { charMap[ch] = charArray[i]; });
    decSrc = decSrc.split('').map(ch => charMap[ch] || ch).join('');
  }
  const dataLen = parseInt(decSrc.substring(0, 4), 10);
  return decSrc.substring(4, 4 + dataLen);
}

async function getMegaCloudClientKey(sourceId) {
  const { text } = await fetchText(`https://megacloud.blog/embed-2/v3/e-1/${sourceId}`, { Referer: `https://${HIANIME_DOMAIN}/` });
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
  let pass = null, count = 0;
  for (let i = 0; i < regexes.length; i++) { pass = text.match(regexes[i]); if (pass) { count = i; break; } }
  if (!pass) throw new Error('Failed extracting MegaCloud client key');
  if (count === 2) {
    const x = pass[0].match(lkDbRegex[0]), y = pass[0].match(lkDbRegex[1]), z = pass[0].match(lkDbRegex[2]);
    if (!x || !y || !z) throw new Error('Failed building client key (xyz)');
    const p1 = x[0].match(keyRegex), p2 = y[0].match(keyRegex), p3 = z[0].match(keyRegex);
    return p1[0].replace(/"/g, '') + p2[0].replace(/"/g, '') + p3[0].replace(/"/g, '');
  } else if (count === 1) {
    const kt = pass[0].match(/:[a-zA-Z0-9]+ /);
    return kt[0].replace(/:/g, '').replace(/ /g, '');
  }
  return pass[0].match(keyRegex)[0].replace(/"/g, '');
}

async function getMegaCloudKey() {
  for (const url of MEGACLOUD_KEYS_URLS) {
    try {
      const { data } = await fetchJson(url);
      const key = data.mega || data.key || Object.values(data)[0];
      if (key && typeof key === 'string') return key;
    } catch {}
  }
  throw new Error('Failed to fetch MegaCloud key');
}

async function extractMegaCloudStream(embedUrl) {
  const sourceId = new URL(embedUrl).pathname.split('/').pop();
  const [clientKey, megacloudKey] = await Promise.all([getMegaCloudClientKey(sourceId), getMegaCloudKey()]);
  const { data: srcData } = await fetchJson(
    `https://megacloud.blog/embed-2/v3/e-1/getSources?id=${sourceId}&_k=${clientKey}`,
    { Referer: embedUrl }
  );
  let sources;
  if (!srcData.encrypted && Array.isArray(srcData.sources)) sources = srcData.sources;
  else sources = JSON.parse(decryptSrc2(srcData.sources, clientKey, megacloudKey));
  const subtitles = (srcData.tracks || []).filter(t => t.kind === 'captions').map(t => ({ url: t.file, lang: t.label || t.kind, default: t.default || false }));
  return { sources: sources.map(s => ({ url: s.file, type: s.type })), subtitles, intro: srcData.intro || { start: 0, end: 0 }, outro: srcData.outro || { start: 0, end: 0 } };
}

// HiAnime API functions
async function hianimeSearch(query) {
  const url = `https://${HIANIME_DOMAIN}/ajax/search/suggest?keyword=${encodeURIComponent(query)}`;
  const { data } = await fetchJson(url, { 'X-Requested-With': 'XMLHttpRequest', Referer: `https://${HIANIME_DOMAIN}/` });
  const results = [];
  if (!data.status || !data.html) return results;
  const itemRe = /<a[^>]*href="\/([^"?]+)"[^>]*class="[^"]*nav-item[^"]*"[^>]*>/g;
  const nameRe = /<h3[^>]*class="[^"]*film-name[^"]*"[^>]*>([^<]*)<\/h3>/g;
  const links = [], names = [];
  let m;
  while ((m = itemRe.exec(data.html))) links.push(m[1]);
  while ((m = nameRe.exec(data.html))) names.push(m[1].trim());
  for (let i = 0; i < links.length; i++) {
    const id = links[i], name = names[i] || id, numId = (id.match(/-(\d+)$/) || [])[1] || null;
    results.push({ id, name, hianimeId: numId });
  }
  return results;
}

async function getHiAnimeMalId(slug) {
  const { text } = await fetchText(`https://${HIANIME_DOMAIN}/${slug}`);
  const syncMatch = text.match(/<script[^>]*id="syncData"[^>]*>([\s\S]*?)<\/script>/) || text.match(/<div[^>]*id="syncData"[^>]*>([^<]*)<\/div>/);
  if (!syncMatch) return null;
  try { const d = JSON.parse(syncMatch[1]); return d.mal_id ? parseInt(d.mal_id) : null; } catch { return null; }
}

async function getEpisodeList(animeId) {
  const { data } = await fetchJson(`https://${HIANIME_DOMAIN}/ajax/v2/episode/list/${animeId}`, { 'X-Requested-With': 'XMLHttpRequest', Referer: `https://${HIANIME_DOMAIN}/` });
  const eps = [], re = /<a[^>]*data-number="(\d+)"[^>]*data-id="(\d+)"[^>]*href="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(data.html))) eps.push({ number: parseInt(m[1]), dataId: m[2], href: m[3] });
  return eps;
}

async function getServers(episodeId) {
  const { data } = await fetchJson(`https://${HIANIME_DOMAIN}/ajax/v2/episode/servers?episodeId=${episodeId}`, { 'X-Requested-With': 'XMLHttpRequest', Referer: `https://${HIANIME_DOMAIN}/` });
  const servers = [], re = /<div[\s\S]*?class="[^"]*server-item[^"]*"[\s\S]*?>/g;
  let m;
  while ((m = re.exec(data.html))) {
    const b = m[0], dataId = (b.match(/data-id="(\d+)"/) || [])[1], type = (b.match(/data-type="(sub|dub|raw)"/) || [])[1], serverId = (b.match(/data-server-id="(\d+)"/) || [])[1];
    if (dataId && type && serverId) servers.push({ dataId, type, serverId });
  }
  return servers;
}

async function getSourceLink(serverId) {
  const { data } = await fetchJson(`https://${HIANIME_DOMAIN}/ajax/v2/episode/sources?id=${serverId}`, { 'X-Requested-With': 'XMLHttpRequest', Referer: `https://${HIANIME_DOMAIN}/` });
  return data.link || null;
}

async function findHiAnimeByMalId(malId, title) {
  let results = await hianimeSearch(title);
  if (results.length === 0) {
    const clean = title.replace(/\s*\(TV\)\s*/gi, '').replace(/\s*Season\s*\d+\s*/gi, '').replace(/\s*\d+(?:st|nd|rd|th)\s+Season\s*/gi, '').trim();
    if (clean !== title) results = await hianimeSearch(clean);
  }
  for (const r of results.slice(0, 8)) {
    const mid = await getHiAnimeMalId(r.id);
    if (mid === malId) return { hianimeId: r.hianimeId, slug: r.id };
  }
  if (results.length === 1 && results[0].hianimeId) return { hianimeId: results[0].hianimeId, slug: results[0].id };
  return null;
}

function rewritePlaylistUrls(playlist, baseUrl, proxyOrigin) {
  const base = new URL(baseUrl);
  const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
  const proxyUrl = (u) => {
    let abs;
    if (u.startsWith('http://') || u.startsWith('https://')) abs = u;
    else if (u.startsWith('/')) abs = `${base.origin}${u}`;
    else abs = `${base.origin}${basePath}${u}`;
    return `${proxyOrigin}/hianime/stream?url=${encodeURIComponent(abs)}`;
  };
  return playlist.split('\n').map(line => {
    const t = line.trim();
    if (line.startsWith('#EXT-X-MEDIA:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
      const um = line.match(/URI="([^"]+)"/);
      return um ? line.replace(`URI="${um[1]}"`, `URI="${proxyUrl(um[1])}"`) : line;
    }
    if (line.startsWith('#') || t === '') return line;
    try { return proxyUrl(t); } catch { return line; }
  }).join('\n');
}

async function handleHiAnimeExtract(query, proxyOrigin) {
  const malId = query.get('malId'), title = query.get('title'), episode = query.get('episode');
  if (!malId || !title) return jsonRes({ error: 'Missing malId or title' }, 400);
  const startTime = Date.now();
  try {
    const anime = await findHiAnimeByMalId(parseInt(malId), title);
    if (!anime) return jsonRes({ success: false, error: `Anime not found (title: "${title}", malId: ${malId})` }, 404);
    const episodes = await getEpisodeList(anime.hianimeId);
    const targetEp = episode ? parseInt(episode) : 1;
    const ep = episodes.find(e => e.number === targetEp);
    if (!ep) return jsonRes({ success: false, error: `Episode ${targetEp} not found (${episodes.length} available)` }, 404);
    const servers = await getServers(ep.dataId);
    const subServer = servers.find(s => s.type === 'sub' && s.serverId === '4') || servers.find(s => s.type === 'sub');
    const dubServer = servers.find(s => s.type === 'dub' && s.serverId === '4') || servers.find(s => s.type === 'dub');
    if (!subServer && !dubServer) return jsonRes({ success: false, error: 'No servers found' }, 404);

    const extractStream = async (server, label) => {
      if (!server) return null;
      try {
        const link = await getSourceLink(server.dataId);
        if (!link) return null;
        return { label, ...(await extractMegaCloudStream(link)) };
      } catch (e) { console.error(`[HiAnime] ${label} error:`, e.message); return null; }
    };
    const [subResult, dubResult] = await Promise.all([extractStream(subServer, 'sub'), extractStream(dubServer, 'dub')]);
    const sources = [], allSubs = [];
    for (const result of [subResult, dubResult]) {
      if (!result) continue;
      for (const src of result.sources) {
        sources.push({
          quality: 'auto', title: `HiAnime (${result.label === 'sub' ? 'Sub' : 'Dub'})`,
          url: `${proxyOrigin}/hianime/stream?url=${encodeURIComponent(src.url)}`, type: 'hls',
          language: result.label,
          skipIntro: result.intro.end > 0 ? [result.intro.start, result.intro.end] : undefined,
          skipOutro: result.outro.end > 0 ? [result.outro.start, result.outro.end] : undefined,
        });
      }
      if (result.label === 'sub') for (const s of result.subtitles) allSubs.push({ label: s.lang, url: s.url, language: s.lang });
    }
    return jsonRes({ success: sources.length > 0, sources, subtitles: allSubs, provider: 'hianime', totalEpisodes: episodes.length, executionTime: Date.now() - startTime }, sources.length > 0 ? 200 : 404);
  } catch (err) { return jsonRes({ success: false, error: err.message, executionTime: Date.now() - startTime }, 500); }
}

async function handleHiAnimeStream(query, proxyOrigin) {
  const targetUrl = query.get('url');
  if (!targetUrl) return jsonRes({ error: 'Missing url parameter' }, 400);
  try {
    const result = await nodeFetch(targetUrl, { Accept: '*/*', 'Accept-Encoding': 'identity' });
    const ct = result.headers['content-type'] || '';
    if (ct.includes('mpegurl') || targetUrl.includes('.m3u8')) {
      const rewritten = rewritePlaylistUrls(result.body.toString('utf-8'), targetUrl, proxyOrigin);
      return { status: 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'public, max-age=5', ...CORS_HEADERS }, body: Buffer.from(rewritten) };
    }
    // Detect content type for segments
    const fb = result.body.slice(0, 4);
    let aCt = ct;
    if (fb[0] === 0x47) aCt = 'video/mp2t';
    else if (fb[0] === 0x00 && fb[1] === 0x00 && fb[2] === 0x00) aCt = 'video/mp4';
    else if (!aCt) aCt = 'application/octet-stream';
    return { status: 200, headers: { 'Content-Type': aCt, 'Content-Length': String(result.body.length), 'Cache-Control': 'public, max-age=3600', ...CORS_HEADERS }, body: result.body };
  } catch (err) { return jsonRes({ error: err.message }, 502); }
}

// ============================================================================
// Flixer Extraction (/flixer/extract)
// Port of cloudflare-proxy/src/flixer-proxy.ts
// Uses the flixer.wasm bundled in the Docker image
// ============================================================================

const FLIXER_API_BASE = 'https://theemoviedb.hexa.su';
const SERVER_NAMES = { alpha:'Ares', bravo:'Balder', charlie:'Circe', delta:'Dionysus', echo:'Eros', foxtrot:'Freya', golf:'Gaia', hotel:'Hades', india:'Isis', juliet:'Juno', kilo:'Kronos', lima:'Loki' };

let flixerWasmInstance = null;
let flixerApiKey = null;
let flixerServerTimeOffset = 0;

// Simplified WASM loader for Node.js — loads the flixer.wasm from disk
class FlixerWasmLoader {
  constructor() {
    this.wasm = null;
    this.heap = new Array(128).fill(undefined);
    this.heap.push(undefined, null, true, false);
    this.heap_next = this.heap.length;
    this.WASM_VECTOR_LEN = 0;
    this.cachedUint8ArrayMemory0 = null;
    this.cachedDataViewMemory0 = null;
    this.cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    this.cachedTextEncoder = new TextEncoder();
    this.sessionId = crypto.randomUUID().replace(/-/g, '');
    this.timestamp = Date.now() - 5000;
    this.randomSeed = Math.random();
    this.timezoneOffset = new Date().getTimezoneOffset();
  }

  getObject(idx) { return this.heap[idx]; }
  addHeapObject(obj) {
    if (this.heap_next === this.heap.length) this.heap.push(this.heap.length + 1);
    const idx = this.heap_next;
    this.heap_next = this.heap[idx];
    this.heap[idx] = obj;
    return idx;
  }
  dropObject(idx) { if (idx < 132) return; this.heap[idx] = this.heap_next; this.heap_next = idx; }
  takeObject(idx) { const r = this.getObject(idx); this.dropObject(idx); return r; }
  getUint8ArrayMemory0() {
    if (!this.cachedUint8ArrayMemory0 || this.cachedUint8ArrayMemory0.byteLength === 0) this.cachedUint8ArrayMemory0 = new Uint8Array(this.wasm.memory.buffer);
    return this.cachedUint8ArrayMemory0;
  }
  getDataViewMemory0() {
    if (!this.cachedDataViewMemory0 || this.cachedDataViewMemory0.buffer !== this.wasm.memory.buffer) this.cachedDataViewMemory0 = new DataView(this.wasm.memory.buffer);
    return this.cachedDataViewMemory0;
  }
  getStringFromWasm0(ptr, len) { return this.cachedTextDecoder.decode(this.getUint8ArrayMemory0().subarray(ptr >>> 0, (ptr >>> 0) + len)); }
  passStringToWasm0(arg, malloc) {
    const buf = this.cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length, 1) >>> 0;
    this.getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
    this.WASM_VECTOR_LEN = buf.length;
    return ptr;
  }
  isLikeNone(x) { return x === undefined || x === null; }
  handleError(f, args) { try { return f.apply(this, args); } catch (e) { this.wasm.__wbindgen_export_0(this.addHeapObject(e)); } }

  buildImports() {
    const self = this;
    const scr = { width: 1920, height: 1080, colorDepth: 24 };
    const nav = { platform: 'Win32', language: 'en-US', userAgent: UA };
    const perf = { now: () => Date.now() - self.timestamp };
    const ls = { getItem: (k) => k === 'tmdb_session_id' ? self.sessionId : null, setItem: () => {} };
    const canvasCtx = { _font: '14px Arial', _textBaseline: 'alphabetic', fillText() {}, get font() { return this._font; }, set font(v) { this._font = v; }, get textBaseline() { return this._textBaseline; }, set textBaseline(v) { this._textBaseline = v; } };
    const canvas = { _width: 200, _height: 50, get width() { return this._width; }, set width(v) { this._width = v; }, get height() { return this._height; }, set height(v) { this._height = v; }, getContext: (t) => t === '2d' ? canvasCtx : null, toDataURL: () => 'data:image/png;base64,' + Buffer.from(`canvas-fp-1920x1080-24-Win32-en-US`).toString('base64') };
    const mockBody = { appendChild: () => {}, clientWidth: 1920, clientHeight: 1080 };
    const createCollection = (els) => { const c = { length: els.length, item: (i) => els[i] || null }; els.forEach((e, i) => { c[i] = e; }); return new Proxy(c, { get(t, p) { if (typeof p === 'string' && !isNaN(parseInt(p))) return t[parseInt(p)]; return t[p]; } }); };
    const doc = { createElement: (t) => t === 'canvas' ? canvas : {}, getElementsByTagName: (t) => t === 'body' ? createCollection([mockBody]) : createCollection([]), body: mockBody };
    const win = { document: doc, localStorage: ls, navigator: nav, screen: scr, performance: perf };
    const i = { wbg: {} };
    i.wbg.__wbg_call_672a4d21634d4a24 = function() { return self.handleError((a, b) => self.addHeapObject(self.getObject(a).call(self.getObject(b))), arguments); };
    i.wbg.__wbg_call_7cccdd69e0791ae2 = function() { return self.handleError((a, b, c) => self.addHeapObject(self.getObject(a).call(self.getObject(b), self.getObject(c))), arguments); };
    i.wbg.__wbg_colorDepth_59677c81c61d599a = function() { return self.handleError((a) => self.getObject(a).colorDepth, arguments); };
    i.wbg.__wbg_height_614ba187d8cae9ca = function() { return self.handleError((a) => self.getObject(a).height, arguments); };
    i.wbg.__wbg_width_679079836447b4b7 = function() { return self.handleError((a) => self.getObject(a).width, arguments); };
    i.wbg.__wbg_screen_8edf8699f70d98bc = function() { return self.handleError((a) => { const w = self.getObject(a); return self.addHeapObject(w ? w.screen : scr); }, arguments); };
    i.wbg.__wbg_document_d249400bd7bd996d = (a) => { const w = self.getObject(a); const d = w ? w.document : null; return d ? self.addHeapObject(d) : 0; };
    i.wbg.__wbg_createElement_8c9931a732ee2fea = function() { return self.handleError((a, b, c) => self.addHeapObject(doc.createElement(self.getStringFromWasm0(b, c))), arguments); };
    i.wbg.__wbg_getElementsByTagName_f03d41ce466561e8 = (a, b, c) => self.addHeapObject(doc.getElementsByTagName(self.getStringFromWasm0(b, c)));
    i.wbg.__wbg_getContext_e9cf379449413580 = function() { return self.handleError((a, b, c) => { const r = self.getObject(a).getContext(self.getStringFromWasm0(b, c)); return self.isLikeNone(r) ? 0 : self.addHeapObject(r); }, arguments); };
    i.wbg.__wbg_fillText_2a0055d8531355d1 = function() { return self.handleError((a, b, c, d, e) => self.getObject(a).fillText(self.getStringFromWasm0(b, c), d, e), arguments); };
    i.wbg.__wbg_setfont_42a163ef83420b93 = (a, b, c) => { self.getObject(a).font = self.getStringFromWasm0(b, c); };
    i.wbg.__wbg_settextBaseline_c28d2a6aa4ff9d9d = (a, b, c) => { self.getObject(a).textBaseline = self.getStringFromWasm0(b, c); };
    i.wbg.__wbg_setheight_da683a33fa99843c = (a, b) => { self.getObject(a).height = b >>> 0; };
    i.wbg.__wbg_setwidth_c5fed9f5e7f0b406 = (a, b) => { self.getObject(a).width = b >>> 0; };
    i.wbg.__wbg_toDataURL_eaec332e848fe935 = function() { return self.handleError((a, b) => { const r = self.getObject(b).toDataURL(); const p = self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); }, arguments); };
    i.wbg.__wbg_instanceof_CanvasRenderingContext2d_df82a4d3437bf1cc = () => 1;
    i.wbg.__wbg_instanceof_HtmlCanvasElement_2ea67072a7624ac5 = () => 1;
    i.wbg.__wbg_instanceof_Window_def73ea0955fc569 = () => 1;
    i.wbg.__wbg_localStorage_1406c99c39728187 = function() { return self.handleError((a) => { const w = self.getObject(a); return self.isLikeNone(w ? w.localStorage : ls) ? 0 : self.addHeapObject(w ? w.localStorage : ls); }, arguments); };
    i.wbg.__wbg_getItem_17f98dee3b43fa7e = function() { return self.handleError((a, b, c, d) => { const r = self.getObject(b).getItem(self.getStringFromWasm0(c, d)); const p = self.isLikeNone(r) ? 0 : self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); }, arguments); };
    i.wbg.__wbg_setItem_212ecc915942ab0a = function() { return self.handleError((a, b, c, d, e) => { self.getObject(a).setItem(self.getStringFromWasm0(b, c), self.getStringFromWasm0(d, e)); }, arguments); };
    i.wbg.__wbg_navigator_1577371c070c8947 = (a) => { const w = self.getObject(a); return self.addHeapObject(w ? w.navigator : nav); };
    i.wbg.__wbg_language_d871ec78ee8eec62 = (a, b) => { const r = self.getObject(b).language; const p = self.isLikeNone(r) ? 0 : self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); };
    i.wbg.__wbg_platform_faf02c487289f206 = function() { return self.handleError((a, b) => { const r = self.getObject(b).platform; const p = self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); }, arguments); };
    i.wbg.__wbg_userAgent_12e9d8e62297563f = function() { return self.handleError((a, b) => { const r = self.getObject(b).userAgent; const p = self.passStringToWasm0(r, self.wasm.__wbindgen_export_1); self.getDataViewMemory0().setInt32(a + 4, self.WASM_VECTOR_LEN, true); self.getDataViewMemory0().setInt32(a, p, true); }, arguments); };
    i.wbg.__wbg_new0_f788a2397c7ca929 = () => self.addHeapObject(new Date(self.timestamp));
    i.wbg.__wbg_now_807e54c39636c349 = () => self.timestamp;
    i.wbg.__wbg_getTimezoneOffset_6b5752021c499c47 = () => self.timezoneOffset;
    i.wbg.__wbg_performance_c185c0cdc2766575 = (a) => { const w = self.getObject(a); return self.isLikeNone(w ? w.performance : perf) ? 0 : self.addHeapObject(w ? w.performance : perf); };
    i.wbg.__wbg_now_d18023d54d4e5500 = (a) => self.getObject(a).now();
    i.wbg.__wbg_random_3ad904d98382defe = () => self.randomSeed;
    i.wbg.__wbg_length_347907d14a9ed873 = (a) => self.getObject(a).length;
    i.wbg.__wbg_new_23a2665fac83c611 = (a, b) => { try { var s = { a, b }; var cb = (x, y) => { const t = s.a; s.a = 0; try { return self.wasm.__wbindgen_export_6(t, s.b, self.addHeapObject(x), self.addHeapObject(y)); } finally { s.a = t; } }; return self.addHeapObject(new Promise(cb)); } finally { s.a = s.b = 0; } };
    i.wbg.__wbg_resolve_4851785c9c5f573d = (a) => self.addHeapObject(Promise.resolve(self.getObject(a)));
    i.wbg.__wbg_reject_b3fcf99063186ff7 = (a) => self.addHeapObject(Promise.reject(self.getObject(a)));
    i.wbg.__wbg_then_44b73946d2fb3e7d = (a, b) => self.addHeapObject(self.getObject(a).then(self.getObject(b)));
    i.wbg.__wbg_newnoargs_105ed471475aaf50 = (a, b) => self.addHeapObject(new Function(self.getStringFromWasm0(a, b)));
    i.wbg.__wbg_static_accessor_GLOBAL_88a902d13a557d07 = () => 0;
    i.wbg.__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0 = () => self.addHeapObject(globalThis);
    i.wbg.__wbg_static_accessor_SELF_37c5d418e4bf5819 = () => self.addHeapObject(win);
    i.wbg.__wbg_static_accessor_WINDOW_5de37043a91a9c40 = () => self.addHeapObject(win);
    i.wbg.__wbg_queueMicrotask_97d92b4fcc8a61c5 = (a) => queueMicrotask(self.getObject(a));
    i.wbg.__wbg_queueMicrotask_d3219def82552485 = (a) => self.addHeapObject(self.getObject(a).queueMicrotask);
    i.wbg.__wbindgen_cb_drop = (a) => { const o = self.takeObject(a).original; if (o.cnt-- == 1) { o.a = 0; return true; } return false; };
    i.wbg.__wbindgen_closure_wrapper982 = (a, b) => { const s = { a, b, cnt: 1, dtor: 36 }; const r = (...args) => { s.cnt++; const t = s.a; s.a = 0; try { return self.wasm.__wbindgen_export_5(t, s.b, self.addHeapObject(args[0])); } finally { if (--s.cnt === 0) self.wasm.__wbindgen_export_3.get(s.dtor)(t, s.b); else s.a = t; } }; r.original = s; return self.addHeapObject(r); };
    i.wbg.__wbindgen_is_function = (a) => typeof self.getObject(a) === 'function';
    i.wbg.__wbindgen_is_undefined = (a) => self.getObject(a) === undefined;
    i.wbg.__wbindgen_object_clone_ref = (a) => self.addHeapObject(self.getObject(a));
    i.wbg.__wbindgen_object_drop_ref = (a) => self.takeObject(a);
    i.wbg.__wbindgen_string_new = (a, b) => self.addHeapObject(self.getStringFromWasm0(a, b));
    i.wbg.__wbindgen_throw = (a, b) => { throw new Error(self.getStringFromWasm0(a, b)); };
    return i;
  }

  async initialize(wasmPath) {
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.compile(wasmBuffer);
    const imports = this.buildImports();
    const instance = await WebAssembly.instantiate(wasmModule, imports);
    this.wasm = instance.exports;
    return this;
  }

  getImgKey() {
    const retptr = this.wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      this.wasm.get_img_key(retptr);
      const dv = this.getDataViewMemory0();
      const r0 = dv.getInt32(retptr, true), r1 = dv.getInt32(retptr + 4, true), r2 = dv.getInt32(retptr + 8, true), r3 = dv.getInt32(retptr + 12, true);
      if (r3) throw this.takeObject(r2);
      const result = this.getStringFromWasm0(r0, r1);
      this.wasm.__wbindgen_export_4(r0, r1, 1);
      return result;
    } finally { this.wasm.__wbindgen_add_to_stack_pointer(16); }
  }

  async processImgData(data, key) {
    const p0 = this.passStringToWasm0(data, this.wasm.__wbindgen_export_1), l0 = this.WASM_VECTOR_LEN;
    const p1 = this.passStringToWasm0(key, this.wasm.__wbindgen_export_1), l1 = this.WASM_VECTOR_LEN;
    return this.takeObject(this.wasm.process_img_data(p0, l0, p1, l1));
  }
}

// Flixer auth + extraction helpers
function generateClientFingerprint() {
  const fpString = `2560x1440:24:${UA.substring(0, 50)}:Win32:en-US:${new Date().getTimezoneOffset()}:iVBORw0KGgoAAAANSUhEUgAAASwA`;
  let hash = 0;
  for (let i = 0; i < fpString.length; i++) { hash = (hash << 5) - hash + fpString.charCodeAt(i); hash &= hash; }
  return Math.abs(hash).toString(36);
}

async function syncFlixerServerTime() {
  const before = Date.now();
  const { data } = await fetchJson(`${FLIXER_API_BASE}/api/time?t=${before}`);
  const after = Date.now();
  flixerServerTimeOffset = data.timestamp * 1000 + ((after - before) / 2) - after;
}

function getFlixerTimestamp() { return Math.floor((Date.now() + flixerServerTimeOffset) / 1000); }

async function makeFlixerRequest(apiKey, apiPath, extraHeaders = {}) {
  const timestamp = getFlixerTimestamp();
  const nonce = crypto.randomBytes(16).toString('base64').replace(/[/+=]/g, '').substring(0, 22);
  const message = `${apiKey}:${timestamp}:${nonce}:${apiPath}`;
  const signature = crypto.createHmac('sha256', apiKey).update(message).digest('base64');
  const headers = {
    'X-Api-Key': apiKey, 'X-Request-Timestamp': timestamp.toString(), 'X-Request-Nonce': nonce,
    'X-Request-Signature': signature, 'X-Client-Fingerprint': generateClientFingerprint(),
    Accept: 'text/plain', 'Accept-Language': 'en-US,en;q=0.9',
    'x-fingerprint-lite': 'e9136c41504646444',
    ...extraHeaders,
  };
  const { text, status } = await fetchText(`${FLIXER_API_BASE}${apiPath}`, headers);
  if (status >= 400) throw new Error(`HTTP ${status}: ${text.substring(0, 200)}`);
  return text;
}

async function getFlixerSource(loader, apiKey, type, tmdbId, server, season, episode) {
  const apiPath = type === 'movie' ? `/api/tmdb/movie/${tmdbId}/images` : `/api/tmdb/tv/${tmdbId}/season/${season}/episode/${episode}/images`;
  // Warm-up request
  try { await makeFlixerRequest(apiKey, apiPath, {}); } catch {}
  await new Promise(r => setTimeout(r, 100));

  for (let attempt = 1; attempt <= 5; attempt++) {
    const encrypted = await makeFlixerRequest(apiKey, apiPath, { 'X-Only-Sources': '1', 'X-Server': server });
    const decrypted = await loader.processImgData(encrypted, apiKey);
    const data = JSON.parse(decrypted);
    let url = null;
    if (Array.isArray(data.sources)) { const s = data.sources.find(s => s.server === server) || data.sources[0]; url = s?.url || s?.file || s?.stream; if (!url && s?.sources) url = s.sources[0]?.url || s.sources[0]?.file; }
    if (!url) url = data.sources?.file || data.sources?.url || data.file || data.url || data.stream;
    if (!url && data.servers?.[server]) { const sd = data.servers[server]; url = sd.url || sd.file || sd.stream; if (Array.isArray(sd)) url = sd[0]?.url || sd[0]?.file; }
    if (url && url.trim()) return url;
    if (attempt < 5) await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

async function handleFlixerExtract(query) {
  const tmdbId = query.get('tmdbId'), type = query.get('type') || 'movie', season = query.get('season'), episode = query.get('episode'), server = query.get('server') || 'alpha';
  if (!tmdbId) return jsonRes({ error: 'Missing tmdbId' }, 400);
  if (type === 'tv' && (!season || !episode)) return jsonRes({ error: 'Season and episode required for TV' }, 400);

  try {
    // Initialize WASM if needed
    if (!flixerWasmInstance || !flixerApiKey) {
      console.log('[Flixer] Initializing WASM...');
      // Try multiple paths for the WASM file
      const wasmPaths = ['/app/public/flixer.wasm', path.join(__dirname, '..', 'public', 'flixer.wasm'), path.join(process.cwd(), 'public', 'flixer.wasm')];
      let wasmPath = null;
      for (const p of wasmPaths) { if (fs.existsSync(p)) { wasmPath = p; break; } }
      if (!wasmPath) return jsonRes({ success: false, error: 'Flixer WASM not found' }, 500);
      await syncFlixerServerTime();
      flixerWasmInstance = new FlixerWasmLoader();
      await flixerWasmInstance.initialize(wasmPath);
      flixerApiKey = flixerWasmInstance.getImgKey();
      console.log(`[Flixer] WASM initialized, key prefix: ${flixerApiKey.substring(0, 16)}`);
    }

    const url = await getFlixerSource(flixerWasmInstance, flixerApiKey, type, tmdbId, server, season, episode);
    if (!url) {
      flixerWasmInstance = null; flixerApiKey = null; // Reset on failure
      return jsonRes({ success: false, error: 'No stream URL found', server }, 404);
    }
    return jsonRes({ success: true, sources: [{ quality: 'auto', title: `Flixer ${SERVER_NAMES[server] || server}`, url, type: 'hls', referer: 'https://flixer.su/', requiresSegmentProxy: true, status: 'working', language: 'en', server }], server });
  } catch (err) {
    console.error('[Flixer] Error:', err.message);
    flixerWasmInstance = null; flixerApiKey = null;
    return jsonRes({ success: false, error: err.message }, 500);
  }
}

// ============================================================================
// Main HTTP Server
// ============================================================================

const server = http.createServer(async (req, res) => {
  metrics.requests++;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const query = url.searchParams;
  const proxyBase = `http://${req.headers.host || `localhost:${PORT}`}`;

  if (req.method === 'OPTIONS') return sendResponse(res, { status: 204, headers: CORS_HEADERS });

  let result;
  try {
    if (pathname === '/health' || pathname === '/health/') {
      result = jsonRes({ status: 'healthy', mode: 'self-hosted-aio', uptime: `${Math.floor((Date.now() - metrics.startTime) / 1000)}s`, metrics, flixerWasm: !!flixerWasmInstance });

    // Flixer routes (order matters: stream before extract)
    } else if (pathname === '/flixer/stream' || (pathname.startsWith('/flixer') && query.has('url'))) {
      result = await handleStreamProxy(query, req.headers, proxyBase, 'flixer');
    } else if (pathname === '/flixer/extract' || pathname === '/flixer') {
      result = await handleFlixerExtract(query);
    } else if (pathname === '/flixer/health') {
      result = jsonRes({ status: 'ok', wasmLoaded: !!flixerWasmInstance, hasApiKey: !!flixerApiKey });

    // VidSrc extraction + stream proxy
    } else if (pathname === '/vidsrc/extract' || pathname === '/vidsrc') {
      result = await handleVidSrcExtract(query);
    } else if (pathname === '/vidsrc/stream') {
      result = await handleVidSrcStream(query, proxyBase);
    } else if (pathname === '/vidsrc/health') {
      result = jsonRes({ status: 'ok', apiBase: EMBED_API_BASE });

    // HiAnime extraction + stream proxy
    } else if (pathname === '/hianime/extract') {
      result = await handleHiAnimeExtract(query, proxyBase);
    } else if (pathname === '/hianime/stream') {
      result = await handleHiAnimeStream(query, proxyBase);
    } else if (pathname === '/hianime/health') {
      result = jsonRes({ status: 'ok', provider: 'hianime' });

    // Generic stream proxies (animekai, stream, cdn-live, etc.)
    } else if (pathname.startsWith('/animekai')) {
      result = await handleStreamProxy(query, req.headers, proxyBase, 'animekai');
    } else if (pathname.startsWith('/stream')) {
      result = await handleStreamProxy(query, req.headers, proxyBase, 'stream');
    } else if (pathname.startsWith('/cdn-live')) {
      result = await handleStreamProxy(query, req.headers, proxyBase, 'cdn-live');
    } else if (pathname.startsWith('/viprow')) {
      result = await handleStreamProxy(query, req.headers, proxyBase, 'viprow');
    } else if (pathname.startsWith('/tv')) {
      result = await handleStreamProxy(query, req.headers, proxyBase, 'tv');
    } else if (pathname.startsWith('/dlhd')) {
      result = await handleStreamProxy(query, req.headers, proxyBase, 'dlhd');

    // TMDB proxy
    } else if (pathname.startsWith('/tmdb')) {
      result = await handleTMDBProxy(pathname, query);

    // Analytics (no-op)
    } else if (pathname.startsWith('/analytics')) {
      result = jsonRes({ success: true, message: 'Analytics received (local mode)' });
    } else if (pathname.startsWith('/sync')) {
      result = jsonRes({ success: true, data: {} });

    // Root
    } else if (pathname === '/' || pathname === '') {
      result = jsonRes({ name: 'Flyx All-in-One Proxy', version: '2.0.0', mode: 'self-hosted', status: 'operational',
        routes: ['/stream', '/flixer/extract', '/vidsrc/extract', '/hianime/extract', '/animekai', '/tmdb', '/analytics', '/health'] });
    } else {
      result = jsonRes({ error: 'Not found' }, 404);
    }
  } catch (err) {
    metrics.errors++;
    console.error(`[proxy] Error handling ${pathname}:`, err.message);
    result = jsonRes({ error: 'Internal proxy error', message: err.message }, 500);
  }

  if (Buffer.isBuffer(result.body)) { res.writeHead(result.status, result.headers); res.end(result.body); }
  else sendResponse(res, result);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[flyx-proxy] All-in-One proxy running on http://0.0.0.0:${PORT}`);
  console.log(`[flyx-proxy] TMDB API: ${TMDB_API_KEY ? 'configured' : 'NOT configured'}`);
  console.log(`[flyx-proxy] Extractors: Flixer (WASM), VidSrc (2embed API), HiAnime (MegaCloud)`);
});
