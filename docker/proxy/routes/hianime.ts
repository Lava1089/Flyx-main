/**
 * HiAnime extraction pipeline.
 *
 * Full flow: search → MAL ID matching → episode list → server selection
 * → MegaCloud decryption (keygen2, seedShuffle2, columnarCipher2, decryptSrc2)
 * → stream proxying with playlist URL rewriting.
 */

import { CORS_HEADERS, USER_AGENT, errorResponse, jsonResponse } from "../lib/helpers";
import { fetchText, fetchJson } from "../lib/fetch";

const HIANIME_DOMAIN = "hianimez.to";
const MEGACLOUD_KEYS_URLS = [
  "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json",
  "https://raw.githubusercontent.com/CattoFish/MegacloudKeys/refs/heads/main/keys.json",
  "https://raw.githubusercontent.com/ghoshRitesh12/aniwatch/refs/heads/main/src/extractors/megacloud-keys.json",
];

// ---------------------------------------------------------------------------
// MegaCloud decryption engine
// ---------------------------------------------------------------------------

function keygen2(megacloudKey: string, clientKey: string): string {
  const keygenHashMultVal = 31n;
  let tempKey = megacloudKey + clientKey;
  let hashVal = 0n;
  for (let i = 0; i < tempKey.length; i++) {
    hashVal =
      BigInt(tempKey.charCodeAt(i)) +
      hashVal * keygenHashMultVal +
      (hashVal << 7n) -
      hashVal;
  }
  hashVal = hashVal < 0n ? -hashVal : hashVal;
  const lHash = Number(hashVal % 0x7fffffffffffffffn);

  tempKey = tempKey
    .split("")
    .map((c) => String.fromCharCode(c.charCodeAt(0) ^ 247))
    .join("");

  const pivot = (lHash % tempKey.length) + 5;
  tempKey = tempKey.slice(pivot) + tempKey.slice(0, pivot);

  const leafStr = clientKey.split("").reverse().join("");
  let returnKey = "";
  for (let i = 0; i < Math.max(tempKey.length, leafStr.length); i++) {
    returnKey += (tempKey[i] || "") + (leafStr[i] || "");
  }
  returnKey = returnKey.substring(0, 96 + (lHash % 33));
  return [...returnKey]
    .map((c) => String.fromCharCode((c.charCodeAt(0) % 95) + 32))
    .join("");
}

function seedShuffle2(charArray: string[], iKey: string): string[] {
  let hashVal = 0n;
  for (let i = 0; i < iKey.length; i++) {
    hashVal = (hashVal * 31n + BigInt(iKey.charCodeAt(i))) & 0xffffffffn;
  }
  let shuffleNum = hashVal;
  const psudoRand = (arg: number): number => {
    shuffleNum = (shuffleNum * 1103515245n + 12345n) & 0x7fffffffn;
    return Number(shuffleNum % BigInt(arg));
  };
  const ret = [...charArray];
  for (let i = ret.length - 1; i > 0; i--) {
    const j = psudoRand(i + 1);
    [ret[i], ret[j]] = [ret[j], ret[i]];
  }
  return ret;
}

function columnarCipher2(src: string, ikey: string): string {
  const cc = ikey.length;
  const rc = Math.ceil(src.length / cc);
  const arr: string[][] = Array(rc)
    .fill(null)
    .map(() => Array(cc).fill(" "));
  const sorted = ikey
    .split("")
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.charCodeAt(0) - b.c.charCodeAt(0));
  let si = 0;
  sorted.forEach(({ i }) => {
    for (let r = 0; r < rc; r++) arr[r][i] = src[si++];
  });
  let ret = "";
  for (let x = 0; x < rc; x++) {
    for (let y = 0; y < cc; y++) ret += arr[x][y];
  }
  return ret;
}

function decryptSrc2(
  src: string,
  clientKey: string,
  megacloudKey: string,
): string {
  const genKey = keygen2(megacloudKey, clientKey);
  // Base64 decode to binary string
  const raw = atob(src);
  let decSrc = raw;
  const charArray = [...Array(95)].map((_, i) => String.fromCharCode(32 + i));

  for (let iteration = 3; iteration > 0; iteration--) {
    const layerKey = genKey + iteration;
    let hv = 0n;
    for (let i = 0; i < layerKey.length; i++) {
      hv = (hv * 31n + BigInt(layerKey.charCodeAt(i))) & 0xffffffffn;
    }
    let seed = hv;
    const seedRand = (arg: number): number => {
      seed = (seed * 1103515245n + 12345n) & 0x7fffffffn;
      return Number(seed % BigInt(arg));
    };

    // Substitution reverse
    decSrc = decSrc
      .split("")
      .map((ch) => {
        const idx = charArray.indexOf(ch);
        if (idx === -1) return ch;
        return charArray[(idx - seedRand(95) + 95) % 95];
      })
      .join("");

    // Columnar cipher
    decSrc = columnarCipher2(decSrc, layerKey);

    // Shuffle substitution
    const subValues = seedShuffle2(charArray, layerKey);
    const charMap: Record<string, string> = {};
    subValues.forEach((ch, i) => {
      charMap[ch] = charArray[i];
    });
    decSrc = decSrc
      .split("")
      .map((ch) => charMap[ch] || ch)
      .join("");
  }

  const dataLen = parseInt(decSrc.substring(0, 4), 10);
  return decSrc.substring(4, 4 + dataLen);
}

// ---------------------------------------------------------------------------
// MegaCloud key fetching
// ---------------------------------------------------------------------------

async function getMegaCloudClientKey(sourceId: string): Promise<string> {
  const { text } = await fetchText(
    `https://megacloud.blog/embed-2/v3/e-1/${sourceId}`,
    { Referer: `https://${HIANIME_DOMAIN}/` },
  );

  const regexes = [
    /<meta name="_gg_fb" content="[a-zA-Z0-9]+">/,
    /<!--\s+_is_th:[0-9a-zA-Z]+\s+-->/,
    /<script>window\._lk_db\s+=\s+\{[xyz]:\s+["'][a-zA-Z0-9]+["'],\s+[xyz]:\s+["'][a-zA-Z0-9]+["'],\s+[xyz]:\s+["'][a-zA-Z0-9]+["']\};<\/script>/,
    /<div\s+data-dpi="[0-9a-zA-Z]+"\s+.*><\/div>/,
    /<script nonce="[0-9a-zA-Z]+">/,
    /<script>window\._xy_ws = ['"`][0-9a-zA-Z]+['"`];<\/script>/,
  ];
  const keyRegex = /"[a-zA-Z0-9]+"/;
  const lkDbRegex = [
    /x:\s+"[a-zA-Z0-9]+"/,
    /y:\s+"[a-zA-Z0-9]+"/,
    /z:\s+"[a-zA-Z0-9]+"/,
  ];

  let pass: RegExpMatchArray | null = null;
  let count = 0;
  for (let i = 0; i < regexes.length; i++) {
    pass = text.match(regexes[i]);
    if (pass) {
      count = i;
      break;
    }
  }
  if (!pass) throw new Error("Failed extracting MegaCloud client key");

  if (count === 2) {
    const x = pass[0].match(lkDbRegex[0]);
    const y = pass[0].match(lkDbRegex[1]);
    const z = pass[0].match(lkDbRegex[2]);
    if (!x || !y || !z)
      throw new Error("Failed building client key (xyz)");
    const p1 = x[0].match(keyRegex);
    const p2 = y[0].match(keyRegex);
    const p3 = z[0].match(keyRegex);
    return (
      p1![0].replace(/"/g, "") +
      p2![0].replace(/"/g, "") +
      p3![0].replace(/"/g, "")
    );
  } else if (count === 1) {
    const kt = pass[0].match(/:[a-zA-Z0-9]+ /);
    return kt![0].replace(/:/g, "").replace(/ /g, "");
  }
  return pass[0].match(keyRegex)![0].replace(/"/g, "");
}

async function getMegaCloudKey(): Promise<string> {
  for (const url of MEGACLOUD_KEYS_URLS) {
    try {
      const { data } = await fetchJson<Record<string, unknown>>(url);
      const key =
        (data.mega as string) ||
        (data.key as string) ||
        (Object.values(data)[0] as string);
      if (key && typeof key === "string") return key;
    } catch {
      // try next URL
    }
  }
  throw new Error("Failed to fetch MegaCloud key");
}

interface MegaCloudSource {
  file: string;
  type: string;
}

interface MegaCloudTrack {
  file: string;
  label?: string;
  kind: string;
  default?: boolean;
}

interface MegaCloudResult {
  sources: { url: string; type: string }[];
  subtitles: { url: string; lang: string; default: boolean }[];
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}

async function extractMegaCloudStream(
  embedUrl: string,
): Promise<MegaCloudResult> {
  const sourceId = new URL(embedUrl).pathname.split("/").pop()!;
  const [clientKey, megacloudKey] = await Promise.all([
    getMegaCloudClientKey(sourceId),
    getMegaCloudKey(),
  ]);

  const { data: srcData } = await fetchJson<Record<string, unknown>>(
    `https://megacloud.blog/embed-2/v3/e-1/getSources?id=${sourceId}&_k=${clientKey}`,
    { Referer: embedUrl },
  );

  let sources: MegaCloudSource[];
  if (!srcData.encrypted && Array.isArray(srcData.sources)) {
    sources = srcData.sources as MegaCloudSource[];
  } else {
    sources = JSON.parse(
      decryptSrc2(srcData.sources as string, clientKey, megacloudKey),
    ) as MegaCloudSource[];
  }

  const subtitles = ((srcData.tracks as MegaCloudTrack[]) || [])
    .filter((t) => t.kind === "captions")
    .map((t) => ({
      url: t.file,
      lang: t.label || t.kind,
      default: t.default || false,
    }));

  const intro = (srcData.intro as { start: number; end: number }) || {
    start: 0,
    end: 0,
  };
  const outro = (srcData.outro as { start: number; end: number }) || {
    start: 0,
    end: 0,
  };

  return {
    sources: sources.map((s) => ({ url: s.file, type: s.type })),
    subtitles,
    intro,
    outro,
  };
}

// ---------------------------------------------------------------------------
// HiAnime API helpers
// ---------------------------------------------------------------------------

interface SearchResult {
  id: string;
  name: string;
  hianimeId: string | null;
}

const HIANIME_HEADERS: Record<string, string> = {
  "X-Requested-With": "XMLHttpRequest",
  Referer: `https://${HIANIME_DOMAIN}/`,
};

async function hianimeSearch(query: string): Promise<SearchResult[]> {
  const { data } = await fetchJson<{ status: boolean; html: string }>(
    `https://${HIANIME_DOMAIN}/ajax/search/suggest?keyword=${encodeURIComponent(query)}`,
    HIANIME_HEADERS,
  );

  if (!data.status || !data.html) return [];

  const results: SearchResult[] = [];
  const itemRe =
    /<a[^>]*href="\/([^"?]+)"[^>]*class="[^"]*nav-item[^"]*"[^>]*>/g;
  const nameRe =
    /<h3[^>]*class="[^"]*film-name[^"]*"[^>]*>([^<]*)<\/h3>/g;
  const links: string[] = [];
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(data.html))) links.push(m[1]);
  while ((m = nameRe.exec(data.html))) names.push(m[1].trim());

  for (let i = 0; i < links.length; i++) {
    const id = links[i];
    const name = names[i] || id;
    const numId = (id.match(/-(\d+)$/) || [])[1] || null;
    results.push({ id, name, hianimeId: numId });
  }
  return results;
}

async function getHiAnimeMalId(slug: string): Promise<number | null> {
  const { text } = await fetchText(`https://${HIANIME_DOMAIN}/${slug}`);
  const syncMatch =
    text.match(/<script[^>]*id="syncData"[^>]*>([\s\S]*?)<\/script>/) ||
    text.match(/<div[^>]*id="syncData"[^>]*>([^<]*)<\/div>/);
  if (!syncMatch) return null;
  try {
    const d = JSON.parse(syncMatch[1]);
    return d.mal_id ? parseInt(d.mal_id) : null;
  } catch {
    return null;
  }
}

interface Episode {
  number: number;
  dataId: string;
  href: string;
}

async function getEpisodeList(animeId: string): Promise<Episode[]> {
  const { data } = await fetchJson<{ html: string }>(
    `https://${HIANIME_DOMAIN}/ajax/v2/episode/list/${animeId}`,
    HIANIME_HEADERS,
  );
  const eps: Episode[] = [];
  const re =
    /<a[^>]*data-number="(\d+)"[^>]*data-id="(\d+)"[^>]*href="([^"]*)"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(data.html)))
    eps.push({ number: parseInt(m[1]), dataId: m[2], href: m[3] });
  return eps;
}

interface Server {
  dataId: string;
  type: string;
  serverId: string;
}

async function getServers(episodeId: string): Promise<Server[]> {
  const { data } = await fetchJson<{ html: string }>(
    `https://${HIANIME_DOMAIN}/ajax/v2/episode/servers?episodeId=${episodeId}`,
    HIANIME_HEADERS,
  );
  const servers: Server[] = [];
  const re =
    /<div[\s\S]*?class="[^"]*server-item[^"]*"[\s\S]*?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(data.html))) {
    const b = m[0];
    const dataId = (b.match(/data-id="(\d+)"/) || [])[1];
    const type = (b.match(/data-type="(sub|dub|raw)"/) || [])[1];
    const serverId = (b.match(/data-server-id="(\d+)"/) || [])[1];
    if (dataId && type && serverId)
      servers.push({ dataId, type, serverId });
  }
  return servers;
}

async function getSourceLink(serverId: string): Promise<string | null> {
  const { data } = await fetchJson<{ link?: string }>(
    `https://${HIANIME_DOMAIN}/ajax/v2/episode/sources?id=${serverId}`,
    HIANIME_HEADERS,
  );
  return data.link || null;
}

async function findHiAnimeByMalId(
  malId: number,
  title: string,
): Promise<{ hianimeId: string; slug: string } | null> {
  let results = await hianimeSearch(title);
  if (results.length === 0) {
    const clean = title
      .replace(/\s*\(TV\)\s*/gi, "")
      .replace(/\s*Season\s*\d+\s*/gi, "")
      .replace(/\s*\d+(?:st|nd|rd|th)\s+Season\s*/gi, "")
      .trim();
    if (clean !== title) results = await hianimeSearch(clean);
  }

  for (const r of results.slice(0, 8)) {
    const mid = await getHiAnimeMalId(r.id);
    if (mid === malId) return { hianimeId: r.hianimeId!, slug: r.id };
  }
  if (results.length === 1 && results[0].hianimeId) {
    return { hianimeId: results[0].hianimeId, slug: results[0].id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Playlist URL rewriting for HiAnime streams
// ---------------------------------------------------------------------------

function rewritePlaylistUrls(
  playlist: string,
  baseUrl: string,
  proxyOrigin: string,
): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname.substring(
    0,
    base.pathname.lastIndexOf("/") + 1,
  );

  const proxyUrl = (u: string): string => {
    let abs: string;
    if (u.startsWith("http://") || u.startsWith("https://")) abs = u;
    else if (u.startsWith("/")) abs = `${base.origin}${u}`;
    else abs = `${base.origin}${basePath}${u}`;
    return `${proxyOrigin}/hianime/stream?url=${encodeURIComponent(abs)}`;
  };

  return playlist
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (
        line.startsWith("#EXT-X-MEDIA:") ||
        line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")
      ) {
        const um = line.match(/URI="([^"]+)"/);
        return um
          ? line.replace(`URI="${um[1]}"`, `URI="${proxyUrl(um[1])}"`)
          : line;
      }
      if (line.startsWith("#") || t === "") return line;
      try {
        return proxyUrl(t);
      } catch {
        return line;
      }
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

/**
 * Full HiAnime extraction pipeline.
 */
export async function handleHiAnimeExtract(
  _req: Request,
  url: URL,
  proxyOrigin: string,
): Promise<Response> {
  const malId = url.searchParams.get("malId");
  const title = url.searchParams.get("title");
  const episode = url.searchParams.get("episode");

  if (!malId || !title)
    return errorResponse("Missing malId or title", 400);

  const startTime = Date.now();
  try {
    const anime = await findHiAnimeByMalId(parseInt(malId), title);
    if (!anime) {
      return jsonResponse(
        {
          success: false,
          error: `Anime not found (title: "${title}", malId: ${malId})`,
        },
        404,
      );
    }

    const episodes = await getEpisodeList(anime.hianimeId);
    const targetEp = episode ? parseInt(episode) : 1;
    const ep = episodes.find((e) => e.number === targetEp);
    if (!ep) {
      return jsonResponse(
        {
          success: false,
          error: `Episode ${targetEp} not found (${episodes.length} available)`,
        },
        404,
      );
    }

    const servers = await getServers(ep.dataId);
    const subServer =
      servers.find((s) => s.type === "sub" && s.serverId === "4") ||
      servers.find((s) => s.type === "sub");
    const dubServer =
      servers.find((s) => s.type === "dub" && s.serverId === "4") ||
      servers.find((s) => s.type === "dub");

    if (!subServer && !dubServer) {
      return jsonResponse(
        { success: false, error: "No servers found" },
        404,
      );
    }

    const extractStream = async (
      server: Server | undefined,
      label: string,
    ) => {
      if (!server) return null;
      try {
        const link = await getSourceLink(server.dataId);
        if (!link) return null;
        return { label, ...(await extractMegaCloudStream(link)) };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[HiAnime] ${label} error:`, msg);
        return null;
      }
    };

    const [subResult, dubResult] = await Promise.all([
      extractStream(subServer, "sub"),
      extractStream(dubServer, "dub"),
    ]);

    const sources: Record<string, unknown>[] = [];
    const allSubs: Record<string, unknown>[] = [];

    for (const result of [subResult, dubResult]) {
      if (!result) continue;
      for (const src of result.sources) {
        sources.push({
          quality: "auto",
          title: `HiAnime (${result.label === "sub" ? "Sub" : "Dub"})`,
          url: `${proxyOrigin}/hianime/stream?url=${encodeURIComponent(src.url)}`,
          type: "hls",
          language: result.label,
          skipIntro:
            result.intro.end > 0
              ? [result.intro.start, result.intro.end]
              : undefined,
          skipOutro:
            result.outro.end > 0
              ? [result.outro.start, result.outro.end]
              : undefined,
        });
      }
      if (result.label === "sub") {
        for (const s of result.subtitles) {
          allSubs.push({ label: s.lang, url: s.url, language: s.lang });
        }
      }
    }

    return jsonResponse(
      {
        success: sources.length > 0,
        sources,
        subtitles: allSubs,
        provider: "hianime",
        totalEpisodes: episodes.length,
        executionTime: Date.now() - startTime,
      },
      sources.length > 0 ? 200 : 404,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { success: false, error: message, executionTime: Date.now() - startTime },
      500,
    );
  }
}

/**
 * Proxy a HiAnime stream, rewriting M3U8 playlist URLs.
 */
export async function handleHiAnimeStream(
  _req: Request,
  url: URL,
  proxyOrigin: string,
): Promise<Response> {
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) return errorResponse("Missing url parameter", 400);

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "*/*",
        "Accept-Encoding": "identity",
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });

    const ct = upstream.headers.get("content-type") || "";

    if (ct.includes("mpegurl") || targetUrl.includes(".m3u8")) {
      const text = await upstream.text();
      const rewritten = rewritePlaylistUrls(text, targetUrl, proxyOrigin);
      const body = new TextEncoder().encode(rewritten);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "public, max-age=5",
          ...CORS_HEADERS,
        },
      });
    }

    // Binary segment — detect content type
    const body = await upstream.arrayBuffer();
    const view = new Uint8Array(body);
    let aCt = ct;
    if (view.length > 0 && view[0] === 0x47) aCt = "video/mp2t";
    else if (
      view.length >= 3 &&
      view[0] === 0x00 &&
      view[1] === 0x00 &&
      view[2] === 0x00
    )
      aCt = "video/mp4";
    else if (!aCt) aCt = "application/octet-stream";

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": aCt,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=3600",
        ...CORS_HEADERS,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 502);
  }
}
