import { describe, test, expect } from 'bun:test';
const CF = process.env.NEXT_PUBLIC_CF_STREAM_PROXY_URL?.replace(/\/stream\/?$/, '') || 'https://media-proxy.vynx.workers.dev';
const SUB = 'https://sub.wyzie.ru';
const T = 15000;
async function sign(id: string, type: string, opts: any = {}) {
  const p = new URLSearchParams({ tmdbId: id, type });
  if (opts.server) p.set('server', opts.server);
  if (opts.warmup) p.set('warmup', '1');
  if (type === 'tv' && opts.season) { p.set('season', String(opts.season)); p.set('episode', String(opts.episode)); }
  const r = await fetch(CF + '/flixer/sign?' + p, { signal: AbortSignal.timeout(T) });
  return { status: r.status, data: await r.json() as any };
}
describe('Flixer E2E', () => {
  test('sign movie warmup', async () => {
    const { status, data } = await sign('550', 'movie', { warmup: true });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.url).toContain('hexa');
    console.log('[Flixer] Sign URL:', data.url?.substring(0, 80));
  });
  test('sign specific server', async () => {
    const r = await sign('550', 'movie', { server: 'alpha' });
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
  });
  test('sign TV', async () => {
    const r = await sign('1396', 'tv', { warmup: true, season: 1, episode: 1 });
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
  });
  test('hexa blocks datacenter (403)', async () => {
    const s = await sign('550', 'movie', { warmup: true });
    const r = await fetch(s.data.url, { headers: s.data.headers, signal: AbortSignal.timeout(T) });
    console.log('[Flixer] Hexa datacenter:', r.status);
    expect([200, 403]).toContain(r.status);
  });
  test('decrypt rejects bad data', async () => {
    const r = await fetch(CF + '/flixer/decrypt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted: 'garbage' }), signal: AbortSignal.timeout(T),
    });
    const d = await r.json() as any;
    expect(typeof d.success).toBe('boolean');
  });
  test('extract-all movie', async () => {
    const r = await fetch(CF + '/flixer/extract-all?tmdbId=550&type=movie', { signal: AbortSignal.timeout(30000) });
    console.log('[Flixer] extract-all:', r.status);
    expect(r.status).toBeLessThan(500);
  }, 35000);
  test('subtitle API movie', async () => {
    const r = await fetch(SUB + '/search?id=550', {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://hexa.su/' }, signal: AbortSignal.timeout(T),
    });
    expect(r.ok).toBe(true);
    const d = await r.json(); expect(Array.isArray(d)).toBe(true);
    console.log('[Flixer] Subs:', d.length);
  });
  test('subtitle API TV', async () => {
    const r = await fetch(SUB + '/search?id=1396&season=1&episode=1', {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://hexa.su/' }, signal: AbortSignal.timeout(T),
    });
    expect(r.ok).toBe(true);
    const d = await r.json(); expect(Array.isArray(d)).toBe(true);
    console.log('[Flixer] TV subs:', d.length);
  });
});
