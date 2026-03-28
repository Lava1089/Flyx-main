/**
 * Domain Allowlist for Proxy Security
 * Only proxy requests to known/trusted domains.
 */

const PROXY_ALLOWED_DOMAINS = [
  // DLHD key/M3U8 servers (updated March 27, 2026)
  'soyspace.cyou', 'adsfadfds.cfd', 'dvalna.ru', 'topembed.pw', 'dlhd.link', 'dlhd.dad',
  'daddylive.mp', 'dlstreams.top', 'adffdafdsafds.sbs', 'vovlacosa.sbs', 'vmvmv.shop',
  'www.ksohls.ru', 'ksohls.ru', 'lefttoplay.xyz', 'hitsplay.fun', 'codepcplay.fun',
  'enviromentalspace.sbs', 'keylocking.ru', 'the-sunmoon.site',
  'ai-hls.site',  // New primary M3U8/key/verify server (Mar 27, 2026)
  'goalwagon.net', 'extinctdeprive.net', 'daddylivestream.com',
  // AnimeKai/MegaUp
  'megaup.net', 'megaup.live', 'megaup.cc', '4spromax.site', 'hub26link.site',
  'dev23app.site', 'net22lab.site', 'pro25zone.site', 'tech20hub.site',
  'code29wave.site', 'app28base.site', 'animekai.to', 'anikai.to', 'enc-dec.app',
  // HiAnime/MegaCloud CDN
  'hianime.to', 'hianimez.to', 'hianime.nz', 'hianime.sx', 'aniwatchtv.to',
  'megacloud.blog', 'megacloud.tv', 'mgstatics.xyz',
  // VIPRow
  'boanki.net', 'peulleieo.net', 'casthill.net', 'viprow.nu',
  // PPV
  'poocloud.in', 'modistreams.org',
  // Flixer
  'flixer.su', 'flixer.sh', 'workers.dev',
  // Uflix embed providers
  'uflix.to', '2embed.cc', 'smashystream.com', 'databasegdriveplayer.xyz', 'vidplus.to',
  // VidSrc / 2embed
  '2embed.stream', 'v1.2embed.stream', '2embed.cc', 'vidsrc-embed.ru', 'vsembed.ru',
  'vidsrc.cc', 'vidsrc.me', 'vidsrc.xyz', 'vidsrc.stream',
  'cloudnestra.com', 'cloudnestra.net',
  'shadowlandschronicles.com', 'shadowlandschronicles.net', 'shadowlandschronicles.org',
  'embedsito.com',
  // CDN-Live
  'cdn-live.tv', 'cdn-live-tv.ru', 'cdn-live-tv.cfd',
  'edge.cdn-live.ru', 'edge.cdn-live-tv.ru', 'edge.cdn-live-tv.cfd', 'edge.cdn-google.ru',
  // Moveonjoy
  'moveonjoy.com',
  // Player 6
  'lovecdn.ru', 'lovetier.bz',
  // Testing
  'example.com', 'example.org',
];

/** CDN-Live specific domains */
export const CDN_LIVE_DOMAINS = [
  'cdn-live.tv', 'cdn-live-tv.ru', 'cdn-live-tv.cfd',
  'edge.cdn-live.ru', 'edge.cdn-live-tv.ru', 'edge.cdn-live-tv.cfd', 'edge.cdn-google.ru',
];

/** Check if a URL's domain is in the proxy allowlist */
export function isAllowedProxyDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (PROXY_ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
      return true;
    }
    // MegaCloud CDN uses rotating hostnames with /_v paths
    if (parsed.pathname.startsWith('/_v')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Check if a URL belongs to a CDN-Live domain */
export function isCdnLiveDomain(urlStr: string): boolean {
  try {
    const h = new URL(urlStr).hostname.toLowerCase();
    return CDN_LIVE_DOMAINS.some(d => h === d || h.endsWith('.' + d));
  } catch {
    return false;
  }
}
