/**
 * Provider Availability API
 * Returns which stream providers are enabled/available
 * 
 * Provider Priority:
 * - Flixer: PRIMARY provider (WASM-based extraction, 2-3s)
 * - Uflix: 2nd fallback (5 embed servers via gStream API)
 * - VidSrc: 3rd fallback (Turnstile issues)
 * - 1movies: DISABLED
 * - AnimeKai: PRIMARY for anime content only (auto-detected via MAL ID)
 */

import { NextResponse } from 'next/server';
import { VIDSRC_ENABLED } from '@/app/lib/services/vidsrc-extractor';
import { ANIMEKAI_ENABLED } from '@/app/lib/services/animekai-extractor';
import { ONEMOVIES_ENABLED } from '@/app/lib/services/onemovies-extractor';
import { FLIXER_ENABLED } from '@/app/lib/services/flixer-extractor';
import { MULTI_EMBED_ENABLED } from '@/app/lib/services/multi-embed-extractor';
import { UFLIX_ENABLED } from '@/app/lib/services/uflix-extractor';

export async function GET() {
  return NextResponse.json({
    providers: {
      flixer: {
        enabled: FLIXER_ENABLED,
        name: 'Flixer',
        primary: true,
        description: 'Primary streaming source (WASM-based extraction)',
      },
      uflix: {
        enabled: UFLIX_ENABLED,
        name: 'Uflix',
        primary: false,
        description: 'Uflix.to aggregator — 5 embed servers (2embed, smashy, gdrive, vidsrc, vidplus)',
      },
      hexa: {
        enabled: MULTI_EMBED_ENABLED,
        name: 'Hexa',
        primary: false,
        description: 'Hexawatch multi-embed aggregator (8 servers)',
      },
      vidsrc: {
        enabled: VIDSRC_ENABLED,
        name: 'VidSrc',
        primary: false,
        description: 'VidSrc streaming source',
      },
      '1movies': {
        enabled: ONEMOVIES_ENABLED,
        name: '1movies',
        primary: false,
        description: '111movies.com - Multiple servers with HLS streams',
      },
      animekai: {
        enabled: ANIMEKAI_ENABLED,
        name: 'AnimeKai',
        primary: false,
        animeOnly: true,
        description: 'Specialized anime streaming with Japanese audio',
      },
    },
  });
}
