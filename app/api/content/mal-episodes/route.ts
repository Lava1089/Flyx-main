import { NextRequest, NextResponse } from 'next/server';
import { type MALEpisode } from '@/lib/services/mal';
import { cfFetch } from '@/lib/utils/cf-fetch';

export const runtime = 'edge';

// Cache episodes for 1 hour
export const revalidate = 3600;

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const malId = searchParams.get('malId');
  const page = searchParams.get('page') || '1';
  
  if (!malId) {
    return NextResponse.json({ success: false, error: 'Missing malId parameter' }, { status: 400 });
  }
  
  const malIdNum = parseInt(malId);
  const pageNum = parseInt(page);
  
  if (isNaN(malIdNum)) {
    return NextResponse.json({ success: false, error: 'Invalid malId parameter' }, { status: 400 });
  }
  
  if (isNaN(pageNum) || pageNum < 1) {
    return NextResponse.json({ success: false, error: 'Invalid page parameter' }, { status: 400 });
  }
  
  try {
    // Use cfFetch to route through RPI proxy on Cloudflare Workers
    // Jikan API blocks/rate-limits datacenter IPs aggressively
    const response = await cfFetch(`${JIKAN_BASE_URL}/anime/${malIdNum}/episodes?page=${pageNum}`);
    
    if (!response.ok) {
      console.error(`[MAL Episodes API] Jikan fetch failed: ${response.status}`);
      return NextResponse.json({ success: false, error: 'Jikan API error' }, { status: 502 });
    }
    
    const data = await response.json();
    const episodes: MALEpisode[] = data.data || [];
    const hasNextPage = data.pagination?.has_next_page || false;
    const lastPage = data.pagination?.last_visible_page || 1;
    
    return NextResponse.json({
      success: true,
      data: {
        malId: malIdNum,
        page: pageNum,
        totalPages: lastPage,
        hasNextPage,
        episodes: episodes.map((ep: MALEpisode) => ({
          number: ep.mal_id,
          title: ep.title,
          titleJapanese: ep.title_japanese,
          aired: ep.aired,
          score: ep.score,
          filler: ep.filler,
          recap: ep.recap,
        })),
      },
    });
  } catch (error) {
    console.error('[MAL Episodes API] Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch episodes' }, { status: 500 });
  }
}
