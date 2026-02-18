/**
 * Stream Extract API - Multi-Provider Stream Extraction
 * 
 * Provider Priority (February 2026):
 * - For ANIME content: AnimeKai (PRIMARY) → VidLink (fallback)
 * - For other content: Flixer (PRIMARY) → VidLink → 1movies → VidSrc → SmashyStream → MultiMovies → MultiEmbed/Hexa
 * 
 * NOTE: Flixer is PRIMARY - WASM-based extraction, 12 NATO servers (alpha-lima), most reliable.
 *       VidLink is SECONDARY - Go WASM token generation + plain JSON API.
 *       MultiEmbed/Hexa - 8 hexawatch servers (DOG, CAT, RABBIT, DOVE, GEESE, POLARIS, GALAXY, MOON).
 *       VidSrc is deprioritized due to Cloudflare Turnstile blocking ~80% of content.
 *       1movies is DISABLED.
 * 
 * GET /api/stream/extract?tmdbId=550&type=movie
 * GET /api/stream/extract?tmdbId=1396&type=tv&season=1&episode=1
 * GET /api/stream/extract?tmdbId=507089&type=movie&provider=vidlink
 * GET /api/stream/extract?tmdbId=507089&type=movie&provider=animekai
 * GET /api/stream/extract?tmdbId=507089&type=movie&provider=vidsrc
 * GET /api/stream/extract?tmdbId=507089&type=movie&provider=flixer
 * GET /api/stream/extract?tmdbId=507089&type=movie&provider=1movies
 * GET /api/stream/extract?tmdbId=507089&type=movie&provider=smashystream
 * GET /api/stream/extract?tmdbId=507089&type=movie&provider=multimovies
 * GET /api/stream/extract?tmdbId=507089&type=movie&provider=multiembed
 * GET /api/stream/extract?tmdbId=507089&type=movie&provider=hexa
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractOneMoviesStreams, fetchOneMoviesSourceByName, ONEMOVIES_ENABLED } from '@/app/lib/services/onemovies-extractor';
import { extractVidSrcStreams, VIDSRC_ENABLED } from '@/app/lib/services/vidsrc-extractor';
import { extractVidLinkStreams, fetchVidLinkSourceByName } from '@/app/lib/services/vidlink-extractor';
import { extractAnimeKaiStreams, fetchAnimeKaiSourceByName, isAnimeContent, ANIMEKAI_ENABLED } from '@/app/lib/services/animekai-extractor';
import { extractMultiEmbedStreams, fetchMultiEmbedSourceByName, MULTI_EMBED_ENABLED } from '@/app/lib/services/multi-embed-extractor';
import { extractSmashyStreamStreams, fetchSmashyStreamSourceByName, SMASHYSTREAM_ENABLED } from '@/app/lib/services/smashystream-extractor';
import { extractMultiMoviesStreams, fetchMultiMoviesSourceByName, MULTIMOVIES_ENABLED } from '@/app/lib/services/multimovies-extractor';
import { extractFlixerStreams, fetchFlixerSourceByName, FLIXER_ENABLED } from '@/app/lib/services/flixer-extractor';
import { performanceMonitor } from '@/app/lib/utils/performance-monitor';
import { getAnimeKaiProxyUrl } from '@/app/lib/proxy-config';

// Node.js runtime (default) - required for fetch

// ============================================================================
// RATE LIMITING & ANTI-ABUSE
// ============================================================================
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIP(request: NextRequest): string {
  // Check Cloudflare headers first
  const cfIP = request.headers.get('cf-connecting-ip');
  if (cfIP) return cfIP;
  
  // Check X-Forwarded-For
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  
  // Check X-Real-IP
  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;
  
  // Fallback to 'unknown' (should never happen in production)
  return 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  // Clean up expired entries periodically
  if (rateLimitMap.size > 10000) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (value.resetAt < now) {
        rateLimitMap.delete(key);
      }
    }
  }
  
  if (!record || record.resetAt < now) {
    // New window
    const resetAt = now + RATE_LIMIT_WINDOW;
    rateLimitMap.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt };
  }
  
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    // Rate limit exceeded
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }
  
  // Increment count
  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - record.count, resetAt: record.resetAt };
}

// Helper to conditionally proxy URLs based on requiresSegmentProxy flag
// ALL provider streams go through /animekai route -> RPI residential proxy
// The /stream route should NOT be used for any provider
function maybeProxyUrl(source: any, provider: string): string {
  if (!source.url) return '';
  // Only proxy if requiresSegmentProxy is true (default behavior for most sources)
  if (source.requiresSegmentProxy === false) {
    return source.url; // Return direct URL - browser will fetch directly
  }
  
  // ALL providers route through /animekai -> RPI residential proxy
  const proxiedUrl = getAnimeKaiProxyUrl(source.url);
  console.log(`[maybeProxyUrl] provider=${provider}, → Using /animekai route (residential proxy): ${proxiedUrl.substring(0, 80)}...`);
  return proxiedUrl;
}

// Enhanced in-memory cache with LRU eviction
const cache = new Map<string, { sources: any[]; timestamp: number; hits: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 500; // Maximum cache entries

// Request deduplication - prevent duplicate concurrent requests
const pendingRequests = new Map<string, Promise<any>>();

// Cache management - LRU eviction
function evictOldestCacheEntry() {
  if (cache.size < MAX_CACHE_SIZE) return;

  let oldestKey = '';
  let oldestTime = Date.now();
  let lowestHits = Infinity;

  // Find least recently used with lowest hits
  const entries = Array.from(cache.entries());
  for (const [key, value] of entries) {
    if (value.timestamp < oldestTime || (value.timestamp === oldestTime && value.hits < lowestHits)) {
      oldestTime = value.timestamp;
      lowestHits = value.hits;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    cache.delete(oldestKey);
    console.log(`[CACHE] Evicted: ${oldestKey}`);
  }
}


/**
 * GET /api/stream/extract
 * 
 * Query params:
 * - tmdbId: TMDB ID (required)
 * - type: 'movie' or 'tv' (required)
 * - season: Season number (required for TV)
 * - episode: Episode number (required for TV)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // ============================================================================
    // RATE LIMITING - Prevent abuse and bandwidth exhaustion
    // ============================================================================
    const clientIP = getClientIP(request);
    const rateLimit = checkRateLimit(clientIP);
    
    if (!rateLimit.allowed) {
      console.warn(`[EXTRACT] Rate limit exceeded for IP: ${clientIP}`);
      return NextResponse.json(
        {
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please wait before making more requests.',
          retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': RATE_LIMIT_MAX_REQUESTS.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimit.resetAt.toString(),
            'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    const searchParams = request.nextUrl.searchParams;

    // Parse parameters
    const tmdbId = searchParams.get('tmdbId') || '';
    const type = searchParams.get('type') as 'movie' | 'tv';
    const season = searchParams.get('season') ? parseInt(searchParams.get('season')!) : undefined;
    let episode = searchParams.get('episode') ? parseInt(searchParams.get('episode')!) : undefined;
    const originalEpisode = episode; // Save for cache key
    const provider = searchParams.get('provider') || 'auto';
    const sourceName = searchParams.get('source'); // Optional: fetch specific source by name
    
    // ============================================================================
    // INPUT VALIDATION - Prevent injection and abuse
    // ============================================================================
    
    // MAL info for anime - used to get correct episode from AnimeKai
    // When MAL splits a TMDB season into multiple parts, we need to use the MAL ID
    // and calculate the episode number within that MAL part
    let malId = searchParams.get('malId') ? parseInt(searchParams.get('malId')!) : undefined;
    let malTitle = searchParams.get('malTitle') || undefined;
    
    // Validate TMDB ID format (should be numeric)
    // Allow tmdbId=0 when malId is provided (MAL-direct anime streaming)
    if (!tmdbId || !/^\d+$/.test(tmdbId)) {
      return NextResponse.json(
        { error: 'Invalid tmdbId format. Must be a positive integer.' },
        { status: 400 }
      );
    }
    
    // If tmdbId is 0, malId MUST be provided (MAL-direct anime)
    if (tmdbId === '0' && !malId) {
      return NextResponse.json(
        { error: 'malId is required when tmdbId is 0 (MAL-direct anime streaming)' },
        { status: 400 }
      );
    }
    
    // Validate type
    if (!type || !['movie', 'tv'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid or missing type (must be "movie" or "tv")' },
        { status: 400 }
      );
    }
    
    // Validate season/episode for TV shows (skip for MAL-direct movies)
    const isMalDirectMovie = tmdbId === '0' && malId && type === 'movie';
    if (type === 'tv' && !isMalDirectMovie) {
      if (!season || season < 0 || season > 100) {
        return NextResponse.json(
          { error: 'Invalid season number (must be between 1-100)' },
          { status: 400 }
        );
      }
      if (!episode || episode < 0 || episode > 1000) {
        return NextResponse.json(
          { error: 'Invalid episode number (must be between 1-1000)' },
          { status: 400 }
        );
      }
    }
    
    // Validate provider (whitelist)
    const validProviders = ['auto', 'animekai', 'vidsrc', 'flixer', '1movies', 'vidlink', 'smashystream', 'multimovies', 'multiembed', 'hexa'];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` },
        { status: 400 }
      );
    }
    
    // Validate source name if provided (prevent injection)
    if (sourceName && (sourceName.length > 100 || /[<>\"']/.test(sourceName))) {
      return NextResponse.json(
        { error: 'Invalid source name format' },
        { status: 400 }
      );
    }
    
    // IMPORTANT: For anime with absolute episode numbering (like JJK), calculate the correct MAL entry
    // JJK on TMDB uses absolute numbering: all episodes in Season 1
    // But MAL has separate entries: S1 (24 eps), S2 (23 eps), S3 (12 eps)
    // We need to convert absolute episode number to the correct MAL entry + relative episode
    if (type === 'tv' && episode && !malId) {
      const { malService } = await import('@/lib/services/mal');
      const tmdbIdNum = parseInt(tmdbId);
      
      if (malService.usesAbsoluteEpisodeNumbering(tmdbIdNum)) {
        const malEntry = malService.getMALEntryForAbsoluteEpisode(tmdbIdNum, episode);
        if (malEntry) {
          // ALWAYS log for JJK to debug the issue
          const isJJK = tmdbIdNum === 95479;
          if (isJJK || process.env.NODE_ENV === 'development' || process.env.DEBUG_MAL === 'true') {
            console.log('[EXTRACT] *** MAL ABSOLUTE EPISODE CONVERSION ***', {
              tmdbId,
              originalEpisode: episode,
              converted: {
                malId: malEntry.malId,
                malTitle: malEntry.malTitle,
                relativeEpisode: malEntry.relativeEpisode
              }
            });
          }
          
          malId = malEntry.malId;
          malTitle = malEntry.malTitle;
          // Update episode to be relative to the MAL entry
          episode = malEntry.relativeEpisode;
          
          if (isJJK) {
            console.log(`[EXTRACT] *** JJK DETECTED: Will pass malId=${malId}, malTitle="${malTitle}", episode=${episode} to AnimeKai extractor ***`);
          }
        }
      }
    }

    console.log('[EXTRACT] Request:', { tmdbId, type, season, episode, provider, sourceName, malId, malTitle });
    performanceMonitor.start('stream-extraction');

    // If requesting a specific source by name, fetch it directly (no cache)
    if (sourceName) {
      console.log(`[EXTRACT] Fetching specific source: ${sourceName} (provider: ${provider})`);
      
      let source = null;
      let usedProvider = provider;
      
      // Try to fetch from the appropriate provider
      if (sourceName.includes('AnimeKai') || provider === 'animekai') {
        source = await fetchAnimeKaiSourceByName(sourceName, tmdbId, type, season, episode, malId, malTitle);
        usedProvider = 'animekai';
      } else if (sourceName.includes('1movies') || provider === '1movies') {
        source = await fetchOneMoviesSourceByName(sourceName, tmdbId, type, season, episode);
        usedProvider = '1movies';
      } else if (provider === 'flixer' || sourceName.includes('Flixer')) {
        source = await fetchFlixerSourceByName(sourceName, tmdbId, type, season, episode);
        usedProvider = 'flixer';
      } else if (provider === 'smashystream' || sourceName.includes('SmashyStream')) {
        source = await fetchSmashyStreamSourceByName(sourceName, tmdbId, type, season, episode);
        usedProvider = 'smashystream';
      } else if (provider === 'multimovies' || sourceName.includes('MultiMovies')) {
        source = await fetchMultiMoviesSourceByName(sourceName, tmdbId, type, season, episode);
        usedProvider = 'multimovies';
      } else if (provider === 'multiembed' || provider === 'hexa' || sourceName.includes('Hexa')) {
        source = await fetchMultiEmbedSourceByName(sourceName, tmdbId, type, season, episode);
        usedProvider = 'multiembed';
      } else if (provider === 'vidlink' || sourceName.includes('(')) {
        source = await fetchVidLinkSourceByName(sourceName, tmdbId, type, season, episode);
        usedProvider = 'vidlink';
      }
      
      if (source) {
        const executionTime = Date.now() - startTime;
        const proxiedSource = {
          quality: source.quality,
          title: source.title,
          url: maybeProxyUrl(source, usedProvider),
          directUrl: source.url,
          referer: source.referer,
          type: source.type,
          requiresSegmentProxy: source.requiresSegmentProxy,
          status: 'working',
          language: source.language || 'ja',
        };
        
        return NextResponse.json({
          success: true,
          sources: [proxiedSource],
          streamUrl: proxiedSource.url,
          url: proxiedSource.url,
          provider: usedProvider,
          requiresProxy: true,
          requiresSegmentProxy: true,
          cached: false,
          executionTime
        });
      } else {
        return NextResponse.json(
          { error: `Source "${sourceName}" not available`, success: false },
          { status: 404 }
        );
      }
    }

    // Check cache - use original episode number for cache key
    // IMPORTANT: Include malId in cache key for MAL-direct anime (tmdbId=0)
    const cacheKey = malId 
      ? `mal-${malId}-${type}-${originalEpisode || ''}-${provider}`
      : `${tmdbId}-${type}-${season || ''}-${originalEpisode || ''}-${provider}`;
    let cached = cache.get(cacheKey);

    // TEMPORARY: Force clear cache for animekai to pick up new proxy routing
    if (provider === 'animekai' && cached) {
      console.log('[EXTRACT] Clearing animekai cache to use new /animekai route');
      cache.delete(cacheKey);
      cached = undefined;
    }
    
    // TEMPORARY: Force clear cache for 1movies to pick up new extraction
    if (provider === '1movies' && cached) {
      console.log('[EXTRACT] Clearing 1movies cache to use new extraction');
      cache.delete(cacheKey);
      cached = undefined;
    }
    
    // TEMPORARY: Force clear cache for JJK to pick up new MAL conversion
    if (tmdbId === '95479' && cached) {
      console.log('[EXTRACT] Clearing JJK cache to use new MAL conversion');
      cache.delete(cacheKey);
      cached = undefined;
    }

    // Only use cache if it has valid sources with URLs
    if (cached && Date.now() - cached.timestamp < CACHE_TTL && cached.sources.length > 0 && cached.sources[0]?.url) {
      console.log(`[EXTRACT] Cache hit (${cached.hits} hits)`);

      // Update cache stats
      cached.hits++;
      cached.timestamp = Date.now(); // Refresh timestamp on access

      const executionTime = Date.now() - startTime;

      // Return multiple quality sources with status and language
      // Only proxy sources that have valid URLs
      const sources = cached.sources.map((source: any) => ({
        quality: source.quality,
        title: source.title || source.quality,
        url: maybeProxyUrl(source, provider),
        directUrl: source.url || '',
        referer: source.referer,
        type: source.type,
        requiresSegmentProxy: source.requiresSegmentProxy,
        status: source.status || 'working',
        language: source.language || 'en',
      }));

      return NextResponse.json({
        success: true,
        sources,
        // Backward compatibility - return first source as default
        streamUrl: sources[0].url,
        url: sources[0].url,
        provider: provider,
        requiresProxy: true,
        requiresSegmentProxy: true,
        cached: true,
        cacheHits: cached.hits,
        executionTime
      });
    }

    // Check if there's already a pending request for this content
    if (pendingRequests.has(cacheKey)) {
      console.log('[EXTRACT] Waiting for existing request to complete...');
      const sources = await pendingRequests.get(cacheKey)!;

      const executionTime = Date.now() - startTime;
      // Only proxy sources that have valid URLs
      const proxiedSources = sources.map((source: any) => ({
        quality: source.quality,
        title: source.title || source.quality,
        url: maybeProxyUrl(source, provider),
        directUrl: source.url || '',
        referer: source.referer,
        type: source.type,
        requiresSegmentProxy: source.requiresSegmentProxy,
        status: source.status || 'working',
        language: source.language || 'en',
      }));

      return NextResponse.json({
        success: true,
        sources: proxiedSources,
        streamUrl: proxiedSources[0]?.url || '',
        url: proxiedSources[0]?.url || '',
        provider: provider,
        requiresProxy: true,
        requiresSegmentProxy: true,
        cached: false,
        deduplicated: true,
        executionTime
      });
    }

    // Check if this is anime content (for automatic provider selection)
    // MAL-direct content (tmdbId=0 with malId) is ALWAYS anime
    let isAnime = tmdbId === '0' && malId ? true : false;
    if (!isAnime && provider !== 'animekai') {
      // Only check TMDB if not MAL-direct and not explicitly requesting animekai
      isAnime = await isAnimeContent(tmdbId, type);
      if (isAnime) {
        console.log('[EXTRACT] Detected ANIME content - will use AnimeKai as primary');
      }
    } else if (isAnime) {
      console.log('[EXTRACT] MAL-direct anime content (tmdbId=0, malId provided)');
    }

    // Create extraction based on provider preference
    const extractionPromise = (async () => {
      // If explicitly requesting animekai, use it directly (no fallback to preserve tab separation)
      if (provider === 'animekai') {
        console.log('[EXTRACT] Using AnimeKai (explicit request)...');
        if (malId) {
          console.log(`[EXTRACT] MAL info provided: ID=${malId}, Title="${malTitle}", Episode=${episode}`);
        }
        if (!ANIMEKAI_ENABLED) {
          throw new Error('AnimeKai provider is disabled');
        }
        
        console.log(`[EXTRACT] Calling extractAnimeKaiStreams with: tmdbId=${tmdbId}, season=${season}, episode=${episode}, malId=${malId}, malTitle=${malTitle}`);
        const animekaiResult = await extractAnimeKaiStreams(tmdbId, type, season, episode, malId, malTitle);
        
        if (animekaiResult.sources.length > 0) {
          console.log(`[EXTRACT] ✓ AnimeKai: ${animekaiResult.sources.length} sources`);
          return { sources: animekaiResult.sources, provider: 'animekai' };
        }
        
        throw new Error(animekaiResult.error || 'AnimeKai returned no sources');
      }
      
      // If content is anime (auto-detected) and not explicitly requesting a provider, try AnimeKai first
      if (isAnime) {
        console.log('[EXTRACT] Detected ANIME - trying AnimeKai first...');
        if (malId) {
          console.log(`[EXTRACT] MAL info provided: ID=${malId}, Title="${malTitle}", Episode=${episode}`);
        }
        if (ANIMEKAI_ENABLED) {
          try {
            console.log(`[EXTRACT] Calling extractAnimeKaiStreams with: tmdbId=${tmdbId}, season=${season}, episode=${episode}, malId=${malId}, malTitle=${malTitle}`);
            const animekaiResult = await extractAnimeKaiStreams(tmdbId, type, season, episode, malId, malTitle);
            
            if (animekaiResult.sources.length > 0) {
              const workingSources = animekaiResult.sources.filter(s => s.status === 'working');
              
              if (workingSources.length > 0) {
                console.log(`[EXTRACT] ✓ AnimeKai: ${workingSources.length} working, ${animekaiResult.sources.length} total`);
                return { sources: animekaiResult.sources, provider: 'animekai' };
              }
            }
            console.log(`[EXTRACT] AnimeKai failed: ${animekaiResult.error || 'No working sources'}`);
          } catch (animekaiError) {
            console.warn('[EXTRACT] AnimeKai error:', animekaiError instanceof Error ? animekaiError.message : animekaiError);
          }
        }
        
        // Fallback to VidLink for anime if AnimeKai fails (only for auto-detected anime, not explicit requests)
        console.log('[EXTRACT] Falling back to VidLink for anime...');
        const vidlinkResult = await extractVidLinkStreams(tmdbId, type, season, episode, true);
        const workingSources = vidlinkResult.sources.filter(s => s.status === 'working');
        
        if (workingSources.length > 0) {
          console.log(`[EXTRACT] ✓ VidLink (anime fallback): ${workingSources.length} working`);
          return { sources: vidlinkResult.sources, provider: 'vidlink' };
        }
        
        throw new Error(vidlinkResult.error || 'All anime sources failed');
      }
      
      // If explicitly requesting 1movies, use it directly (no fallback to preserve tab separation)
      if (provider === '1movies') {
        if (!ONEMOVIES_ENABLED) {
          throw new Error('1movies provider is disabled');
        }
        
        console.log('[EXTRACT] Using 1movies (explicit request)...');
        const onemoviesResult = await extractOneMoviesStreams(tmdbId, type, season, episode);
        
        if (onemoviesResult.sources.length > 0) {
          console.log(`[EXTRACT] ✓ 1movies: ${onemoviesResult.sources.length} sources`);
          return { sources: onemoviesResult.sources, provider: '1movies' };
        }
        
        throw new Error(onemoviesResult.error || '1movies returned no sources');
      }
      
      // If explicitly requesting flixer, use it directly
      if (provider === 'flixer') {
        if (!FLIXER_ENABLED) {
          throw new Error('Flixer provider is disabled');
        }
        
        console.log('[EXTRACT] Using Flixer (explicit request)...');
        const flixerResult = await extractFlixerStreams(tmdbId, type, season, episode);
        
        if (flixerResult.sources.length > 0) {
          console.log(`[EXTRACT] ✓ Flixer: ${flixerResult.sources.length} sources`);
          return { sources: flixerResult.sources, provider: 'flixer' };
        }
        
        throw new Error(flixerResult.error || 'Flixer returned no sources');
      }
      
      // If explicitly requesting vidlink, use it directly
      if (provider === 'vidlink') {
        console.log('[EXTRACT] Using VidLink (explicit request)...');
        const vidlinkResult = await extractVidLinkStreams(tmdbId, type, season, episode);
        
        if (vidlinkResult.sources.length > 0) {
          const workingSources = vidlinkResult.sources.filter(s => s.status === 'working');
          
          if (workingSources.length > 0) {
            console.log(`[EXTRACT] ✓ VidLink: ${workingSources.length} working, ${vidlinkResult.sources.length} total`);
            return { sources: vidlinkResult.sources, provider: 'vidlink' };
          }
        }
        
        if (vidlinkResult.sources.length > 0) {
          console.log(`[EXTRACT] VidLink: ${vidlinkResult.sources.length} sources (none working)`);
          return { sources: vidlinkResult.sources, provider: 'vidlink' };
        }
        
        throw new Error(vidlinkResult.error || 'VidLink returned no sources');
      }
      
      // If explicitly requesting vidsrc, use it directly (no fallback to preserve tab separation)
      if (provider === 'vidsrc') {
        if (!VIDSRC_ENABLED) {
          throw new Error('VidSrc provider is disabled. Set ENABLE_VIDSRC_PROVIDER=true to enable.');
        }
        
        console.log('[EXTRACT] Using VidSrc (explicit request)...');
        const vidsrcResult = await extractVidSrcStreams(tmdbId, type, season, episode);
        
        if (vidsrcResult.sources.length > 0) {
          console.log(`[EXTRACT] ✓ VidSrc: ${vidsrcResult.sources.length} sources`);
          return { sources: vidsrcResult.sources, provider: 'vidsrc' };
        }
        
        // Check if it's a Turnstile block - return specific error
        if (vidsrcResult.error?.includes('Turnstile')) {
          throw new Error('VidSrc is currently protected by Cloudflare. Try Flixer or 1movies instead.');
        }
        
        throw new Error(vidsrcResult.error || 'VidSrc returned no sources');
      }
      
      // If explicitly requesting smashystream, use it directly
      if (provider === 'smashystream') {
        if (!SMASHYSTREAM_ENABLED) {
          throw new Error('SmashyStream provider is disabled');
        }
        
        console.log('[EXTRACT] Using SmashyStream (explicit request)...');
        const smashyResult = await extractSmashyStreamStreams(tmdbId, type, season, episode);
        
        if (smashyResult.sources.length > 0) {
          console.log(`[EXTRACT] ✓ SmashyStream: ${smashyResult.sources.length} sources`);
          return { sources: smashyResult.sources, provider: 'smashystream' };
        }
        
        throw new Error(smashyResult.error || 'SmashyStream returned no sources');
      }
      
      // If explicitly requesting multimovies, use it directly
      if (provider === 'multimovies') {
        if (!MULTIMOVIES_ENABLED) {
          throw new Error('MultiMovies provider is disabled');
        }
        
        console.log('[EXTRACT] Using MultiMovies (explicit request)...');
        const multiMoviesResult = await extractMultiMoviesStreams(tmdbId, type, season, episode);
        
        if (multiMoviesResult.sources.length > 0) {
          console.log(`[EXTRACT] ✓ MultiMovies: ${multiMoviesResult.sources.length} sources`);
          return { sources: multiMoviesResult.sources, provider: 'multimovies' };
        }
        
        throw new Error(multiMoviesResult.error || 'MultiMovies returned no sources');
      }
      
      // If explicitly requesting multiembed or hexa, use it directly
      if (provider === 'multiembed' || provider === 'hexa') {
        if (!MULTI_EMBED_ENABLED) {
          throw new Error('MultiEmbed provider is disabled');
        }
        
        console.log('[EXTRACT] Using MultiEmbed (explicit request)...');
        const multiEmbedResult = await extractMultiEmbedStreams(tmdbId, type, season, episode);
        
        if (multiEmbedResult.sources.length > 0) {
          const workingSources = multiEmbedResult.sources.filter(s => s.status === 'working');
          
          if (workingSources.length > 0) {
            console.log(`[EXTRACT] ✓ MultiEmbed: ${workingSources.length} working, ${multiEmbedResult.sources.length} total`);
            return { sources: multiEmbedResult.sources, provider: 'multiembed' };
          }
        }
        
        throw new Error(multiEmbedResult.error || 'MultiEmbed returned no sources');
      }
      
      // Default behavior: Flixer FIRST (back online, WASM-based, 2-3s), then VidLink
      // NOTE: 1movies is DISABLED, SmashyStream/MultiMovies/MultiEmbed are DISABLED
      // VidSrc deprioritized due to Cloudflare Turnstile
      
      // Try Flixer FIRST (WASM-based extraction, most reliable, 2-3s)
      if (FLIXER_ENABLED) {
        console.log('[EXTRACT] Trying PRIMARY source: Flixer (WASM-based)...');
        try {
          const flixerResult = await extractFlixerStreams(tmdbId, type, season, episode);
          const workingFlixer = flixerResult.sources.filter(s => s.status === 'working');
          
          if (workingFlixer.length > 0) {
            console.log(`[EXTRACT] ✓ Flixer succeeded with ${workingFlixer.length} working source(s)`);
            return { sources: flixerResult.sources, provider: 'flixer' };
          }
          console.log(`[EXTRACT] Flixer: ${flixerResult.error || 'No working sources'}`);
        } catch (flixerError) {
          console.warn('[EXTRACT] Flixer failed:', flixerError instanceof Error ? flixerError.message : flixerError);
        }
      } else {
        console.log('[EXTRACT] Flixer is DISABLED, skipping...');
      }
      
      // Try VidLink as SECOND option (Go WASM token generation, multi-language support)
      console.log('[EXTRACT] Trying secondary source: VidLink (multi-language)...');
      try {
        const vidlinkResult = await extractVidLinkStreams(tmdbId, type, season, episode, true);
        const workingVidLink = vidlinkResult.sources.filter(s => s.status === 'working');
        
        if (workingVidLink.length > 0) {
          console.log(`[EXTRACT] ✓ VidLink succeeded with ${workingVidLink.length} working source(s)`);
          return { sources: vidlinkResult.sources, provider: 'vidlink' };
        }
        console.log(`[EXTRACT] VidLink: ${vidlinkResult.error || 'No working sources'}`);
      } catch (vidlinkError) {
        console.warn('[EXTRACT] VidLink failed:', vidlinkError instanceof Error ? vidlinkError.message : vidlinkError);
      }
      
      // Try 1movies as THIRD option
      if (ONEMOVIES_ENABLED) {
        console.log('[EXTRACT] Trying fallback source: 1movies...');
        try {
          const onemoviesResult = await extractOneMoviesStreams(tmdbId, type, season, episode);
          const workingOnemovies = onemoviesResult.sources.filter(s => s.status === 'working');
          
          if (workingOnemovies.length > 0) {
            console.log(`[EXTRACT] ✓ 1movies succeeded with ${workingOnemovies.length} working source(s)`);
            return { sources: onemoviesResult.sources, provider: '1movies' };
          }
          console.log(`[EXTRACT] 1movies: ${onemoviesResult.error || 'No working sources'}`);
        } catch (onemoviesError) {
          console.warn('[EXTRACT] 1movies failed:', onemoviesError instanceof Error ? onemoviesError.message : onemoviesError);
        }
      } else {
        console.log('[EXTRACT] 1movies is DISABLED, skipping...');
      }
      
      // Try VidSrc as fallback (deprioritized due to Cloudflare Turnstile blocking most content)
      if (VIDSRC_ENABLED) {
        console.log('[EXTRACT] Trying fallback source: VidSrc (may be Turnstile-blocked)...');
        try {
          const vidsrcResult = await extractVidSrcStreams(tmdbId, type, season, episode);
          const workingVidsrc = vidsrcResult.sources.filter(s => s.status === 'working');
          
          if (workingVidsrc.length > 0) {
            console.log(`[EXTRACT] ✓ VidSrc succeeded with ${workingVidsrc.length} working source(s)`);
            return { sources: vidsrcResult.sources, provider: 'vidsrc' };
          }
          if (vidsrcResult.error?.includes('Turnstile')) {
            console.log(`[EXTRACT] VidSrc: Blocked by Cloudflare Turnstile`);
          } else {
            console.log(`[EXTRACT] VidSrc: ${vidsrcResult.error || 'No working sources'}`);
          }
        } catch (vidsrcError) {
          console.warn('[EXTRACT] VidSrc failed:', vidsrcError instanceof Error ? vidsrcError.message : vidsrcError);
        }
      } else {
        console.log('[EXTRACT] VidSrc is DISABLED, skipping...');
      }
      
      // Try SmashyStream
      if (SMASHYSTREAM_ENABLED) {
        console.log('[EXTRACT] Trying fallback source: SmashyStream...');
        try {
          const smashyResult = await extractSmashyStreamStreams(tmdbId, type, season, episode);
          const workingSmashy = smashyResult.sources.filter(s => s.status === 'working');
          
          if (workingSmashy.length > 0) {
            console.log(`[EXTRACT] ✓ SmashyStream succeeded with ${workingSmashy.length} working source(s)`);
            return { sources: smashyResult.sources, provider: 'smashystream' };
          }
        } catch (smashyError) {
          console.warn('[EXTRACT] SmashyStream failed:', smashyError instanceof Error ? smashyError.message : smashyError);
        }
      }
      
      // Try MultiMovies
      if (MULTIMOVIES_ENABLED) {
        console.log('[EXTRACT] Trying fallback source: MultiMovies...');
        try {
          const multiMoviesResult = await extractMultiMoviesStreams(tmdbId, type, season, episode);
          const workingMultiMovies = multiMoviesResult.sources.filter(s => s.status === 'working');
          
          if (workingMultiMovies.length > 0) {
            console.log(`[EXTRACT] ✓ MultiMovies succeeded with ${workingMultiMovies.length} working source(s)`);
            return { sources: multiMoviesResult.sources, provider: 'multimovies' };
          }
        } catch (multiMoviesError) {
          console.warn('[EXTRACT] MultiMovies failed:', multiMoviesError instanceof Error ? multiMoviesError.message : multiMoviesError);
        }
      }
      
      // Try MultiEmbed/Hexa sources (8 hexawatch servers)
      if (MULTI_EMBED_ENABLED) {
        console.log('[EXTRACT] Trying fallback source: MultiEmbed/Hexa...');
        try {
          const multiEmbedResult = await extractMultiEmbedStreams(tmdbId, type, season, episode);
          const workingMultiEmbed = multiEmbedResult.sources.filter(s => s.status === 'working');
          
          if (workingMultiEmbed.length > 0) {
            console.log(`[EXTRACT] ✓ MultiEmbed succeeded with ${workingMultiEmbed.length} working source(s)`);
            return { sources: multiEmbedResult.sources, provider: 'multiembed' };
          }
        } catch (multiEmbedError) {
          console.warn('[EXTRACT] MultiEmbed failed:', multiEmbedError instanceof Error ? multiEmbedError.message : multiEmbedError);
        }
      }
      
      // All providers failed
      console.log('[EXTRACT] All providers failed');
      throw new Error('All providers failed - no working sources available');
    })();

    pendingRequests.set(cacheKey, extractionPromise.then(r => r.sources));

    try {
      // Extract with automatic fallback
      const result = await extractionPromise;
      const { sources, provider: usedProvider } = result;

      // Remove from pending requests
      pendingRequests.delete(cacheKey);

      // Evict old entries if cache is full
      evictOldestCacheEntry();

      // Only cache if we have valid sources with URLs
      if (sources.length > 0 && sources[0]?.url) {
        cache.set(cacheKey, {
          sources,
          timestamp: Date.now(),
          hits: 1
        });
      } else {
        console.log(`[EXTRACT] Not caching - no valid sources with URLs`);
      }

      const executionTime = Date.now() - startTime;
      performanceMonitor.end('stream-extraction', {
        tmdbId,
        type,
        sources: sources.length,
        cached: false,
        provider: usedProvider
      });
      console.log(`[EXTRACT] Success in ${executionTime}ms - ${sources.length} qualities via ${usedProvider}`);

      // Return proxied URLs with status and language info for multi-language UI
      // Only proxy sources that have valid URLs (skip 'unknown' status sources with empty URLs)
      // MegaUp CDN sources have requiresSegmentProxy: false and won't be proxied
      const proxiedSources = sources.map((source: any) => ({
        quality: source.quality,
        title: source.title || source.quality,
        url: maybeProxyUrl(source, usedProvider),
        directUrl: source.url || '',
        referer: source.referer,
        type: source.type,
        requiresSegmentProxy: source.requiresSegmentProxy,
        status: source.status || 'working',
        language: source.language || 'en',
        // Pass through skip intro/outro data for anime
        skipIntro: source.skipIntro,
        skipOutro: source.skipOutro,
      }));

      return NextResponse.json({
        success: true,
        sources: proxiedSources,
        // Backward compatibility - return first source as default
        streamUrl: proxiedSources[0].url,
        url: proxiedSources[0].url,
        provider: usedProvider,
        requiresProxy: true,
        requiresSegmentProxy: true,
        cached: false,
        executionTime
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        }
      });
    } catch (error) {
      // Remove from pending requests on error
      pendingRequests.delete(cacheKey);
      throw error;
    }

  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('[EXTRACT] ERROR:', error);
    console.error('[EXTRACT] Stack:', error instanceof Error ? error.stack : 'No stack');

    const errorMessage = error instanceof Error ? error.message : String(error);
    const isCloudflareBlock = errorMessage.includes('Cloudflare') || errorMessage.includes('anti-bot') || errorMessage.includes('unavailable');
    const isDecoderFailed = errorMessage.includes('decoder') || errorMessage.includes('decoding');
    const isAllProvidersFailed = errorMessage.includes('All providers failed');

    return NextResponse.json(
      {
        error: isDecoderFailed ? 'Stream extraction temporarily unavailable' : isAllProvidersFailed ? 'No streams available' : isCloudflareBlock ? 'Stream source temporarily unavailable' : 'Failed to extract stream',
        details: errorMessage,
        suggestion: isDecoderFailed ? 'The stream provider has updated their protection. This will be fixed soon. Please try a different title for now.' : isAllProvidersFailed ? 'This content may not be available from any provider at the moment.' : isCloudflareBlock ? 'The stream provider is currently blocking automated requests. Please try again in a few minutes.' : 'Please try again or select a different title.',
        executionTime,
        isTemporary: true
      },
      { 
        status: 503,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        }
      }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  // ============================================================================
  // CORS - Only allow requests from your own domains
  // ============================================================================
  const origin = request.headers.get('origin');
  const allowedOrigins = [
    'https://tv.vynx.cc',
    'https://flyx.tv',
    'https://www.flyx.tv',
    process.env.NEXT_PUBLIC_APP_URL,
    // Development
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter(Boolean);
  
  // Check if origin is allowed (including Vercel/Cloudflare preview deployments)
  const isAllowed = origin && (
    allowedOrigins.includes(origin) ||
    origin.endsWith('.vercel.app') ||
    origin.endsWith('.pages.dev') ||
    origin.includes('localhost')
  );
  
  if (!isAllowed) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
