/**
 * VidLink Extractor (replaces Videasy)
 * 
 * Flow:
 * 1. One-time init: fetch mercury data → load libsodium → load Go WASM → run WASM
 * 2. Per-request: getAdv(tmdbId) → token → /api/b/movie|tv/{token}?multiLang=1 → plain JSON
 * 
 * The Go WASM (fu.wasm) uses libsodium's secretbox (XSalsa20-Poly1305) internally
 * to generate signed tokens from TMDB IDs. The mercury endpoint provides ad-library
 * data that the WASM reads from a global variable.
 * 
 * API response is plain JSON (no encryption):
 * {
 *   sourceId: string,
 *   stream: {
 *     id: string,
 *     type: "hls",
 *     playlist: string,  // HLS m3u8 URL
 *     flags: string[],
 *     captions: Array<{ id, url, language, type, hasCorsRestrictions }>,
 *     TTL: number
 *   }
 * }
 */

interface StreamSource {
  quality: string;
  title: string;
  url: string;
  type: 'hls';
  referer: string;
  requiresSegmentProxy: boolean;
  status?: 'working' | 'down' | 'unknown';
  language?: string;
}

interface ExtractionResult {
  success: boolean;
  sources: StreamSource[];
  subtitles?: Array<{ label: string; url: string; language: string }>;
  error?: string;
}

interface VidLinkCaption {
  id?: string;
  url?: string;
  language?: string;
  type?: string;
  hasCorsRestrictions?: boolean;
}

interface VidLinkAPIResponse {
  sourceId?: string;
  stream?: {
    id?: string;
    type?: string;
    playlist?: string;
    flags?: string[];
    captions?: VidLinkCaption[];
    TTL?: number;
  };
  // Fallback: some responses may have sources array
  sources?: Array<{ file?: string; url?: string; type?: string; label?: string; quality?: string }>;
  subtitles?: Array<{ file?: string; url?: string; label?: string; lang?: string }>;
  tracks?: Array<{ file?: string; url?: string; label?: string; kind?: string }>;
}

// Language display names
export const LANGUAGE_NAMES: Record<string, string> = {
  'en': 'English',
  'de': 'German',
  'it': 'Italian',
  'fr': 'French',
  'es': 'Spanish',
  'es-419': 'Latin Spanish',
  'pt': 'Portuguese',
  'hi': 'Hindi',
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://vidlink.pro/',
  'Origin': 'https://vidlink.pro',
};

// ============================================================================
// WASM Token Generator (singleton, initialized once)
// ============================================================================

let wasmInitialized = false;
let wasmInitializing = false;
let wasmInitPromise: Promise<boolean> | null = null;
let getAdvFn: ((tmdbId: string) => string | null) | null = null;

// Path to the Go WASM runtime bridge (script.js from vidlink.pro)
// We bundle it locally to avoid fetching it every time
const WASM_SCRIPT_PATH = 'scripts/vidlink-script.js';

/**
 * Detect if we're running on Cloudflare Workers (no Node.js fs/path/libsodium).
 * VidLink WASM init requires Node.js APIs that don't exist on CF Workers.
 */
function isCloudflareRuntime(): boolean {
  try {
    // Production is always CF Workers for this app (deployed via @opennextjs/cloudflare)
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      return true;
    }
    // @ts-ignore - caches.default only exists in Cloudflare Workers
    if (typeof caches !== 'undefined' && typeof caches.default !== 'undefined') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Initialize the Go WASM token generator.
 * This is called once and cached - subsequent calls return immediately.
 * 
 * NOTE: This ONLY works in Node.js (local dev). On CF Workers, it returns false
 * immediately because fs/path/libsodium are not available.
 */
async function initWasm(): Promise<boolean> {
  if (wasmInitialized && getAdvFn) return true;
  
  // VidLink WASM requires Node.js APIs (fs, path, libsodium-wrappers)
  // that are NOT available on Cloudflare Workers. Bail out early.
  if (isCloudflareRuntime()) {
    console.log('[VidLink] Skipping WASM init — not supported on Cloudflare Workers (requires fs/path/libsodium)');
    return false;
  }
  
  // Deduplicate concurrent init calls
  if (wasmInitializing && wasmInitPromise) return wasmInitPromise;
  
  wasmInitializing = true;
  wasmInitPromise = _doInitWasm();
  
  try {
    const result = await wasmInitPromise;
    return result;
  } finally {
    wasmInitializing = false;
  }
}

async function _doInitWasm(): Promise<boolean> {
  try {
    console.log('[VidLink] Initializing WASM token generator...');
    const startTime = Date.now();

    // Set up browser-like globals the WASM expects
    if (typeof globalThis.window === 'undefined') {
      (globalThis as any).window = globalThis;
    }
    if (typeof globalThis.self === 'undefined') {
      (globalThis as any).self = globalThis;
    }
    if (typeof (globalThis as any).document === 'undefined') {
      (globalThis as any).document = {
        createElement: (tag: string) => ({ 
          style: {}, 
          setAttribute: () => {}, 
          appendChild: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          tagName: tag?.toUpperCase(),
          src: '',
          href: '',
          rel: '',
          type: '',
          textContent: '',
          innerHTML: '',
          id: '',
          className: '',
        }),
        head: { appendChild: () => {}, removeChild: () => {} },
        body: { appendChild: () => {}, removeChild: () => {}, innerHTML: '' },
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createTextNode: () => ({ textContent: '' }),
        createDocumentFragment: () => ({ appendChild: () => {} }),
        domain: 'vidlink.pro',
        readyState: 'complete',
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    }
    if (typeof (globalThis as any).location === 'undefined') {
      (globalThis as any).location = {
        href: 'https://vidlink.pro/',
        hostname: 'vidlink.pro',
        origin: 'https://vidlink.pro',
        protocol: 'https:',
        host: 'vidlink.pro',
        pathname: '/',
        search: '',
        hash: '',
      };
    }
    
    // Additional browser globals the Go WASM may need
    if (typeof (globalThis as any).navigator === 'undefined') {
      (globalThis as any).navigator = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        language: 'en-US',
        languages: ['en-US', 'en'],
        platform: 'Win32',
      };
    }
    if (typeof (globalThis as any).performance === 'undefined') {
      (globalThis as any).performance = {
        now: () => Date.now(),
        timeOrigin: Date.now(),
      };
    }
    if (typeof (globalThis as any).crypto === 'undefined') {
      const nodeCrypto = require('crypto');
      (globalThis as any).crypto = {
        getRandomValues: (arr: Uint8Array) => nodeCrypto.randomFillSync(arr),
        subtle: nodeCrypto.webcrypto?.subtle,
      };
    }

    // Step 1: Fetch mercury data (sets a global variable the WASM reads)
    console.log('[VidLink] Fetching mercury data...');
    const mercuryResp = await fetch('https://vidlink.pro/api/mercury?tmdbId=0&type=movie', {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    const mercuryText = await mercuryResp.text();
    const varMatch = mercuryText.match(/window\['([^']+)'\]\s*=\s*'([^']+)'/);
    if (!varMatch) {
      console.error('[VidLink] Mercury response has no window variable');
      return false;
    }
    (globalThis as any)[varMatch[1]] = varMatch[2];
    console.log(`[VidLink] Mercury: set globalThis['${varMatch[1]}'] (${varMatch[2].length} chars)`);

    // Step 2: Load libsodium (the WASM uses sodium's secretbox internally)
    console.log('[VidLink] Loading libsodium...');
    const sodium = require('libsodium-wrappers');
    await sodium.ready;
    (globalThis as any).sodium = sodium;

    // Step 3: Load the Go WASM runtime bridge (defines globalThis.Dm class)
    const fs = require('fs');
    const path = require('path');
    const scriptPath = path.resolve(process.cwd(), WASM_SCRIPT_PATH);
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    
    // Use indirect eval to run in global scope
    const indirectEval = eval;
    indirectEval(scriptContent);

    if (typeof (globalThis as any).Dm !== 'function') {
      console.error('[VidLink] Dm class not found after loading script.js');
      return false;
    }

    // Step 4: Fetch and run the Go WASM binary
    console.log('[VidLink] Fetching fu.wasm...');
    const wasmResp = await fetch('https://vidlink.pro/fu.wasm', {
      headers: { 'User-Agent': HEADERS['User-Agent'] },
      signal: AbortSignal.timeout(30000),
    });
    const wasmBuffer = await wasmResp.arrayBuffer();

    const go = new (globalThis as any).Dm();
    const wasmModule = await WebAssembly.compile(wasmBuffer);
    const instance = await WebAssembly.instantiate(wasmModule, go.importObject);

    // Run the Go program (non-blocking - it registers getAdv and stays alive)
    go.run(instance).catch(() => {});

    // Wait for WASM to initialize and register getAdv
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (typeof (globalThis as any).getAdv !== 'function') {
      console.error('[VidLink] getAdv not registered by WASM');
      return false;
    }

    getAdvFn = (globalThis as any).getAdv;
    wasmInitialized = true;

    const elapsed = Date.now() - startTime;
    console.log(`[VidLink] WASM initialized in ${elapsed}ms`);
    return true;
  } catch (error) {
    console.error('[VidLink] WASM init failed:', error instanceof Error ? error.message : error);
    wasmInitialized = false;
    getAdvFn = null;
    return false;
  }
}

/**
 * Generate a signed token for a TMDB ID using the Go WASM.
 * The token is used in the API URL instead of the raw TMDB ID.
 */
function generateToken(tmdbId: string): string | null {
  if (!getAdvFn) return null;
  try {
    return getAdvFn(tmdbId);
  } catch (error) {
    console.error('[VidLink] Token generation error:', error);
    return null;
  }
}


// ============================================================================
// API Fetching
// ============================================================================

/**
 * Fetch stream data from VidLink API using a WASM-generated token.
 * 
 * Movies: /api/b/movie/{token}?multiLang=1
 * TV:     /api/b/tv/{token}/{season}/{episode}?multiLang=1
 */
async function fetchStreamData(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<VidLinkAPIResponse | null> {
  // Initialize WASM if needed
  const ready = await initWasm();
  if (!ready) {
    console.error('[VidLink] WASM not ready, cannot generate token');
    return null;
  }

  // Generate signed token
  const token = generateToken(tmdbId);
  if (!token) {
    console.error('[VidLink] Failed to generate token for TMDB ID:', tmdbId);
    return null;
  }
  console.log(`[VidLink] Token for ${tmdbId}: ${token.substring(0, 30)}...`);

  // Build API URL
  const encodedToken = encodeURIComponent(token);
  const url = type === 'movie'
    ? `https://vidlink.pro/api/b/movie/${encodedToken}?multiLang=1`
    : `https://vidlink.pro/api/b/tv/${encodedToken}/${season || 1}/${episode || 1}?multiLang=1`;

  console.log(`[VidLink] Fetching: ${url.substring(0, 100)}...`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[VidLink] API returned ${response.status}`);
      return null;
    }

    const text = await response.text();
    if (!text || text.trim().length === 0) {
      console.error('[VidLink] Empty API response');
      return null;
    }

    // Response is plain JSON
    try {
      const data: VidLinkAPIResponse = JSON.parse(text);
      console.log(`[VidLink] API response: sourceId=${data.sourceId}, hasStream=${!!data.stream}`);
      return data;
    } catch {
      console.error('[VidLink] Failed to parse API response as JSON');
      console.log('[VidLink] Raw response:', text.substring(0, 200));
      return null;
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[VidLink] API request timed out');
    } else {
      console.error('[VidLink] API fetch error:', error);
    }
    return null;
  }
}

// ============================================================================
// Response Parsing
// ============================================================================

function extractSubtitles(data: VidLinkAPIResponse): Array<{ label: string; url: string; language: string }> {
  const subtitles: Array<{ label: string; url: string; language: string }> = [];

  // New format: stream.captions
  if (data.stream?.captions) {
    for (const cap of data.stream.captions) {
      if (cap.url) {
        subtitles.push({
          label: cap.language || 'Unknown',
          url: cap.url,
          language: mapLanguageCode(cap.language || ''),
        });
      }
    }
  }

  // Legacy format: subtitles array
  if (data.subtitles) {
    for (const sub of data.subtitles) {
      const subUrl = sub.url || sub.file;
      if (subUrl && !subtitles.find(s => s.url === subUrl)) {
        subtitles.push({
          label: sub.label || sub.lang || 'Unknown',
          url: subUrl,
          language: sub.lang || mapLanguageCode(sub.label || ''),
        });
      }
    }
  }

  // Legacy format: tracks array
  if (data.tracks) {
    for (const track of data.tracks) {
      if (track.kind === 'captions' || track.kind === 'subtitles' || !track.kind) {
        const trackUrl = track.url || track.file;
        if (trackUrl && !subtitles.find(s => s.url === trackUrl)) {
          subtitles.push({
            label: track.label || 'Unknown',
            url: trackUrl,
            language: mapLanguageCode(track.label || ''),
          });
        }
      }
    }
  }

  return subtitles;
}

function mapLanguageCode(langName: string): string {
  const lower = langName.toLowerCase();
  if (lower.includes('english')) return 'en';
  if (lower.includes('spanish')) return 'es';
  if (lower.includes('french')) return 'fr';
  if (lower.includes('german')) return 'de';
  if (lower.includes('italian')) return 'it';
  if (lower.includes('portuguese')) return 'pt';
  if (lower.includes('arabic')) return 'ar';
  if (lower.includes('chinese')) return 'zh';
  if (lower.includes('japanese')) return 'ja';
  if (lower.includes('korean')) return 'ko';
  if (lower.includes('hindi')) return 'hi';
  if (lower.includes('dutch')) return 'nl';
  if (lower.includes('czech')) return 'cs';
  if (lower.includes('danish')) return 'da';
  if (lower.includes('finnish')) return 'fi';
  if (lower.includes('greek')) return 'el';
  if (lower.includes('hebrew')) return 'he';
  if (lower.includes('hungarian')) return 'hu';
  if (lower.includes('indonesian')) return 'id';
  if (lower.includes('norwegian')) return 'no';
  if (lower.includes('polish')) return 'pl';
  if (lower.includes('romanian')) return 'ro';
  if (lower.includes('russian')) return 'ru';
  if (lower.includes('swedish')) return 'sv';
  if (lower.includes('thai')) return 'th';
  if (lower.includes('turkish')) return 'tr';
  if (lower.includes('ukrainian')) return 'uk';
  if (lower.includes('vietnamese')) return 'vi';
  return 'unknown';
}

// ============================================================================
// Main Extraction
// ============================================================================

/**
 * Main extraction function.
 * Initializes WASM (once), generates token, calls API, returns stream sources.
 */
export async function extractVidLinkStreams(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  _includeAllLanguages: boolean = true
): Promise<ExtractionResult> {
  console.log(`[VidLink] Extracting streams for ${type} ID ${tmdbId}...`);

  const data = await fetchStreamData(tmdbId, type, season, episode);

  if (!data) {
    return { success: false, sources: [], error: 'Failed to fetch from VidLink API' };
  }

  const sources: StreamSource[] = [];

  // New format: stream.playlist (single HLS source)
  if (data.stream?.playlist) {
    // Determine referer from the playlist URL or use default
    let referer = 'https://vidlink.pro/';
    
    // The playlist URL often has headers embedded as query params
    // e.g. ?headers={"referer":"https://videostr.net/","origin":"https://videostr.net"}&host=...
    // We should extract the actual referer if present
    try {
      const playlistUrl = new URL(data.stream.playlist);
      const headersParam = playlistUrl.searchParams.get('headers');
      if (headersParam) {
        const parsedHeaders = JSON.parse(headersParam);
        if (parsedHeaders.referer) {
          referer = parsedHeaders.referer;
        }
      }
    } catch {
      // URL parsing failed, use default referer
    }

    sources.push({
      quality: 'auto',
      title: `VidLink (${data.sourceId || 'Primary'})`,
      url: data.stream.playlist,
      type: 'hls',
      referer,
      requiresSegmentProxy: true,
      status: 'working',
      language: 'en',
    });
  }

  // Legacy format: sources array
  if (data.sources && data.sources.length > 0) {
    for (let i = 0; i < data.sources.length; i++) {
      const src = data.sources[i];
      const streamUrl = src.url || src.file || '';
      if (!streamUrl) continue;
      sources.push({
        quality: src.quality || src.label || 'auto',
        title: src.label || `VidLink Source ${i + 1}`,
        url: streamUrl,
        type: 'hls',
        referer: 'https://vidlink.pro/',
        requiresSegmentProxy: true,
        status: 'working',
        language: 'en',
      });
    }
  }

  if (sources.length === 0) {
    return { success: false, sources: [], error: 'No stream URLs in VidLink response' };
  }

  const subtitles = extractSubtitles(data);

  console.log(`[VidLink] Found ${sources.length} source(s), ${subtitles.length} subtitle(s)`);

  return {
    success: true,
    sources,
    subtitles: subtitles.length > 0 ? subtitles : undefined,
  };
}

// ============================================================================
// Fetch Specific Source By Name (for manual source selection in UI)
// ============================================================================

/**
 * Fetch a specific source by name.
 * VidLink only returns one source per request, so this just re-fetches.
 */
export async function fetchVidLinkSourceByName(
  _sourceName: string,
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<StreamSource | null> {
  console.log(`[VidLink] Fetching source for ${type} ID ${tmdbId}`);

  const result = await extractVidLinkStreams(tmdbId, type, season, episode);
  return result.sources[0] || null;
}

// Keep SOURCES export for backward compatibility (used by extract route)
export const VIDLINK_SOURCES = [
  { name: 'VidLink', endpoint: 'vidlink', language: 'en', languageName: 'English', priority: 1, movieOnly: false },
];
