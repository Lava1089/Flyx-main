#!/usr/bin/env node
/**
 * Deobfuscate EPlayerAuth from obfuscated.js
 * Run the obfuscated code in a controlled environment to extract the logic.
 */

// First, let's manually decode the string array
function _0x4140(){
  const _0x550414=['.m3u8','.ts','SESSION_TOKEN','floor','innerHTML','/redirect/','body','1293366xMYsKl','5724224SbjceC','X-Key-Nonce','authToken','timeZone','resolvedOptions','FINGERPRINT','timestamp','SHA256','15kYHgdy','191502TimhMx','setRequestHeader','1967912iGePFC','substring','HmacSHA256','7bLFEnn','X-Key-Timestamp','toString','channelSalt','X-Key-Path','UTC','language','height','Domain\x20validation\x20failed','397706GnsMTB','includes','validDomain','39534381uEHNRg','userAgent','country','endsWith','channelKey','X-Channel-Key','4424706zncYIX'];
  return _0x550414;
}

function _0x30f4(idx) {
  idx = idx - 0xbc;
  return _0x4140()[idx];
}

// Map all hex indices to their string values
const mapping = {};
for (let i = 0xbc; i <= 0xff; i++) {
  try {
    const val = _0x30f4(i);
    if (val) mapping['0x' + i.toString(16)] = val;
  } catch {}
}

console.log('=== String mapping ===');
for (const [k, v] of Object.entries(mapping)) {
  console.log(`  ${k} = "${v}"`);
}

console.log('\n=== Deobfuscated EPlayerAuth ===\n');

console.log(`
// EPlayerAuth - Deobfuscated from obfuscated.js (February 2026)

const _config = {
  authToken: '',
  channelKey: '',
  country: '',
  timestamp: 0,
  validDomain: '',
  channelSalt: ''
};

// Domain validation - checks hostname matches validDomain
function validateDomain() {
  const hostname = location.hostname;
  const validDomain = _config.validDomain;
  if (hostname !== validDomain && !hostname.endsWith('.' + validDomain)) {
    document.body.innerHTML = '';
    throw new Error('Domain validation failed');
  }
}

// Generate browser fingerprint
// CryptoJS.SHA256(userAgent + screenWidth + 'x' + screenHeight + timezone + language).substring(0, 16)
function generateFingerprint() {
  const ua = navigator.userAgent || '';
  const screen = window.screen.width + 'x' + window.screen.height;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const lang = navigator.language || 'en';
  const data = ua + screen + tz + lang;
  const hash = CryptoJS.SHA256(data).toString();
  return hash.substring(0, 16);
}

// HMAC-SHA256 helper
function hmacSha256(data, key) {
  return CryptoJS.HmacSHA256(data, key).toString();
}

// Compute PoW nonce using MD5
// hmacPrefix = HMAC-SHA256(channelKey, channelSalt)
// Then iterate: MD5(hmacPrefix + channelKey + keyNumber + timestamp + nonce)
// Find nonce where first 4 hex chars < 0x1000
function computePowNonce(channelKey, keyNumber, timestamp) {
  const hmacPrefix = hmacSha256(channelKey, _config.channelSalt);
  const threshold = 0x1000;  // 4096
  const maxIterations = 100000;
  for (let nonce = 0; nonce < maxIterations; nonce++) {
    const data = hmacPrefix + channelKey + keyNumber + timestamp + nonce;
    const hash = CryptoJS.MD5(data).toString();
    const first4 = parseInt(hash.substring(0, 4), 16);
    if (first4 < threshold) return nonce;
  }
  return maxIterations - 1;
}

// Compute key path
// HMAC-SHA256(resource + '|' + keyNumber + '|' + timestamp + '|' + fingerprint, channelSalt).substring(0, 16)
function computeKeyPath(resource, keyNumber, timestamp, fingerprint) {
  const data = resource + '|' + keyNumber + '|' + timestamp + '|' + fingerprint;
  return CryptoJS.HmacSHA256(data, _config.channelSalt).toString().substring(0, 16);
}

// XHR setup function - called by HLS.js for every request
function xhrSetup(xhr, url) {
  const keyMatch = url.match(/\\/key\\/([^\\/]+)\\/(\\d+)/);
  if (keyMatch) {
    // KEY REQUEST - add all auth headers
    const resource = keyMatch[1];     // e.g., "premium51"
    const keyNumber = keyMatch[2];    // e.g., "5901382"
    const timestamp = Math.floor(Date.now() / 1000);  // *** CURRENT TIME, NO OFFSET ***
    const nonce = computePowNonce(resource, keyNumber, timestamp);
    const fingerprint = generateFingerprint();
    const keyPath = computeKeyPath(resource, keyNumber, timestamp, fingerprint);
    
    xhr.setRequestHeader('Authorization', 'Bearer ' + _config.authToken);
    xhr.setRequestHeader('X-Key-Timestamp', timestamp.toString());
    xhr.setRequestHeader('X-Key-Nonce', nonce.toString());
    xhr.setRequestHeader('X-Key-Path', keyPath);
    xhr.setRequestHeader('X-Fingerprint', fingerprint);
  } else if (url.includes('.m3u8') || url.includes('.ts') || url.includes('/redirect/')) {
    // M3U8 / SEGMENT / REDIRECT - add basic auth
    xhr.setRequestHeader('Authorization', 'Bearer ' + _config.authToken);
    xhr.setRequestHeader('X-Channel-Key', _config.channelKey);
    xhr.setRequestHeader('X-User-Agent', navigator.userAgent);
  }
}

// Public API
window.EPlayerAuth = {
  init: function(config) {
    _config.authToken = config.authToken;
    _config.channelKey = config.channelKey;
    _config.country = config.country || '';
    _config.timestamp = config.timestamp || Math.floor(Date.now() / 1000);
    _config.validDomain = config.validDomain || '';
    _config.channelSalt = config.channelSalt;
    if (_config.validDomain) validateDomain();
    window.SESSION_TOKEN = _config.authToken;
    window.CHANNEL_KEY = _config.channelKey;
    window.FINGERPRINT = generateFingerprint();
    return true;
  },
  getXhrSetup: function() { return xhrSetup; },
  getFingerprint: function() { return generateFingerprint(); },
  getAuthToken: function() { return _config.authToken; },
  computePowNonce: function(ck, kn, ts) { return computePowNonce(ck, kn, ts); }
};
`);

console.log('\n=== KEY FINDINGS ===');
console.log('1. Timestamp: Math.floor(Date.now() / 1000) — NO OFFSET! Current time exactly.');
console.log('2. Fingerprint: SHA256(UA + screen + timezone + language).substring(0, 16)');
console.log('   - Uses REAL navigator.userAgent, screen, Intl timezone, language');
console.log('   - Our hardcoded fingerprint may not match what the server expects!');
console.log('3. PoW: HMAC-SHA256(channelKey, channelSalt) prefix, then MD5 with threshold 0x1000');
console.log('4. KeyPath: HMAC-SHA256(resource|keyNumber|timestamp|fingerprint, channelSalt).substring(0, 16)');
console.log('5. Headers sent for key requests:');
console.log('   - Authorization: Bearer <authToken>');
console.log('   - X-Key-Timestamp: <current_unix_timestamp>');
console.log('   - X-Key-Nonce: <pow_nonce>');
console.log('   - X-Key-Path: <hmac_path>');
console.log('   - X-Fingerprint: <sha256_fingerprint>');
console.log('6. NO Origin/Referer headers set by EPlayerAuth!');
console.log('   - The browser adds these automatically based on the page origin');
console.log('   - From codepcplay.fun: Origin=https://codepcplay.fun, Referer=https://codepcplay.fun/');
console.log('   - From hitsplay.fun: Origin=https://hitsplay.fun, Referer=https://hitsplay.fun/');
console.log('7. server_lookup endpoint: https://chevy.dvalna.ru/server_lookup?channel_id=<channelKey>');
