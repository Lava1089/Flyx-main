(function(){
'use strict';
const $ = s => document.querySelector(s);

// Check if EPlayerAuth loaded
if (typeof EPlayerAuth === 'undefined') {
  console.error('CRITICAL: EPlayerAuth not loaded! /obfuscated.js failed to load or execute.');
  document.body.innerHTML = '<div style="color:#fff;text-align:center;padding:50px;font-size:24px;background:#000;">ERROR: Authentication module failed to load<br><br>Please check /obfuscated.js exists and is valid JavaScript</div>';
  throw new Error('EPlayerAuth not defined');
}

// Initialize authentication system
EPlayerAuth.init({
    authToken: 'premium51|US|1770415293|1770501693|00c263678d8cfc878c61fbad04ee6729383ff9b23f252a15d07d52a6403b5221',
    channelKey: 'premium51',
    country: 'US',
    timestamp: 1770415293,
    validDomain: 'codepcplay.fun',
    channelSalt: 'b0fccea0f15b63b00d758a1dd8c57a512e9620181363b60fdaf571023f907bd0'
});

// Set cookie for backward compatibility
document.cookie = "eplayer_session=" + EPlayerAuth.getAuthToken() + "; domain=.dvalna.ru; path=/; SameSite=None; Secure";

function showPlayerContainer(){
  const o = $('#player-container');
  if (!$('#clappr-container')){
    const d = document.createElement('div');
    d.id = 'clappr-container';
    d.style.cssText = 'width:100%;height:100%;position:relative;display:none;';
    o.appendChild(d);
  }
}

function hideLoaderShowPlayer(){
  const l = $('#loader');
  const c = $('#clappr-container');
  if (l) l.style.display = 'none';
  if (c) c.style.display = 'block';
}

function createPlayerContainer(){
  const o = $('#player-container');
  if (!$('#clappr-container')){
    const d = document.createElement('div');
    d.id = 'clappr-container';
    d.style.cssText = 'width:100%;height:100%;position:relative';
    o.appendChild(d);
  }
}

function fetchWithRetry(url, retries, delay, init){
  return new Promise((resolve, reject)=>{
    const timeoutMs = 8000; // 8 second timeout per attempt
    const attempt=()=>{
      const fetchOpts = {...init, keepalive: true};
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      fetch(url, {...fetchOpts, signal: controller.signal})
        .then(r => { 
          clearTimeout(timeoutId);
          if (!r.ok) throw new Error('HTTP '+r.status); 
          return r.json(); 
        })
        .then(data => {
          clearTimeout(timeoutId);
          resolve(data);
        })
        .catch(err => {
          clearTimeout(timeoutId);
          const errMsg = err.name === 'AbortError' ? 'Timeout' : (err.message || 'Network error');
          console.warn(`Fetch attempt failed: ${errMsg}, retries left: ${retries}`);
          if (retries--) {
            setTimeout(attempt, delay);
          } else {
            reject(new Error(errMsg));
          }
        });
    };
    attempt();
  });
}

let player;
let reloadTimer = null;

function safeReloadPlayer(){
  if (reloadTimer) return;
  console.warn("Playback stalled or errored. Reloading source in 3 seconds...");
  reloadTimer = setTimeout(()=>{
    try{
      if (player){
        player.stop();
        player.load(player.options.source && String(player.options.source).trim());
        player.play();
        player.unmute();
        player.setVolume(100);
      }
    }catch(_){}
    reloadTimer = null;
  }, 3000);
}

function updateLoader(text) {
  const loaderText = $('#loader .text');
  if (loaderText) {
    loaderText.textContent = text;
    loaderText.style.fontSize = '18px';
    loaderText.style.fontWeight = 'bold';
  }
  console.log('[LOADER STEP]', text);
  console.warn('Current step:', text); // Make it more visible in console
}

function waitForDependencies() {
  updateLoader('Step 1/4: Loading dependencies (Clappr, HLS)...');
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 100; // 10 seconds timeout
    const checkDeps = () => {
      attempts++;
      if (typeof Clappr !== 'undefined' && typeof HlsjsPlayback !== 'undefined') {
        console.log('✓ Dependencies loaded successfully');
        resolve();
      } else if (attempts >= maxAttempts) {
        const missing = [];
        if (typeof Clappr === 'undefined') missing.push('Clappr');
        if (typeof HlsjsPlayback === 'undefined') missing.push('HlsjsPlayback');
        reject(new Error('Dependency timeout: ' + missing.join(', ') + ' failed to load'));
      } else {
        setTimeout(checkDeps, 50);
      }
    };
    checkDeps();
  });
}

// Add overall timeout wrapper to prevent infinite loading
const overallTimeout = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('Overall initialization timeout (20s)')), 20000)
);

Promise.race([
  waitForDependencies().then(() => {
    console.log('✓ Step 1/4 complete: Dependencies loaded');
    updateLoader('Step 2/4: Fetching server configuration...');
    return fetchWithRetry('https://chevy.dvalna.ru/server_lookup?channel_id='+encodeURIComponent(CHANNEL_KEY), 5, 500);
  }),
  overallTimeout
])
  .then(data => {
    console.log('✓ Step 2/4 complete: Server lookup successful:', data);
    updateLoader('Step 3/4: Configuring player...');
    const sk = data.server_key;

    const m3u8 = (sk === 'top1/cdn')
      ? `https://top1.dvalna.ru/top1/cdn/${CHANNEL_KEY}/mono.css`
      : `https://${sk}new.dvalna.ru/${sk}/${CHANNEL_KEY}/mono.css`;

    console.log('✓ M3U8 URL:', m3u8);
    updateLoader('Step 4/4: Starting player...');
    showPlayerContainer(); // Create container but keep loader visible

    // Hide loader and show player when ready
    let playerShown = false;
    const showPlayerNow = () => {
      if (playerShown) return;
      playerShown = true;
      hideLoaderShowPlayer();
      console.log('✓ Player now visible');
    };

    // iOS: Force show after 2s (segments loading = player working)
    const forceShowTimeout = setTimeout(() => {
      console.warn('⚠ Force showing player after 2s timeout (iOS/mobile optimization)');
      showPlayerNow();
    }, 2000);

    // Balanced playback detection (every 250ms - gentle on CPU)
    const playingCheckInterval = setInterval(() => {
      try {
        const video = document.querySelector('video');
        if (video) {
          // Show if: video element exists + (any readyState OR any buffered data OR playing)
          const hasData = video.readyState >= 1 || video.buffered.length > 0;
          const isPlaying = video.currentTime > 0 || !video.paused;
          
          if (hasData || isPlaying) {
            console.log('✓ Video detected ready (readyState:', video.readyState, 'buffered:', video.buffered.length, 'playing:', isPlaying, ')');
            clearInterval(playingCheckInterval);
            clearTimeout(forceShowTimeout);
            showPlayerNow();
          }
        }
      } catch(e) {}
    }, 250);


    player = new Clappr.Player({
      source: m3u8,
      mimeType: "application/vnd.apple.mpegurl",

      parentId: '#clappr-container',
      autoPlay: true,
      mute: true,
      height: '100%',
      width:  '100%',
      disableErrorScreen: true,
      plugins: [HlsjsPlayback],

      mediacontrol:{
        seekbar:"#E0CDA9",
        buttons:"#E0CDA9"
      },

      hlsjsConfig:{
        enableWorker: true,
        xhrSetup: EPlayerAuth.getXhrSetup(),
        fragLoadingMaxRetry: Infinity,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 64000000,
        manifestLoadingMaxRetry: Infinity,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 64000000,
        levelLoadingMaxRetry: Infinity,
        levelLoadingRetryDelay: 1000,
        levelLoadingMaxRetryTimeout: 64000000,
        backBufferLength: 60
      },

      playback:{
        hlsjsConfig:{
          xhrSetup: EPlayerAuth.getXhrSetup()
        }
      }
    });

    console.log('✓ Step 4/4 complete: Player created');

    // Listen to Clappr events (but don't rely on them for iOS)
    player.on(Clappr.Events.PLAYER_READY, function() {
      console.log('✓ PLAYER_READY event fired');
      clearTimeout(forceShowTimeout);
      clearInterval(playingCheckInterval);
      showPlayerNow();
    });

    // Also try PLAY event (more reliable on mobile)
    player.on(Clappr.Events.PLAYER_PLAY, function() {
      console.log('✓ PLAYER_PLAY event fired');
      clearTimeout(forceShowTimeout);
      clearInterval(playingCheckInterval);
      showPlayerNow();
    });

    // And PLAYING event (HLS.js specific)
    player.on(Clappr.Events.PLAYER_PLAYING, function() {
      console.log('✓ PLAYER_PLAYING event fired');
      clearTimeout(forceShowTimeout);
      clearInterval(playingCheckInterval);
      showPlayerNow();
    });

  })
  .catch(err=>{
    console.error('❌ PLAYER INITIALIZATION FAILED:', err);
    console.error('Full error details:', err.stack || err);
    
    // Extract detailed error information
    const httpStatus = err.message.match(/HTTP (\d+)/);
    const statusCode = httpStatus ? httpStatus[1] : 'Unknown';
    
    // Determine which step failed
    let errorStep = 'Unknown';
    if (err.message.includes('Dependency timeout')) {
      errorStep = 'Step 1/4: Loading Dependencies';
    } else if (err.message.includes('Auth')) {
      errorStep = 'Step 2/4: Authentication';
    } else if (err.message.includes('Server lookup')) {
      errorStep = 'Step 2/4: Server Lookup';
    } else if (err.message.includes('timeout')) {
      errorStep = 'Overall Timeout (45s exceeded)';
    } else {
      errorStep = 'Step 3-4/4: Player Initialization';
    }
    
    // Build detailed debug info
    let debugInfo = `<div style="font-size:11px;color:#888;margin-top:15px;text-align:left;max-width:500px;margin-left:auto;margin-right:auto;font-family:monospace;">`;
    debugInfo += `<div style="margin-bottom:5px;"><strong>Status:</strong> ${statusCode}</div>`;
    debugInfo += `<div style="margin-bottom:5px;"><strong>Error:</strong> ${err.message}</div>`;
    debugInfo += `<div style="margin-bottom:5px;"><strong>Channel:</strong> ${CHANNEL_KEY || 'N/A'}</div>`;
    debugInfo += `<div style="margin-bottom:5px;"><strong>Token:</strong> ${window.SESSION_TOKEN ? window.SESSION_TOKEN.substring(0, 30) + '...' : 'Missing'}</div>`;
    debugInfo += `<div style="margin-bottom:5px;"><strong>UA:</strong> ${navigator.userAgent.substring(0, 60)}...</div>`;
    debugInfo += `<div style="margin-bottom:5px;"><strong>Time:</strong> ${new Date().toISOString()}</div>`;
    debugInfo += `</div>`;
    
    // Specific advice based on error type
    let errorAdvice = '';
    try {
      if (statusCode === '400') {
        errorAdvice = `<div style="font-size:13px;color:#ffd59e;margin-bottom:15px;">⚠️ Bad Request - This usually means:<br>• Invalid or expired authentication token<br>• Missing required headers<br>• Malformed request data</div>`;
      } else if (statusCode === '403') {
        errorAdvice = `<div style="font-size:13px;color:#ffd59e;margin-bottom:15px;">🔒 Access Denied - Possible causes:<br>• Token doesn't match this channel<br>• Country/IP restrictions<br>• Rate limit exceeded</div>`;
      } else if (statusCode === '500' || statusCode === '502' || statusCode === '503') {
        errorAdvice = `<div style="font-size:13px;color:#ffd59e;margin-bottom:15px;">${t('vpn_advice')}</div>`;
      } else if (statusCode === 'Unknown') {
        errorAdvice = `<div style="font-size:13px;color:#ffd59e;margin-bottom:15px;">🌐 Network Error - Check your connection</div>`;
      }
    } catch (e) { }

    const container = $('#player-container');
    if (container) {
      container.innerHTML = `
        <div style="color:#fff;text-align:center;padding:20px;font-family:'Segoe UI',sans-serif;max-height:100vh;overflow-y:auto;">
          <div style="font-size:24px;margin-bottom:10px">${t('error_title')}</div>
          <div style="font-size:16px;margin-bottom:15px">${t('failed_at')} <strong>${errorStep}</strong></div>
          <div style="font-size:18px;color:#ff6b6b;margin-bottom:20px;">HTTP ${statusCode}</div>
      ` + errorAdvice + debugInfo + `
          <button onclick="location.reload()" style="background:#E0CDA9;border:none;padding:12px 24px;font-size:16px;cursor:pointer;border-radius:4px;margin-top:10px;">${t('retry')}</button>
        </div>
      `;
    }
  });

document.cookie = "access=true";

window.WSUnmute = () => {
  const b = document.getElementById('UnMutePlayer');
  if (b) b.style.display = 'none';
  if (player) player.setVolume(100);
};

})();