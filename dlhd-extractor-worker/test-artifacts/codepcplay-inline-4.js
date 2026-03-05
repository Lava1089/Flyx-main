(function fakeHLSNoise() {
  const requestsPerSecond = 1; 
  const intervalMs = 1000 / requestsPerSecond;
  const domainLength = 10; 
  const domainsCount = 5; 

  // ---- FIXED TOKEN FOR M3U8 PLAYLISTS ----
  const fixedPlaylistToken = Math.random().toString(36).slice(2);  

  function randomDomain(length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `https://s3.dualstack.us-east-2.amazonaws.com/cam.edu/`;
  }

  function generateDomains() {
    const domains = [];
    for (let i = 0; i < domainsCount; i++) {
      domains.push(randomDomain(domainLength));
    }
    return domains;
  }

  const domains = generateDomains();

  function randomHLSPath() {
    const qualities = ['720p', '1080p', '480p', '4k'];
    const quality = qualities[Math.floor(Math.random() * qualities.length)];
    return `/hls/${quality}/`;
  }

  function randomSegmentName() {
    const segmentId = Math.floor(Math.random() * 5000) + 1;
    return `segment_${segmentId}.ts`;
  }

  function randomHLSRequestURL() {
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const path = randomHLSPath();

    // 80% segment, 20% playlist
    if (Math.random() < 0.8) {
      // segments still use fresh tokens
      return `${domain}${path}${randomSegmentName()}?token=${
        Math.random().toString(36).slice(2)
      }&ts=${Date.now()}`;
    } else {
      // ---- PLAYLIST USES FIXED TOKEN ----
      return `${domain}${path}playlist.m3u8?token=${fixedPlaylistToken}`;
    }
  }

  async function sendFakeRequest() {
    const url = randomHLSRequestURL();
    try {
      await fetch(url, { mode: 'no-cors' });
      console.log(`Fake HLS request → ${url}`);
    } catch (e) {
      console.warn(`Failed HLS request: ${url}`);
    }
  }

  setInterval(sendFakeRequest, intervalMs);
})();