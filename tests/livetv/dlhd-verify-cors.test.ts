/**
 * Test if chevy.soyspace.cyou/verify has CORS headers that allow
 * browser-side POST from a different origin.
 *
 * If it does → client can POST directly, whitelisting its own IP.
 * If not → we need the no-cors fetch approach or a different strategy.
 */

import { describe, test } from 'bun:test';

const CDN_DOMAIN = 'soyspace.cyou';

describe('DLHD Verify CORS Check', () => {

  test('OPTIONS preflight to /verify', async () => {
    console.log('\n═══ CORS Preflight Check ═══\n');

    const resp = await fetch(`https://chevy.${CDN_DOMAIN}/verify`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://flyx.tv',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    console.log(`Status: ${resp.status}`);
    console.log('Response headers:');
    resp.headers.forEach((v, k) => console.log(`  ${k}: ${v}`));

    const acao = resp.headers.get('access-control-allow-origin');
    const acam = resp.headers.get('access-control-allow-methods');
    const acah = resp.headers.get('access-control-allow-headers');

    console.log(`\nAccess-Control-Allow-Origin: ${acao || 'NOT SET'}`);
    console.log(`Access-Control-Allow-Methods: ${acam || 'NOT SET'}`);
    console.log(`Access-Control-Allow-Headers: ${acah || 'NOT SET'}`);

    if (acao === '*' || acao === 'https://flyx.tv') {
      console.log('\n✅ CORS allows cross-origin POST — client can verify directly!');
    } else if (acao) {
      console.log(`\n🔶 CORS allows origin: ${acao} — may need to spoof origin`);
    } else {
      console.log('\n❌ No CORS headers — browser will block cross-origin POST response');
      console.log('   But: mode:"no-cors" POST will still SEND (just can\'t read response)');
    }
  }, 10000);

  test('actual POST to /verify with dummy token (check CORS on response)', async () => {
    console.log('\n═══ Actual POST CORS Check ═══\n');

    const resp = await fetch(`https://chevy.${CDN_DOMAIN}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://flyx.tv',
        'Referer': 'https://flyx.tv/',
      },
      body: JSON.stringify({
        'recaptcha-token': 'dummy_test_token',
        'channel_id': 'premium44',
      }),
    });

    console.log(`Status: ${resp.status}`);
    console.log('Response headers:');
    resp.headers.forEach((v, k) => console.log(`  ${k}: ${v}`));

    const body = await resp.text();
    console.log(`Body: ${body.substring(0, 300)}`);

    const acao = resp.headers.get('access-control-allow-origin');
    if (acao) {
      console.log(`\n✅ Response has ACAO: ${acao}`);
    } else {
      console.log('\n❌ No ACAO on response — browser would block reading it');
      console.log('   But the POST still reaches the server and whitelists the IP');
      console.log('   → Use mode:"no-cors" and assume success if no network error');
    }
  }, 10000);

  test('POST with ksohls.ru origin (what the real player uses)', async () => {
    console.log('\n═══ POST with ksohls.ru Origin ═══\n');

    const resp = await fetch(`https://chevy.${CDN_DOMAIN}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.ksohls.ru',
        'Referer': 'https://www.ksohls.ru/',
      },
      body: JSON.stringify({
        'recaptcha-token': 'dummy_test_token',
        'channel_id': 'premium44',
      }),
    });

    console.log(`Status: ${resp.status}`);
    const acao = resp.headers.get('access-control-allow-origin');
    console.log(`ACAO: ${acao || 'NOT SET'}`);
    resp.headers.forEach((v, k) => console.log(`  ${k}: ${v}`));
    const body = await resp.text();
    console.log(`Body: ${body.substring(0, 300)}`);
  }, 10000);
});
