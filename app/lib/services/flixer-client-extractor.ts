/**
 * Hexa/Flixer Client-Side Extractor — Browser-Direct Pattern
 *
 * Runs entirely in the browser. Hexa sees the user's residential IP,
 * so no captcha/PoW is needed. Same pattern as DLHD whitelist.
 *
 * Flow:
 *   1. Browser → CF Worker /flixer/sign → signed auth headers
 *   2. Browser → hexa.su API directly (user's IP!) → encrypted response
 *   3. Browser → CF Worker /flixer/decrypt → stream URLs
 */

const CF_WORKER_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_CF_STREAM_PROXY_URL || 'https://media-proxy.vynx.workers.dev/stream').replace(/\/stream\/?$/, '')
  : '';

const SERVER_NAMES: Record<string, string> = {
  alpha: 'Ares', bravo: 'Balder', charlie: 'Circe', delta: 'Dionysus',
  echo: 'Eros', foxtrot: 'Freya', golf: 'Gaia', hotel: 'Hades',
  india: 'Isis', juliet: 'Juno', kilo: 'Kronos', lima: 'Loki',
  mike: 'Medusa', november: 'Nyx', oscar: 'Odin', papa: 'Persephone',
  quebec: 'Quirinus', romeo: 'Ra', sierra: 'Selene', tango: 'Thor',
  uniform: 'Uranus', victor: 'Vulcan', whiskey: 'Woden', xray: 'Xolotl',
  yankee: 'Ymir', zulu: 'Zeus',
};

export interface FlixerSource {
  quality: string;
  title: string;
  url: string;
  type: 'hls' | 'mp4';
  referer: string;
  requiresSegmentProxy: boolean;
  status: 'working' | 'down' | 'unknown';
  language: string;
  server: string;
}

interface SignResponse {
  success: boolean;
  url: string;
  headers: Record<string, string>;
  error?: string;
}

interface DecryptResponse {
  success: boolean;
  sources: Array<{ server: string; url: string }>;
  servers: string[];
  parsed: any;
  error?: string;
}

/**
 * Get signed headers from CF Worker, then fetch hexa.su directly.
 */
async function signAndFetch(
  tmdbId: string,
  type: string,
  opts?: { server?: string; warmup?: boolean; season?: number; episode?: number },
): Promise<string> {
  const params = new URLSearchParams({ tmdbId, type });
  if (opts?.server) params.set('server', opts.server);
  if (opts?.warmup) params.set('warmup', '1');
  if (opts?.season) params.set('season', opts.season.toString());
  if (opts?.episode) params.set('episode', opts.episode.toString());

  // Step 1: Get signed headers
  const signRes = await fetch(`${CF_WORKER_BASE}/flixer/sign?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!signRes.ok) throw new Error(`Sign: ${signRes.status}`);
  const sign = await signRes.json() as SignResponse;
  if (!sign.success) throw new Error(sign.error || 'Sign failed');

  // Step 2: Fetch hexa.su directly — browser's IP is visible!
  const apiRes = await fetch(sign.url, {
    headers: sign.headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!apiRes.ok) {
    const err = await apiRes.text().catch(() => '');
    throw new Error(`Hexa ${apiRes.status}: ${err.substring(0, 80)}`);
  }
  return apiRes.text();
}

/**
 * Send encrypted response to CF Worker for WASM decryption.
 */
async function decrypt(encrypted: string): Promise<DecryptResponse> {
  const res = await fetch(`${CF_WORKER_BASE}/flixer/decrypt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Decrypt: ${res.status}`);
  const data = await res.json() as DecryptResponse;
  if (!data.success) throw new Error(data.error || 'Decrypt failed');
  return data;
}

/**
 * Extract all Flixer sources — runs in the browser.
 * No captcha needed because hexa sees the user's real IP.
 */
export async function extractFlixerClient(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<FlixerSource[]> {
  console.log(`[Hexa] Browser-direct extraction: ${type} ${tmdbId}`);

  // Step 1: Warm-up (browser-direct)
  let servers: string[];
  try {
    const warmupEncrypted = await signAndFetch(tmdbId, type, {
      warmup: true, season, episode,
    });
    const warmupData = await decrypt(warmupEncrypted);
    servers = warmupData.servers?.length > 0 && warmupData.servers.length < 26
      ? warmupData.servers
      : ['delta', 'alpha', 'bravo', 'charlie', 'echo', 'foxtrot', 'golf'];
    console.log(`[Hexa] Warm-up: ${servers.length} servers`);
  } catch (e) {
    console.warn(`[Hexa] Warm-up failed: ${e instanceof Error ? e.message : e}, using defaults`);
    servers = ['delta', 'alpha', 'bravo', 'charlie', 'echo', 'foxtrot', 'golf'];
  }

  // Step 2: Extract each server sequentially (browser-direct)
  const sources: FlixerSource[] = [];
  for (const server of servers) {
    try {
      const encrypted = await signAndFetch(tmdbId, type, { server, season, episode });
      const data = await decrypt(encrypted);

      let url: string | null = null;
      if (data.sources?.length > 0) {
        const src = data.sources.find(s => s.server === server) || data.sources[0];
        url = src?.url || null;
      }
      if (!url && data.parsed) {
        url = data.parsed.url || data.parsed.file || data.parsed.stream || null;
      }

      if (url) {
        sources.push({
          quality: 'auto',
          title: `Flixer ${SERVER_NAMES[server] || server}`,
          url,
          type: 'hls',
          referer: 'https://hexa.su/',
          requiresSegmentProxy: true,
          status: 'working',
          language: 'en',
          server,
        });
      }
    } catch (e) {
      console.log(`[Hexa] ${server}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`[Hexa] ${sources.length}/${servers.length} servers returned URLs`);
  return sources;
}

/**
 * Extract a single server by display name — runs in the browser.
 */
export async function fetchFlixerSourceClient(
  sourceName: string,
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<FlixerSource | null> {
  const entry = Object.entries(SERVER_NAMES).find(([_, name]) =>
    sourceName.toLowerCase().includes(name.toLowerCase())
  );
  const server = entry ? entry[0] : 'alpha';

  try {
    // Warm-up
    try {
      const warmup = await signAndFetch(tmdbId, type, { warmup: true, season, episode });
      await decrypt(warmup);
    } catch {}

    const encrypted = await signAndFetch(tmdbId, type, { server, season, episode });
    const data = await decrypt(encrypted);

    let url: string | null = null;
    if (data.sources?.length > 0) {
      const src = data.sources.find(s => s.server === server) || data.sources[0];
      url = src?.url || null;
    }

    if (url) {
      return {
        quality: 'auto',
        title: `Flixer ${SERVER_NAMES[server] || server}`,
        url,
        type: 'hls',
        referer: 'https://hexa.su/',
        requiresSegmentProxy: true,
        status: 'working',
        language: 'en',
        server,
      };
    }
  } catch (e) {
    console.error(`[Hexa] fetchByName error:`, e);
  }
  return null;
}
