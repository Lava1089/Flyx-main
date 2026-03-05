const https = require('https');

const keyUrl = 'https://chevy.dvalna.ru/key/premium577/5900830';
const rpiUrl = 'https://rpi-proxy.vynx.cc/dlhd-key?url=' + encodeURIComponent(keyUrl);

console.log('Testing RPI proxy key fetch...');
console.log('URL:', rpiUrl);

https.get(rpiUrl, {
  headers: {
    'X-API-Key': '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560',
  },
}, (res) => {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    const data = Buffer.concat(chunks);
    console.log('Status:', res.statusCode);
    console.log('Size:', data.length);
    if (data.length === 16) {
      const hex = data.toString('hex');
      console.log('Hex:', hex);
      if (hex.startsWith('45c6497') || hex.startsWith('455806f8')) {
        console.log('⚠️ FAKE KEY!');
      } else {
        console.log('✅ REAL KEY!');
      }
    } else {
      console.log('Response:', data.toString('utf8'));
    }
  });
}).on('error', (e) => {
  console.log('Error:', e.message);
});
