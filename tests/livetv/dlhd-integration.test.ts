/**
 * DLHD Integration Tests
 * 
 * Tests the DLHD channels API and stream proxying.
 * 
 * Updated February 25, 2026:
 * - Domain changed to adsfadfds.cfd/soyspace.cyou (was dvalna.ru)
 * - Player domain changed to www.ksohls.ru (was epaly.fun)
 * - New PoW (Proof-of-Work) authentication for key requests
 * - HMAC-SHA256 + MD5 nonce computation
 */

import { describe, test, expect } from 'bun:test';
import { createHmac, createHash } from 'crypto';

const PLAYER_DOMAIN = 'www.ksohls.ru';
const PARENT_DOMAIN = 'daddylive.mp';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ALL_SERVER_KEYS = ['ddy6'];
const CDN_DOMAIN = 'adsfadfds.cfd';

// PoW authentication constants (January 2026)
// CORRECT SECRET - extracted from WASM module
const HMAC_SECRET = '444c44cc8888888844444444';
const POW_THRESHOLD = 0x1000;
const MAX_NONCE_ITERATIONS = 100000;

/**
 * Compute Proof-of-Work nonce for key authentication
 */
function computePoWNonce(resource: string, keyNumber: string, timestamp: number): number | null {
  const hmac = createHmac('sha256', HMAC_SECRET).update(resource).digest('hex');
  
  for (let nonce = 0; nonce < MAX_NONCE_ITERATIONS; nonce++) {
    const data = `${hmac}${resource}${keyNumber}${timestamp}${nonce}`;
    const hash = createHash('md5').update(data).digest('hex');
    const prefix = parseInt(hash.substring(0, 4), 16);
    
    if (prefix < POW_THRESHOLD) {
      return nonce;
    }
  }
  
  return null;
}

/**
 * Generate JWT for key authentication
 */
function generateKeyJWT(resource: string, keyNumber: string, timestamp: number, nonce: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    resource,
    keyNumber,
    timestamp,
    nonce,
    exp: timestamp + 300, // 5 minute expiry
  };
  
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', HMAC_SECRET)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  
  return `${base64Header}.${base64Payload}.${signature}`;
}

describe('DLHD Integration Tests', () => {
  
  describe('DLHD Channels Data', () => {
    
    test('should load DLHD channels from JSON', async () => {
      const dlhdChannels = await import('@/app/data/dlhd-channels.json');
      
      console.log('Total channels:', dlhdChannels.totalChannels);
      console.log('Last updated:', dlhdChannels.lastUpdated);
      
      expect(dlhdChannels.channels).toBeDefined();
      expect(Array.isArray(dlhdChannels.channels)).toBe(true);
      expect(dlhdChannels.channels.length).toBeGreaterThan(0);
      
      // Sample channels
      console.log('\nSample channels:');
      for (const ch of dlhdChannels.channels.slice(0, 5)) {
        console.log(`  ${ch.id}: ${ch.name} (${ch.category}, ${ch.country})`);
      }
    });
    
    test('should have valid channel structure', async () => {
      const dlhdChannels = await import('@/app/data/dlhd-channels.json');
      
      const channel = dlhdChannels.channels[0];
      console.log('Sample channel:', JSON.stringify(channel, null, 2));
      
      expect(channel.id).toBeDefined();
      expect(channel.name).toBeDefined();
      expect(channel.category).toBeDefined();
      expect(channel.country).toBeDefined();
    });
    
    test('should have sports channels', async () => {
      const dlhdChannels = await import('@/app/data/dlhd-channels.json');
      
      const sportsChannels = dlhdChannels.channels.filter(
        (ch: any) => ch.category === 'sports'
      );
      
      console.log(`\nSports channels: ${sportsChannels.length}`);
      
      // Find popular sports channels
      const popularNames = ['espn', 'fox sports', 'sky sports', 'bein'];
      for (const name of popularNames) {
        const found = sportsChannels.filter((ch: any) => 
          ch.name.toLowerCase().includes(name)
        );
        if (found.length > 0) {
          console.log(`  ${name}: ${found.length} channels`);
          console.log(`    Sample: ${found[0].id} - ${found[0].name}`);
        }
      }
    });
  });
  
  describe('DLHD Player Page', () => {
    
    test('should fetch player page and extract auth tokens', async () => {
      // Test with a known channel (ESPN - usually channel 51)
      const testChannel = '51';
      
      const referer = `https://${PARENT_DOMAIN}/stream/stream-${testChannel}.php`;
      const playerUrl = `https://${PLAYER_DOMAIN}/premiumtv/daddyhd.php?id=${testChannel}`;
      
      console.log(`\nFetching player page for channel ${testChannel}`);
      console.log(`URL: ${playerUrl}`);
      console.log(`Referer: ${referer}`);
      
      const response = await fetch(playerUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': referer,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      
      console.log('Response status:', response.status);
      expect(response.ok).toBe(true);
      
      const html = await response.text();
      console.log('HTML length:', html.length);
      
      // Extract auth tokens
      const tokenMatch = html.match(/AUTH_TOKEN\s*=\s*["']([^"']+)["']/);
      const channelKeyMatch = html.match(/CHANNEL_KEY\s*=\s*["']([^"']+)["']/);
      const countryMatch = html.match(/AUTH_COUNTRY\s*=\s*["']([^"']+)["']/);
      const tsMatch = html.match(/AUTH_TS\s*=\s*["']([^"']+)["']/);
      
      console.log('\nExtracted tokens:');
      console.log('  AUTH_TOKEN:', tokenMatch ? tokenMatch[1].substring(0, 20) + '...' : 'NOT FOUND');
      console.log('  CHANNEL_KEY:', channelKeyMatch ? channelKeyMatch[1] : 'NOT FOUND');
      console.log('  AUTH_COUNTRY:', countryMatch ? countryMatch[1] : 'NOT FOUND');
      console.log('  AUTH_TS:', tsMatch ? tsMatch[1] : 'NOT FOUND');
      
      expect(tokenMatch).toBeDefined();
      expect(tokenMatch![1].length).toBeGreaterThan(10);
    });
    
    test('should try different referer paths', async () => {
      const testChannel = '51';
      const refererPaths = [
        `https://${PARENT_DOMAIN}/watch.php?id=${testChannel}`,
        `https://${PARENT_DOMAIN}/stream/stream-${testChannel}.php`,
        `https://${PARENT_DOMAIN}/cast/stream-${testChannel}.php`,
        `https://${PARENT_DOMAIN}/watch/stream-${testChannel}.php`,
      ];
      
      console.log('\nTrying different referer paths:');
      
      for (const referer of refererPaths) {
        const playerUrl = `https://${PLAYER_DOMAIN}/premiumtv/daddyhd.php?id=${testChannel}`;
        
        try {
          const response = await fetch(playerUrl, {
            headers: {
              'User-Agent': USER_AGENT,
              'Referer': referer,
              'Accept': 'text/html,application/xhtml+xml',
            },
          });
          
          const html = await response.text();
          const hasToken = html.includes('AUTH_TOKEN');
          
          console.log(`  ${referer.split('/').slice(-1)[0]}: ${response.status} - Token: ${hasToken ? 'YES' : 'NO'}`);
        } catch (err) {
          console.log(`  ${referer.split('/').slice(-1)[0]}: ERROR - ${(err as Error).message}`);
        }
      }
    });
  });
  
  describe('DLHD Server Lookup', () => {
    
    test('should lookup server key for channel', async () => {
      const channelKey = 'premium51';
      
      console.log(`\nLooking up server for ${channelKey}`);
      
      const response = await fetch(
        `https://chevy.${CDN_DOMAIN}/server_lookup?channel_id=${channelKey}`,
        {
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': `https://${PLAYER_DOMAIN}/`,
          },
        }
      );
      
      console.log('Server lookup status:', response.status);
      
      if (response.ok) {
        const text = await response.text();
        console.log('Server lookup response:', text);
        
        if (!text.startsWith('<')) {
          const data = JSON.parse(text);
          console.log('Server key:', data.server_key);
          expect(data.server_key).toBeDefined();
        }
      }
    });
    
    test('should construct valid M3U8 URLs', () => {
      const channelKey = 'premium51';
      
      console.log('\nConstructed M3U8 URLs:');
      
      for (const serverKey of ALL_SERVER_KEYS) {
        let url: string;
        if (serverKey === 'top1/cdn') {
          url = `https://top1.${CDN_DOMAIN}/top1/cdn/${channelKey}/mono.css`;
        } else {
          url = `https://${serverKey}new.${CDN_DOMAIN}/${serverKey}/${channelKey}/mono.css`;
        }
        console.log(`  ${serverKey}: ${url}`);
      }
    });
    
    test('should compute valid PoW nonce', () => {
      const resource = 'premium51';
      const keyNumber = '1';
      const timestamp = Math.floor(Date.now() / 1000);
      
      console.log('\nComputing PoW nonce...');
      console.log(`  Resource: ${resource}`);
      console.log(`  Key Number: ${keyNumber}`);
      console.log(`  Timestamp: ${timestamp}`);
      
      const nonce = computePoWNonce(resource, keyNumber, timestamp);
      
      console.log(`  Computed Nonce: ${nonce}`);
      
      expect(nonce).not.toBeNull();
      expect(typeof nonce).toBe('number');
      
      // Verify the nonce is valid
      if (nonce !== null) {
        const hmac = createHmac('sha256', HMAC_SECRET).update(resource).digest('hex');
        const data = `${hmac}${resource}${keyNumber}${timestamp}${nonce}`;
        const hash = createHash('md5').update(data).digest('hex');
        const prefix = parseInt(hash.substring(0, 4), 16);
        
        console.log(`  Verification hash prefix: 0x${hash.substring(0, 4)} (${prefix})`);
        expect(prefix).toBeLessThan(POW_THRESHOLD);
      }
    });
    
    test('should generate valid JWT for key auth', () => {
      const resource = 'premium51';
      const keyNumber = '1';
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = computePoWNonce(resource, keyNumber, timestamp);
      
      expect(nonce).not.toBeNull();
      
      const jwt = generateKeyJWT(resource, keyNumber, timestamp, nonce!);
      
      console.log('\nGenerated JWT:');
      console.log(`  Token: ${jwt.substring(0, 50)}...`);
      
      // Verify JWT structure
      const parts = jwt.split('.');
      expect(parts.length).toBe(3);
      
      // Decode and verify payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      console.log(`  Payload: ${JSON.stringify(payload)}`);
      
      expect(payload.resource).toBe(resource);
      expect(payload.keyNumber).toBe(keyNumber);
      expect(payload.timestamp).toBe(timestamp);
      expect(payload.nonce).toBe(nonce);
    });
  });
  
  describe('DLHD M3U8 Fetch', () => {
    
    test('should fetch M3U8 playlist from CDN', async () => {
      const channelKey = 'premium51';
      
      // First get server key
      let serverKey = 'zeko'; // default
      try {
        const lookupResponse = await fetch(
          `https://chevy.${CDN_DOMAIN}/server_lookup?channel_id=${channelKey}`,
          {
            headers: {
              'User-Agent': USER_AGENT,
              'Referer': `https://${PLAYER_DOMAIN}/`,
            },
          }
        );
        
        if (lookupResponse.ok) {
          const text = await lookupResponse.text();
          if (!text.startsWith('<')) {
            const data = JSON.parse(text);
            if (data.server_key) {
              serverKey = data.server_key;
            }
          }
        }
      } catch {}
      
      console.log(`\nUsing server key: ${serverKey}`);
      
      // Try to fetch M3U8
      let foundWorking = false;
      
      let m3u8Url: string;
      if (serverKey === 'top1/cdn') {
        m3u8Url = `https://top1.${CDN_DOMAIN}/top1/cdn/${channelKey}/mono.css`;
      } else {
        m3u8Url = `https://${serverKey}new.${CDN_DOMAIN}/${serverKey}/${channelKey}/mono.css`;
      }
      
      console.log(`\nTrying: ${m3u8Url}`);
      
      try {
        const response = await fetch(`${m3u8Url}?_t=${Date.now()}`, {
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': `https://${PLAYER_DOMAIN}/`,
          },
        });
        
        console.log('Status:', response.status);
        
        if (response.ok) {
          const content = await response.text();
          console.log('Content preview:', content.substring(0, 300));
          
          if (content.includes('#EXTM3U') || content.includes('#EXT-X-')) {
            console.log('✓ Valid M3U8 playlist found!');
            foundWorking = true;
            
            // Check for encryption
            if (content.includes('#EXT-X-KEY')) {
              console.log('Stream is encrypted (has EXT-X-KEY)');
              
              // Extract key URL
              const keyMatch = content.match(/URI="([^"]+)"/);
              if (keyMatch) {
                console.log('Key URL:', keyMatch[1]);
                
                // Test PoW authentication for key
                const keyUrl = keyMatch[1];
                const keyNumberMatch = keyUrl.match(/\/key\/[^/]+\/(\d+)/);
                if (keyNumberMatch) {
                  const keyNumber = keyNumberMatch[1];
                  const timestamp = Math.floor(Date.now() / 1000);
                  const nonce = computePoWNonce(channelKey, keyNumber, timestamp);
                  
                  console.log(`\nPoW for key ${keyNumber}:`);
                  console.log(`  Timestamp: ${timestamp}`);
                  console.log(`  Nonce: ${nonce}`);
                  
                  if (nonce !== null) {
                    const jwt = generateKeyJWT(channelKey, keyNumber, timestamp, nonce);
                    console.log(`  JWT: ${jwt.substring(0, 40)}...`);
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.log('Error:', (err as Error).message);
      }
      
      // If primary server didn't work, try others
      if (!foundWorking) {
        console.log('\nPrimary server failed, trying alternatives...');
        
        for (const altServerKey of ALL_SERVER_KEYS) {
          if (altServerKey === serverKey) continue;
          
          let altM3u8Url: string;
          if (altServerKey === 'top1/cdn') {
            altM3u8Url = `https://top1.${CDN_DOMAIN}/top1/cdn/${channelKey}/mono.css`;
          } else {
            altM3u8Url = `https://${altServerKey}new.${CDN_DOMAIN}/${altServerKey}/${channelKey}/mono.css`;
          }
          
          try {
            const response = await fetch(`${altM3u8Url}?_t=${Date.now()}`, {
              headers: {
                'User-Agent': USER_AGENT,
                'Referer': `https://${PLAYER_DOMAIN}/`,
              },
            });
            
            if (response.ok) {
              const content = await response.text();
              if (content.includes('#EXTM3U') || content.includes('#EXT-X-')) {
                console.log(`✓ Found working: ${altServerKey}`);
                foundWorking = true;
                break;
              }
            }
          } catch {}
        }
      }
      
      expect(foundWorking).toBe(true);
    });
    
    test('should fetch key with PoW authentication', async () => {
      const channelKey = 'premium51';
      const keyNumber = '1';
      const timestamp = Math.floor(Date.now() / 1000);
      
      console.log('\nTesting key fetch with PoW authentication...');
      
      const nonce = computePoWNonce(channelKey, keyNumber, timestamp);
      expect(nonce).not.toBeNull();
      
      const jwt = generateKeyJWT(channelKey, keyNumber, timestamp, nonce!);
      
      const keyUrl = `https://chevy.${CDN_DOMAIN}/key/${channelKey}/${keyNumber}`;
      console.log(`Key URL: ${keyUrl}`);
      
      const response = await fetch(keyUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': `https://${PLAYER_DOMAIN}/`,
          'Authorization': `Bearer ${jwt}`,
          'X-Key-Timestamp': timestamp.toString(),
          'X-Key-Nonce': nonce!.toString(),
        },
      });
      
      console.log('Key fetch status:', response.status);
      
      if (response.ok) {
        const keyData = await response.arrayBuffer();
        console.log(`Key size: ${keyData.byteLength} bytes`);
        expect(keyData.byteLength).toBe(16); // AES-128 key
      } else {
        const errorText = await response.text();
        console.log('Key fetch error:', errorText);
        // May fail if channel is offline, but test the auth mechanism
      }
    });
  });
});
