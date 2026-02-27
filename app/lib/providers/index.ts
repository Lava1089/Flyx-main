/**
 * Provider Registry Index
 *
 * Instantiates all provider modules and registers them in a default ProviderRegistry.
 * Requirements: 2.4, 2.5
 */

import { ProviderRegistry } from './registry';
import { FlixerProvider } from './flixer';
import { VidLinkProvider } from './vidlink';
import { AnimeKaiProvider } from './animekai';
import { HiAnimeProvider } from './hianime';
import { VidSrcProvider } from './vidsrc';
import { MultiEmbedProvider } from './multi-embed';
import { DLHDProvider } from './dlhd';
import { VIPRowProvider } from './viprow';
import { PPVProvider } from './ppv';
import { CDNLiveProvider } from './cdn-live';
import { IPTVProvider } from './iptv';

// Create and populate the default registry
const registry = new ProviderRegistry();

registry.register(new FlixerProvider());
registry.register(new VidLinkProvider());
registry.register(new AnimeKaiProvider());
registry.register(new HiAnimeProvider());
registry.register(new VidSrcProvider());
registry.register(new MultiEmbedProvider());
registry.register(new DLHDProvider());
registry.register(new VIPRowProvider());
registry.register(new PPVProvider());
registry.register(new CDNLiveProvider());
registry.register(new IPTVProvider());

export { registry };
export { ProviderRegistry } from './registry';
export type {
  Provider,
  ProviderConfig,
  ExtractionRequest,
  ExtractionResult,
  StreamSource,
  SubtitleTrack,
  MediaType,
  ContentCategory,
} from './types';
