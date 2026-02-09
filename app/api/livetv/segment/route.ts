/**
 * Live TV Segment Proxy
 * 
 * Proxies video segments from DLHD CDN through RPI proxy.
 * This is needed because the CDN blocks direct browser requests.
 * 
 * NOTE: For reduced bandwidth costs, consider using the Cloudflare Worker proxy instead.
 * Set NEXT_PUBLIC_CF_TV_PROXY_URL to enable Cloudflare Workers.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

// RPI proxy for fetching segments
const RPI_PROXY_URL = process.env.RPI_PROXY_URL;
const RPI_PROXY_KEY = process.env.RPI_PROXY_KEY;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get('url');

    if (!url) {
      return NextResponse.json(
        { error: 'Missing URL parameter' },
        { status: 400 }
      );
    }

    const decodedUrl = decodeURIComponent(url);
    
    // Use RPI proxy if available, otherwise direct fetch
    let response: Response;
    
    if (RPI_PROXY_URL && RPI_PROXY_KEY) {
      const proxyUrl = `${RPI_PROXY_URL}/proxy?url=${encodeURIComponent(decodedUrl)}`;
      response = await fetch(proxyUrl, {
        headers: { 'X-API-Key': RPI_PROXY_KEY },
        cache: 'no-store',
      });
    } else {
      // Fallback to direct fetch (may not work due to CDN blocks)
      response = await fetch(decodedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://epaly.fun/',
          'Origin': 'https://epaly.fun',
          'Accept': '*/*',
        },
      });
    }

    if (!response.ok) {
      console.error(`[Segment] Upstream error: ${response.status} for ${decodedUrl.substring(0, 80)}`);
      return NextResponse.json(
        { error: `Upstream error: ${response.status}` },
        { status: response.status }
      );
    }

    const arrayBuffer = await response.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp2t',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        // Cache segments for 5 minutes - they don't change
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Content-Length': arrayBuffer.byteLength.toString(),
      },
    });

  } catch (error) {
    console.error('[LiveTV Segment] Error:', error);
    return NextResponse.json(
      { error: 'Segment proxy error' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
    },
  });
}
