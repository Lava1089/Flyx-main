#!/usr/bin/env node
const crypto = require('crypto');

const hex = '45c6497365ca4c64c83460adca4e65ee';
const buf = Buffer.from(hex, 'hex');

console.log('=== Decoding fake key: ' + hex + ' ===\n');
console.log('ASCII:', buf.toString('ascii'));
console.log('UTF8:', buf.toString('utf8'));
console.log('Latin1:', buf.toString('latin1'));
console.log('Base64:', buf.toString('base64'));
console.log('Bytes:', Array.from(buf).join(', '));
console.log('');

// Check if it's an MD5 of common strings
const tests = [
  'error', 'blocked', 'invalid', 'unauthorized', 'denied', 'fake', 'bot',
  'cloudflare', 'forbidden', 'reject', 'null', 'none', 'empty', '0',
  'default', 'test', 'dummy', 'placeholder', 'decoy', 'honeypot',
  'rate_limit', 'rate-limit', 'ratelimit', 'throttle', 'abuse',
  'proxy', 'vpn', 'datacenter', 'server', 'node', 'nodejs',
  'curl', 'wget', 'python', 'scraper', 'spider',
];

console.log('Checking if hex matches MD5 of common strings...');
for (const t of tests) {
  const md5 = crypto.createHash('md5').update(t).digest('hex');
  if (md5 === hex) console.log(`  MATCH: MD5("${t}") = ${hex}`);
}

// Check SHA256 truncated
console.log('\nChecking SHA256 truncated to 32 chars...');
for (const t of tests) {
  const sha = crypto.createHash('sha256').update(t).digest('hex').substring(0, 32);
  if (sha === hex) console.log(`  MATCH: SHA256("${t}")[0:32] = ${hex}`);
}

// The key is ALWAYS the same regardless of channel, timestamp, auth.
// This strongly suggests it's a static "poison pill" key returned when
// the server detects something wrong with the request.
console.log('\n=== Analysis ===');
console.log('This is a STATIC 16-byte value returned for ALL channels.');
console.log('It does not change with timestamp, auth token, or channel.');
console.log('It is returned with HTTP 200 (not 403/401).');
console.log('This is a deliberate "poison pill" / decoy key.');
console.log('');
console.log('The key server returns this when it detects the request');
console.log('is not from a real browser. Since direct fetch() from');
console.log('THIS machine works but the same fetch() through the RPI');
console.log('proxy does not, the difference must be in the network path.');
console.log('');
console.log('Possible causes:');
console.log('1. The RPI Node.js has a different TLS fingerprint (different OpenSSL)');
console.log('2. The RPI connects via IPv6 while this machine uses IPv4');
console.log('3. The RPI has different DNS resolution (different CF edge)');
console.log('4. Cloudflare Tunnel adds headers that leak to the upstream');
