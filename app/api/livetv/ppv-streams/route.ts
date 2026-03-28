/**
 * PPV.to Streams API
 * Fetches live event catalog from api.ppv.to/api/streams
 * Returns normalized events for the LiveTV page.
 */

import { NextResponse } from 'next/server';

export const runtime = 'edge';

const PPV_API = 'https://api.ppv.to/api/streams';

// Map PPV category names to normalized sport slugs
const CATEGORY_MAP: Record<string, string> = {
  'Combat Sports': 'mma',
  'Basketball (NBA)': 'basketball',
  'Basketball (March Madness)': 'basketball',
  'Ice Hockey (NHL)': 'hockey',
  'Baseball (MLB)': 'baseball',
  'Football': 'soccer',
  'Mens International Friendly': 'soccer',
  'Motorsports': 'motorsport',
  'Wrestling': 'wrestling',
  'Arm Wrestling': 'wrestling',
  '24/7 Streams': '24/7',
};

function normalizeSport(categoryName: string): string {
  // Direct mapping
  if (CATEGORY_MAP[categoryName]) return CATEGORY_MAP[categoryName];
  // Fuzzy match
  const lower = categoryName.toLowerCase();
  if (lower.includes('basketball') || lower.includes('nba') || lower.includes('march madness')) return 'basketball';
  if (lower.includes('hockey') || lower.includes('nhl')) return 'hockey';
  if (lower.includes('baseball') || lower.includes('mlb')) return 'baseball';
  if (lower.includes('football') || lower.includes('soccer') || lower.includes('friendly')) return 'soccer';
  if (lower.includes('combat') || lower.includes('ufc') || lower.includes('boxing') || lower.includes('mma')) return 'mma';
  if (lower.includes('motorsport') || lower.includes('f1') || lower.includes('nascar') || lower.includes('supercross') || lower.includes('mxgp') || lower.includes('rally')) return 'motorsport';
  if (lower.includes('wrestling') || lower.includes('aew') || lower.includes('wwe')) return 'wrestling';
  if (lower.includes('24/7')) return '24/7';
  return 'other';
}

/**
 * Extract the poocloud stream slug from the poster thumbnail URL.
 * e.g., "https://thumbs.poocloud.in/southpark/preview.jpg" -> "southpark"
 * For live events, the slug is extracted from the uri_name.
 */
function extractStreamSlug(posterUrl?: string, uriName?: string): string | null {
  // Try poster URL first (reliable for 24/7 streams)
  if (posterUrl) {
    const match = posterUrl.match(/poocloud\.in\/([^/]+)\//);
    if (match) return match[1];
  }
  // For live sports, the uri_name IS the slug used in the embed
  // The JS bundle on pooembed.eu resolves this to the actual poocloud path
  return uriName || null;
}

export async function GET() {
  try {
    const res = await fetch(PPV_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      cf: { cacheTtl: 30, cacheEverything: true },
    } as RequestInit);

    if (!res.ok) {
      return NextResponse.json({ success: false, error: `PPV API returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    if (!data.success || !data.streams) {
      return NextResponse.json({ success: false, error: 'PPV API returned no streams' }, { status: 502 });
    }

    const events: any[] = [];

    for (const category of data.streams) {
      const categoryName = category.category || 'Other';
      const sport = normalizeSport(categoryName);

      for (const stream of category.streams || []) {
        const isAlwaysLive = !!stream.always_live;
        const now = Date.now() / 1000;
        const startsAt = stream.starts_at || 0;
        const endsAt = stream.ends_at || 0;

        // Determine if currently live
        let isLive = isAlwaysLive;
        if (!isAlwaysLive && startsAt > 0) {
          // Live if started and not ended (or no end time)
          isLive = now >= startsAt && (endsAt === 0 || now <= endsAt);
        }

        // Human-readable time
        let time = '';
        let startsIn = '';
        if (isAlwaysLive) {
          time = '24/7';
        } else if (startsAt > 0) {
          const startDate = new Date(startsAt * 1000);
          time = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          if (!isLive && startsAt > now) {
            const diffMin = Math.round((startsAt - now) / 60);
            if (diffMin < 60) startsIn = `${diffMin}m`;
            else if (diffMin < 1440) startsIn = `${Math.round(diffMin / 60)}h`;
            else startsIn = `${Math.round(diffMin / 1440)}d`;
          }
        }

        const streamSlug = extractStreamSlug(stream.poster, stream.uri_name);

        events.push({
          id: `ppv-${stream.id}`,
          title: stream.name,
          sport,
          league: categoryName,
          time,
          isoTime: startsAt > 0 ? new Date(startsAt * 1000).toISOString() : undefined,
          isLive,
          startsIn,
          poster: stream.poster,
          viewers: stream.viewers,
          alwaysLive: isAlwaysLive,
          // PPV-specific fields for stream resolution
          ppvSlug: streamSlug,
          ppvId: stream.id,
          uriName: stream.uri_name,
          startsAt: startsAt > 0 ? startsAt : undefined,
          endsAt: endsAt > 0 ? endsAt : undefined,
        });
      }
    }

    return NextResponse.json({
      success: true,
      events,
      count: events.length,
      timestamp: Date.now(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch (error: any) {
    console.error('[PPV] API fetch error:', error);
    return NextResponse.json({ success: false, error: error.message || 'PPV fetch failed' }, { status: 500 });
  }
}
