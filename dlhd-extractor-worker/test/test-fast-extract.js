/**
 * Test the fast extraction logic
 * 
 * This tests the LOCAL JWT generation approach that DLHD uses.
 * The key insight is that DLHD generates JWTs client-side using HMAC-SHA256.
 * 
 * Reverse-engineered from hitsplay.fun player (Jan 2026):
 * - HMAC secret: d6398a30dd88f3defad36e0a10226679a045f47df9428e9cb4d98e9a6bd364b4
 * - URL pattern: https://${server}new.dvalna.ru/${server}/${channelKey}/mono.css
 */

const crypto = require('crypto');

// HMAC secret from hitsplay.fun player (base64 decoded from _eecb3d3b variable)
const HMAC_SECRET = 'd6398a30dd88f3defad36e0a10226679a045f47df9428e9cb4d98e9a6bd364b4';

// Use the "new" subdomain pattern like hitsplay.fun
const USE_NEW_SUBDOMAIN = true;

// Server mappings from discovery
const SERVER_CHANNELS = {
  'ddy6': [40,55,69,73,79,83,100,137,78,105,101,106,109,107,127,120,102,98,152,85,108,110,136,139,135,138,149,148,151,160,154,166,165,179,167,170,174,172,173,205,206,210,203,209,202,223,217,204,201,207,211,212,215,216,218,268,281,282,269,286,289,290,285,295,291,296,299,287,297,298,323,342,353,358,363,362,356,361,369,388,393,428,415,414,418,427,426,432,434,482,449,454,455,462,461,450,474,498,499,500,488,487,494,495,486,489,490,496,497,514,517,511,519,513,512,515,516,518,520,525,540,542,553,557,559,558,573,574,576,611,612,613,641,653,662,654,655,687,666,719,721,681,730,735,718,740,726,717,716,723,729,725,724,727,720,728,722,731,733,736,734,732,738,737,739,744,746,741,756,748,749,772,770,771,773,774,830,828,809,818,819,817,827,826,850],
  'zeko': [51,36,35,38,44,56,39,64,54,62,67,81,90,63,111,114,142,143,112,145,115,113,118,125,117,116,119,126,123,141,146,147,140,144,214,213,273,278,293,266,265,267,271,272,277,300,302,310,305,309,311,306,313,314,316,308,301,317,320,321,328,312,318,315,336,335,338,347,344,346,352,351,364,355,365,370,368,372,367,384,382,383,386,379,374,385,375,398,373,378,381,405,394,404,413,416,409,411,412,423,422,433,419,421,425,437,424,435,430,447,446,438,436,448,504,503,501,502,506,505,507,508,510,509,524,546,543,544,547,555,597,602,598,646,706,703,700,704,702,705,699,707,768,745,769,775,758,763,759,765,757,766,799,767,777,792,791,793,820,822,821,848],
  'wind': [43,70,42,49,46,41,58,50,59,47,66,45,61,60,57,71,87,75,53,68,122,72,84,88,89,80,76,82,121,124,131,129,134,150,162,161,155,164,169,163,175,176,177,168,171,178,235,230,231,260,232,236,233,238,239,234,237,259,276,274,275,324,327,325,326,331,329,330,333,332,337,340,354,360,377,366,376,387,397,390,406,396,399,408,407,410,420,429,431,478,484,443,451,457,456,459,458,445,468,466,463,469,453,471,467,473,475,479,465,464,472,470,481,485,476,480,477,483,541,521,522,570,550,554,578,569,581,580,579,599,600,672,678,671,673,674,683,680,675,676,677,715,679,688,685,686,682,684,755,776,754,750,753,787,788,824,825,849,847,844,846],
  'dokko1': [65,97,91,92,93,86,94,95,74,96,130,153,157,159,158,156,219,221,220,270,341,348,350,349,357,359,392,380,460,452,444,523,529,527,531,530,538,528,534,535,532,537,539,526,533,536,562,560,564,563,566,556,567,561,565,568,571,610,584,589,588,592,587,593,601,605,606,590,607,594,609,603,591,595,604,596,642,608,625,631,647,630,624,628,622,634,640,623,626,627,633,635,629,637,632,636,638,645,643,649,648,650,651,657,658,659,664,660,663,661,665,669,670,697,698,751,752,780,800,801,802,808,806,782,784,781,783,779,778,785,797,798,807,805,810,803,804,813,811,834,833,836,839,835,832,841,837,840,845,842],
  'nfs': [4,2,5,8,3,10,32,11,9,7,18,13,27,31,24,1,20,16,19,30,34,37,29,17,12,6,14,15,23,22,28,26,25,48,21,33,52,77,132,133,103,128,104,185,192,180,195,187,184,190,194,183,197,182,198,181,193,208,186,188,189,191,196,199,200,222,224,228,229,227,226,225,240,241,280,288,279,283,304,303,284,294,307,292,322,319,339,334,343,345,401,371,395,389,400,391,403,402,575,577,583,585,652,644,656,713,667,692,709,696,693,691,690,714,712,708,694,689,747,743,742,762,789,790,795,764,796,794,831,814,816,829,838],
  'wiki': [439,440,843]
};

// Build reverse lookup
const SERVER_MAP = {};
for (const [server, channels] of Object.entries(SERVER_CHANNELS)) {
  for (const ch of channels) {
    SERVER_MAP[ch] = server;
  }
}

/**
 * Base64URL encode (no padding, URL-safe)
 */
function base64UrlEncode(str) {
  const base64 = Buffer.from(str).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * HMAC-SHA256 signature
 */
function hmacSha256(key, data) {
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(data);
  const signature = hmac.digest();
  return base64UrlEncode(signature);
}

/**
 * Generate JWT locally
 */
function generateJWT(channelId) {
  const now = Math.floor(Date.now() / 1000);
  const channelKey = `premium${channelId}`;
  
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: channelKey,
    country: 'US',
    iat: now,
    exp: now + (5 * 60 * 60), // 5 hours
  };
  
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = hmacSha256(HMAC_SECRET, `${headerB64}.${payloadB64}`);
  
  const token = `${headerB64}.${payloadB64}.${signature}`;
  
  return { token, channelKey };
}

/**
 * Fast extraction
 */
function extractFast(channelId) {
  const startTime = Date.now();
  
  const chNum = parseInt(channelId, 10);
  if (isNaN(chNum) || chNum < 1 || chNum > 850) {
    console.log(`Invalid channel ID: ${channelId}`);
    return null;
  }

  // Get server from map
  const server = SERVER_MAP[chNum];
  if (!server) {
    console.log(`No server mapping for channel ${channelId}`);
    return null;
  }

  // Generate JWT locally
  const { token, channelKey } = generateJWT(channelId);

  // Construct M3U8 URL using hitsplay.fun pattern
  const subdomain = USE_NEW_SUBDOMAIN ? `${server}new` : server;
  const m3u8Url = `https://${subdomain}.dvalna.ru/${server}/${channelKey}/mono.css`;

  const elapsed = Date.now() - startTime;
  
  return {
    m3u8Url,
    token,
    server,
    channelKey,
    elapsed
  };
}

// Test with channel 51
console.log('=== Testing Fast Extraction ===\n');

const testChannels = [51, 1, 100, 500, 850];

for (const ch of testChannels) {
  console.log(`\n--- Channel ${ch} ---`);
  const result = extractFast(ch);
  if (result) {
    console.log(`Server: ${result.server}`);
    console.log(`Channel Key: ${result.channelKey}`);
    console.log(`M3U8 URL: ${result.m3u8Url}`);
    console.log(`JWT (first 50 chars): ${result.token.substring(0, 50)}...`);
    console.log(`Extraction time: ${result.elapsed}ms`);
  }
}

// Verify the M3U8 URL works
console.log('\n\n=== Verifying M3U8 URL ===');

async function verifyStream(channelId) {
  const result = extractFast(channelId);
  if (!result) return;
  
  console.log(`\nTesting channel ${channelId}...`);
  console.log(`URL: ${result.m3u8Url}`);
  
  try {
    const response = await fetch(result.m3u8Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': 'https://dlhd.link/',
        'Origin': 'https://dlhd.link',
        'Authorization': `Bearer ${result.token}`,
      }
    });
    
    console.log(`Status: ${response.status}`);
    
    if (response.ok) {
      const text = await response.text();
      console.log(`Response length: ${text.length}`);
      console.log(`First 200 chars: ${text.substring(0, 200)}`);
      
      if (text.includes('#EXTM3U')) {
        console.log('✅ Valid M3U8 playlist!');
      } else {
        console.log('❌ Not a valid M3U8');
      }
    } else {
      const text = await response.text();
      console.log(`Error: ${text.substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

// Test a few channels
(async () => {
  await verifyStream(51);
  await verifyStream(1);
})();
