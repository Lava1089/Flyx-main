(function(){
'use strict';
const $ = s => document.querySelector(s);
const CHANNEL_KEY = 'premium44';
let playerInitialized = false; // Track if player was already initialized
let verificationStarted = false; // Guard against duplicate initial verifications
let lastVerificationTime = 0; // Track last verification timestamp
let backgroundVerifyInterval = null; // Store interval ID to prevent duplicates

// Detect in-app browsers (Instagram, Facebook, TikTok, Snapchat, etc.)
function isInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Snapchat|TikTok|Twitter|Line|WeChat|Messenger|WhatsApp/i.test(ua);
}

// Get current page URL for "Open in Browser" functionality
function getCurrentURL() {
  return window.location.href;
}

// reCAPTCHA v3 verification
function verifyRecaptcha(isBackground = false) {
  // Prevent duplicate initial verification runs (retry-loop race condition)
  if (!isBackground) {
    if (verificationStarted) return;
    verificationStarted = true;
  }

  const loader = $('#loader');
  
  if (isBackground) {
    console.log('[Background] Re-verifying reCAPTCHA to extend whitelist...');
  } else {
    console.log('Starting reCAPTCHA v3 verification...');
  }
  
  // Wait for reCAPTCHA library to load (skip for background - already loaded)
  if (!isBackground && typeof grecaptcha === 'undefined') {
    console.warn('Waiting for reCAPTCHA library to load...');
    // Reset guard so the retry can proceed
    verificationStarted = false;
    setTimeout(() => verifyRecaptcha(false), 100);
    return;
  }
  
  // For background checks, reload reCAPTCHA if it was unloaded
  if (isBackground && typeof grecaptcha === 'undefined') {
    console.log('[Background] Reloading reCAPTCHA for re-verification...');
    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj';
    script.onload = () => setTimeout(() => verifyRecaptcha(true), 500);
    document.head.appendChild(script);
    return;
  }
  
  // Timeout fallback: if grecaptcha.ready() never fires (e.g. blocked by ad-blocker)
  // iOS Safari can be slower on older devices - use 18s timeout
  const readyTimer = !isBackground ? setTimeout(() => {
    console.error('grecaptcha.ready() timed out — reCAPTCHA may be blocked');
    showError('Security check could not complete. Try disabling your ad-blocker, then reload.');
  }, 18000) : null;

  grecaptcha.ready(function() {
    if (readyTimer) clearTimeout(readyTimer);
    console.log('reCAPTCHA ready, executing challenge...');
    
    grecaptcha.execute('6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj', {action: 'player_access'})
      .then(function(token) {
        console.log('✓ Token obtained (length:', token.length, ')');
        
        if (!token || token.length < 20) {
          console.error('Invalid token received:', token);
          showError('reCAPTCHA failed to generate token. Please reload.');
          return;
        }
        
        // Use POST with JSON body to handle long tokens (2000+ chars)
        return fetch('https://go.ai-chatx.site/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            'recaptcha-token': token,
            'channel_id': CHANNEL_KEY
          })
        })
          .then(r => {
            console.log('Server response status:', r.status);
            return r.json();
          })
          .then(data => {
            console.log('Verification response:', data);
            if (data.success) {
              lastVerificationTime = Date.now(); // Update timestamp on successful verification
              if (isBackground) {
                console.log('[Background] ✓ Re-verification passed! Score:', data.score, '- Whitelist extended for 30 more minutes');
                
                // Unload reCAPTCHA after background verification
                try {
                  const badge = document.querySelector('.grecaptcha-badge');
                  if (badge) badge.remove();
                  
                  const scripts = document.querySelectorAll('script[src*="recaptcha"]');
                  scripts.forEach(s => s.remove());
                  
                  if (window.grecaptcha) delete window.grecaptcha;
                  
                  console.log('[Background] ✓ reCAPTCHA unloaded after re-verification');
                } catch(e) {
                  console.warn('[Background] Failed to unload reCAPTCHA:', e);
                }
              } else {
                // INITIAL verification: Remove modal and init player
                console.log('✓ Initial verification passed! Score:', data.score);
                
                // Remove verification modal
                const verifyBox = document.getElementById('verify-box');
                if (verifyBox) {
                  verifyBox.remove();
                  console.log('✓ Verification modal removed');
                } else {
                  console.warn('⚠ Modal already removed or not found');
                }
                
                // Unload reCAPTCHA and remove badge
                try {
                  const badge = document.querySelector('.grecaptcha-badge');
                  if (badge) badge.remove();
                  
                  // Remove reCAPTCHA script
                  const scripts = document.querySelectorAll('script[src*="recaptcha"]');
                  scripts.forEach(s => s.remove());
                  
                  // Clear grecaptcha global
                  if (window.grecaptcha) delete window.grecaptcha;
                  
                  console.log('✓ reCAPTCHA unloaded');
                } catch(e) {
                  console.warn('Failed to fully unload reCAPTCHA:', e);
                }
                
                // Show loader while player initializes
                if (loader) loader.style.display = 'block';
                
                // Initialize player
                if (!playerInitialized) {
                  playerInitialized = true;
                  console.log('✓ Starting player initialization...');
                  initPlayer();
                  
                  // Start background re-verification every 20 minutes (clear any existing interval first)
                  if (backgroundVerifyInterval) {
                    clearInterval(backgroundVerifyInterval);
                    console.log('✓ Cleared previous verification interval');
                  }
                  backgroundVerifyInterval = setInterval(() => verifyRecaptcha(true), 20 * 60 * 1000);
                  console.log('✓ Background re-verification scheduled every 20 minutes');
                  
                  // iOS workaround: Re-verify when tab becomes visible (timers suspended in background)
                  // But only if >15 minutes have passed since last verification
                  if (typeof document.hidden !== 'undefined') {
                    document.addEventListener('visibilitychange', function() {
                      if (!document.hidden && playerInitialized) {
                        const timeSinceLastVerify = Date.now() - lastVerificationTime;
                        const fifteenMinutes = 15 * 60 * 1000;
                        if (timeSinceLastVerify > fifteenMinutes) {
                          console.log('[iOS] Tab visible after ' + Math.round(timeSinceLastVerify/60000) + 'min - re-verifying');
                          verifyRecaptcha(true);
                        } else {
                          console.log('[iOS] Tab visible but verified ' + Math.round(timeSinceLastVerify/60000) + 'min ago - skipping');
                        }
                      }
                    });
                  }
                } else {
                  console.warn('⚠ Player already initialized, skipping');
                }
              }
            } else {
              console.error('Verification failed:', data);
              
              // Special handling for in-app browsers (Instagram, Facebook, TikTok, etc.)
              if (isInAppBrowser()) {
                const verifyBox = document.getElementById('verify-box');
                if (verifyBox) verifyBox.remove();
                const container = $('#player-container');
                const currentUrl = getCurrentURL();
                if (container) container.innerHTML = `
                  <div style="color:#fff;text-align:center;padding:30px;font-family:'Segoe UI',sans-serif;
                              width:100%;height:100%;display:flex;align-items:center;justify-content:center;
                              box-sizing:border-box;background:#111;">
                    <div style="max-width:480px;">
                      <div style="font-size:48px;margin-bottom:15px;">🔒</div>
                      <div style="font-size:22px;font-weight:bold;margin-bottom:10px;">In-App Browser Detected</div>
                      <div style="font-size:15px;color:#aaa;margin-bottom:22px;">This page cannot be opened in the built-in browser.</div>
                      <div style="background:#1e1e1e;border-radius:8px;padding:16px;text-align:left;margin-bottom:22px;">
                        <div style="font-size:13px;color:#ffd59e;font-weight:bold;margin-bottom:10px;">Why is this happening?</div>
                        <div style="font-size:13px;color:#ccc;margin-bottom:9px;">📱 &nbsp;In-app browsers (Instagram, Facebook, TikTok, Snapchat) have restricted security features</div>
                        <div style="font-size:13px;color:#ccc;margin-bottom:9px;">🛡️ &nbsp;Our verification system requires a full browser environment</div>
                      </div>
                      <div style="background:#1e1e1e;border-radius:8px;padding:16px;text-align:left;margin-bottom:22px;">
                        <div style="font-size:13px;color:#ffd59e;font-weight:bold;margin-bottom:10px;">How to fix:</div>
                        <div style="font-size:13px;color:#ccc;margin-bottom:9px;">1️⃣ &nbsp;Tap the <strong style="color:#fff;">⋯</strong> or <strong style="color:#fff;">•••</strong> menu button (usually top-right)</div>
                        <div style="font-size:13px;color:#ccc;margin-bottom:9px;">2️⃣ &nbsp;Select <strong style="color:#fff;">"Open in Browser"</strong> or <strong style="color:#fff;">"Open in Safari"</strong></div>
                        <div style="font-size:13px;color:#ccc;">3️⃣ &nbsp;The page will reload in your default browser and work normally</div>
                      </div>
                      <a href="${currentUrl}" target="_blank" style="display:inline-block;background:#E0CDA9;border:none;padding:12px 30px;
                              font-size:16px;cursor:pointer;border-radius:4px;color:#111;font-weight:bold;text-decoration:none;margin-bottom:10px;">
                        Open in Browser
                      </a>
                      <div style="font-size:12px;color:#888;margin-top:12px;">
                        Tap the button above, then select your browser (Safari, Chrome, etc.)
                      </div>
                    </div>
                  </div>
                `;
                return;
              }
              
              // Generic verification failure (low score, error codes, etc.)
              let errorMsg;
              if (data.error === 'low_score') {
                // Check if iOS Safari (not in-app browser)
                const isIOSSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|OPiOS|mercury/i.test(navigator.userAgent);
                if (isIOSSafari) {
                  errorMsg = `Security check failed (score: ${data.score}/${data.threshold}).\n\nTip for iOS: Try disabling "Prevent Cross-Site Tracking" in Settings > Safari > Privacy, then reload.`;
                } else {
                  errorMsg = `Security check failed (score: ${data.score}/${data.threshold}). Please reload.`;
                }
              } else if (data.error === 'channel_limit_exceeded') {
                errorMsg = data.message || 'Channel limit exceeded. You can watch max 4 channels at once, or 13 different channels per hour.';
              } else if (data.error === 'verification_failed') {
                errorMsg = data.message || 'Verification failed. Try disabling VPN/proxy and reload.';
              } else {
                errorMsg = `Verification failed: ${data.error || 'Unknown error'}`;
              }
              showError(errorMsg);
            }
          });
      })
      .catch(function(err) {
        console.error('❌ reCAPTCHA error:', err);
        const isNetworkError = err.name === 'TypeError' ||
          err.message.includes('NetworkError') ||
          err.message.includes('Failed to fetch') ||
          err.message.includes('Network request failed') ||
          err.message.includes('fetch');
        if (isNetworkError) {
          const verifyBox = document.getElementById('verify-box');
          if (verifyBox) verifyBox.remove();
          const container = $('#player-container');
          if (container) container.innerHTML = `
            <div style="color:#fff;text-align:center;padding:30px;font-family:'Segoe UI',sans-serif;
                        width:100%;height:100%;display:flex;align-items:center;justify-content:center;
                        box-sizing:border-box;background:#111;">
              <div style="max-width:460px;">
                <div style="font-size:48px;margin-bottom:15px;">📡</div>
                <div style="font-size:22px;font-weight:bold;margin-bottom:10px;">Security Check Failed</div>
                <div style="font-size:15px;color:#aaa;margin-bottom:22px;">Could not reach the verification server.</div>
                <div style="background:#1e1e1e;border-radius:8px;padding:16px;text-align:left;margin-bottom:22px;">
                  <div style="font-size:13px;color:#ffd59e;font-weight:bold;margin-bottom:10px;">Possible causes:</div>
                  <div style="font-size:13px;color:#ccc;margin-bottom:9px;">🛡️ &nbsp;An ad-blocker or browser extension may be blocking the request &mdash; try disabling it and reload</div>
                  <div style="font-size:13px;color:#ccc;margin-bottom:9px;">🌐 &nbsp;A VPN or proxy may be interfering with the connection</div>
                  <div style="font-size:13px;color:#ccc;margin-bottom:9px;">🔒 &nbsp;A strict firewall or DNS filter (e.g. Pi-hole) may be blocking the verification server</div>
                  <div style="font-size:13px;color:#ccc;">📶 &nbsp;Unstable network connection &mdash; check your internet and try again</div>
                </div>
                <button onclick="location.reload()" style="background:#E0CDA9;border:none;padding:12px 30px;
                        font-size:16px;cursor:pointer;border-radius:4px;color:#111;font-weight:bold;">
                  Retry
                </button>
              </div>
            </div>
          `;
        } else {
          showError('Verification error: ' + err.message);
        }
      });
  });
}

// Auto-start verification after page load (ensure reCAPTCHA script loads)
window.addEventListener('load', () => {
  // Warn if in-app browser detected
  if (isInAppBrowser()) {
    console.warn('⚠️  IN-APP BROWSER DETECTED - Verification may fail');
    console.warn('User-Agent:', navigator.userAgent);
    console.warn('Recommendation: Open in Safari/Chrome for best compatibility');
  }
  verifyRecaptcha(false);
});

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

function showStreamError(){
  try { clearInterval(playingCheckInterval); } catch(e) {}
  try { clearTimeout(forceShowTimeout); } catch(e) {}
  const container = $('#player-container');
  if (!container) return;
  container.innerHTML = `
    <div style="color:#fff;text-align:center;padding:30px;font-family:'Segoe UI',sans-serif;
                width:100%;height:100%;display:flex;align-items:center;justify-content:center;
                box-sizing:border-box;background:#111;">
      <div style="max-width:460px;">
        <div style="font-size:48px;margin-bottom:15px;">📡</div>
        <div style="font-size:22px;font-weight:bold;margin-bottom:10px;">Stream Unavailable</div>
        <div style="font-size:15px;color:#aaa;margin-bottom:22px;">The video stream could not be loaded.</div>
        <div style="background:#1e1e1e;border-radius:8px;padding:16px;text-align:left;margin-bottom:22px;">
          <div style="font-size:13px;color:#ffd59e;font-weight:bold;margin-bottom:10px;">Possible causes:</div>
          <div style="font-size:13px;color:#ccc;margin-bottom:9px;">📺 &nbsp;The channel may currently be offline or down</div>
          <div style="font-size:13px;color:#ccc;margin-bottom:9px;">🛡️ &nbsp;An ad-blocker or browser extension may be blocking the HLS stream &mdash; try disabling it and reload</div>
          <div style="font-size:13px;color:#ccc;margin-bottom:9px;">🔒 &nbsp;A strict firewall or DNS filter (e.g. Pi-hole) may be intercepting stream requests</div>
          <div style="font-size:13px;color:#ccc;">🌐 &nbsp;A VPN or proxy may be interfering with the connection</div>
        </div>
        <button onclick="location.reload()" style="background:#E0CDA9;border:none;padding:12px 30px;
                font-size:16px;cursor:pointer;border-radius:4px;color:#111;font-weight:bold;">
          Retry
        </button>
      </div>
    </div>
  `;
}

function showError(msg) {
  // Always dismiss the verification modal first — it sits at z-index:9999
  // and would cover the error if left in place
  const verifyBox = document.getElementById('verify-box');
  if (verifyBox) verifyBox.remove();
  const container = $('#player-container');
  if (container) {
    const safeMsg = String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    container.innerHTML = `<div style="color:#fff;text-align:center;padding:50px;font-size:18px;font-family:'Segoe UI',sans-serif;">${safeMsg}<br><br><button onclick="location.reload()" style="background:#E0CDA9;border:none;padding:10px 24px;font-size:15px;cursor:pointer;border-radius:4px;color:#111;font-weight:bold;">Retry</button></div>`;
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
        setTimeout(checkDeps, 100);
      }
    };
    checkDeps();
  });
}

function initPlayer() {
  const overallTimeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Overall initialization timeout (20s)')), 20000)
  );

  Promise.race([
  waitForDependencies().then(() => {
    console.log('✓ Step 1/4 complete: Dependencies loaded');
    updateLoader('Step 2/4: Fetching server configuration...');
    return fetchWithRetry('https://chevy.vovlacosa.sbs/server_lookup?channel_id='+encodeURIComponent(CHANNEL_KEY), 5, 500);
  }),
  overallTimeout
])
  .then(data => {
    console.log('✓ Step 2/4 complete: Server lookup successful:', data);
    updateLoader('Step 3/4: Configuring player...');
    const sk = data.server_key;

    const m3u8 = (sk === 'top1/cdn')
      // ? `https://top1./top1/cdn/${CHANNEL_KEY}/mono.csv`
      // : `https://${sk}new./${sk}/${CHANNEL_KEY}/mono.csv`;
      ? `https://go.ai-chatx.site/proxy/top1/cdn/${CHANNEL_KEY}/mono.css`
      : `https://go.ai-chatx.site/proxy/${sk}/${CHANNEL_KEY}/mono.css`;
// chevy.soyspace.cyou
      // ? `https://arbitrageai.cc/proxy/top1/cdn/${CHANNEL_KEY}/mono.css`
      // : `https://arbitrageai.cc/proxy/${sk}/${CHANNEL_KEY}/mono.css`;

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
      } catch(e) {
        // iOS: Video element might not exist immediately - ignore errors
      }
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
        
        // CRITICAL: Limit retries so manifest gets refreshed when worker URLs change
        fragLoadingMaxRetry: 1,  // Try 2 times then refetch manifest for new worker URL
        fragLoadingRetryDelay: 700,
        
        // Keep manifest/level retries high for worker rotation
        manifestLoadingMaxRetry: Infinity,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 64000000,
        levelLoadingMaxRetry: Infinity,
        levelLoadingRetryDelay: 1000,
        levelLoadingMaxRetryTimeout: 64000000,
        
        // Live stream optimizations
        liveSyncDurationCount: 4,      // Stay 4 segments back (was 3) - more cushion
        liveMaxLatencyDurationCount: 10,  // Max 10 segments behind before catch-up
        liveDurationInfinity: true,  // Proper live stream handling
        
        // Buffer size limits - prevent QuotaExceededError on SourceBuffer
        maxBufferLength: 60,           // More forward buffer headroom (was 30)
        maxMaxBufferLength: 120,       // Hard cap on forward buffer growth
        maxBufferSize: 30 * 1000 * 1000, // 30MB max buffer size
        backBufferLength: 10,          // Keep only 10s behind playhead
        
        // Buffer stall watchdog tuning - CDN is fast, avoid false stall alarms
        // Default lowBufferWatchdogPeriod is 0.5s - fires on tiny dips between segments
        lowBufferWatchdogPeriod: 2,    // Poll every 2s instead of 0.5s
        highBufferWatchdogPeriod: 5,   // Check high buffer every 5s (default 4)
        nudgeOffset: 0.3,              // Nudge 0.3s past stall point (default 0.1 - too small)
        nudgeMaxRetry: 6,              // More nudge attempts before giving up (default 3)
        maxStarvationDelay: 4,         // Max seconds to wait when buffer runs dry
      }
    });
    
    console.log('✓ Step 4/4 complete: Player created');

    // Add HLS.js error recovery for worker rotation
    let consecutiveFragErrors = 0;
    const MAX_FRAG_ERRORS_BEFORE_RELOAD = 3;

    // Track manifest/level load failures to detect a dead or blocked stream
    // NOTE: counted via direct HLS.js hook (not PLAYER_ERROR) because
    // manifestLoadingMaxRetry:Infinity makes all manifest errors non-fatal
    // and Clappr does not forward non-fatal errors through PLAYER_ERROR.
    let manifestErrorCount = 0;
    let manifestErrorWindowStart = 0;
    const MAX_MANIFEST_ERRORS = 6;       // show error screen after 6 failures
    const MANIFEST_ERROR_WINDOW = 30000; // within a 30-second window

    // Stream-start watchdog: if nothing plays within 15s, show error screen.
    // This is the most reliable detection path regardless of how HLS.js
    // propagates errors through Clappr.
    let streamStartTimer = setTimeout(() => {
      streamStartTimer = null;
      const video = document.querySelector('video');
      const started = video && (video.currentTime > 0 || video.buffered.length > 0);
      if (!started) {
        console.warn('Stream-start watchdog: no playback after 15s — showing error screen');
        showStreamError();
      }
    }, 15000);

    // Track buffer stalls to avoid over-reacting to brief live-segment gaps
    let bufferStallCount = 0;
    let lastStallNudge = 0;

    player.on(Clappr.Events.PLAYER_ERROR, function(error) {
      console.warn('Player error detected:', error);

      // --- Buffer stall: CDN is fast, stall is just a brief inter-segment gap ---
      if (error && error.type === 'mediaError' && error.details === 'bufferStalledError') {
        const now = Date.now();
        bufferStallCount++;
        console.warn(`Buffer stall #${bufferStallCount} (non-fatal, nudging video)`); 

        // Debounce nudges: don't nudge more than once per 1.5s
        if (now - lastStallNudge > 1500) {
          lastStallNudge = now;
          try {
            const video = document.querySelector('video');
            if (video && !video.paused) {
              // Nudge currentTime forward to escape the stall point
              video.currentTime += 0.3;
            }
          } catch(e) {}
        }

        // After 5 consecutive stalls, let HLS.js do a full media error recovery
        if (bufferStallCount >= 5) {
          console.warn('5 consecutive buffer stalls - triggering HLS media recovery');
          bufferStallCount = 0;
          try {
            const hlsjs = player.core.activePlayback._hls;
            if (hlsjs && hlsjs.recoverMediaError) {
              hlsjs.recoverMediaError();
            }
          } catch(e) {}
        }
        return; // Don't reset consecutiveFragErrors or do anything else
      }

      // Reset stall counter on any successful non-stall event (handled elsewhere)
      bufferStallCount = 0;

      // --- Fragment load errors: worker URL rotation ---
      if (error && error.type === 'networkError' && error.details === 'fragLoadError') {
        consecutiveFragErrors++;
        console.warn(`Fragment error ${consecutiveFragErrors}/${MAX_FRAG_ERRORS_BEFORE_RELOAD}`);
        
        if (consecutiveFragErrors >= MAX_FRAG_ERRORS_BEFORE_RELOAD) {
          console.log('Multiple fragment errors - forcing manifest reload for worker rotation');
          consecutiveFragErrors = 0;
          // NOTE: iOS Safari uses native HLS - this won't run on iOS
          
          // Force HLS.js to reload the manifest (gets new worker URLs)
          try {
            const hlsjs = player.core.activePlayback._hls;
            if (hlsjs && hlsjs.loadSource) {
              hlsjs.loadSource(m3u8);
              hlsjs.startLoad();
            }
          } catch(e) {
            console.error('Failed to reload manifest:', e);
          }
        }
      } else {
        // Reset counter on other errors
        consecutiveFragErrors = 0;
      }
    });
    
    // Preventive M3U8 refresh every 30 minutes (source is stable CDN - no aggressive rotation needed)
    // iOS Safari uses native HLS - this won't run on iOS (hlsjs will be undefined)
    // NOTE: loadSource() resets HLS.js buffer entirely - always follow with startLoad()
    setInterval(() => {
      try {
        const hlsjs = player.core.activePlayback._hls;
        if (hlsjs && hlsjs.loadSource) {
          console.log('Preventive manifest refresh (worker rotation sync)');
          hlsjs.loadSource(m3u8);
          hlsjs.startLoad();
        }
      } catch(e) {}
    }, 1800000);  // 30 minutes

    // Listen to Clappr events (but don't rely on them for iOS)
    player.on(Clappr.Events.PLAYER_READY, function() {
      console.log('✓ PLAYER_READY event fired');
      clearTimeout(forceShowTimeout);
      clearInterval(playingCheckInterval);
      showPlayerNow();

      // Hook HLS.js directly to catch manifest/level errors.
      // With manifestLoadingMaxRetry:Infinity these errors are never fatal,
      // so Clappr never forwards them via PLAYER_ERROR — we must listen here.
      // NOTE: iOS Safari uses native HLS - hlsjs will be undefined on iOS
      try {
        const hlsjs = player.core.activePlayback._hls;
        if (hlsjs) {
          hlsjs.on('hlsError', function(_, data) {
            if (!data) return;
            if (data.details === 'manifestLoadError' || data.details === 'levelLoadError') {
              const now = Date.now();
              if (now - manifestErrorWindowStart > MANIFEST_ERROR_WINDOW) {
                manifestErrorCount = 1;
                manifestErrorWindowStart = now;
              } else {
                manifestErrorCount++;
              }
              console.warn('HLS manifest/level error ' + manifestErrorCount + '/' + MAX_MANIFEST_ERRORS);
              if (manifestErrorCount >= MAX_MANIFEST_ERRORS) {
                showStreamError();
              }
            }
          });
        } else {
          console.log('[iOS] Native HLS playback (no HLS.js error recovery available)');
        }
      } catch(e) {}
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
      
      // Reset error counters on successful playback
      consecutiveFragErrors = 0;
      manifestErrorCount = 0;
      if (streamStartTimer) { clearTimeout(streamStartTimer); streamStartTimer = null; }
    });

  })
  .catch(err=>{
    // Allow re-initialization if somehow the page retries without a full reload
    playerInitialized = false;
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
        errorAdvice = `<div style="font-size:13px;color:#ffd59e;margin-bottom:15px;">🔴 Server Error - Try using a VPN or different network</div>`;
      } else if (statusCode === 'Unknown') {
        errorAdvice = `<div style="font-size:13px;color:#ffd59e;margin-bottom:15px;">🌐 Network Error - Check your connection</div>`;
      }
    } catch (e) { }

    const container = $('#player-container');
    if (container) {
      container.innerHTML = `
        <div style="color:#fff;text-align:center;padding:20px;font-family:'Segoe UI',sans-serif;max-height:100vh;overflow-y:auto;">
          <div style="font-size:24px;margin-bottom:10px">Player Error</div>
          <div style="font-size:16px;margin-bottom:15px">Failed at: <strong>${errorStep}</strong></div>
          <div style="font-size:18px;color:#ff6b6b;margin-bottom:20px;">HTTP ${statusCode}</div>
      ` + errorAdvice + debugInfo + `
          <button onclick="location.reload()" style="background:#E0CDA9;border:none;padding:12px 24px;font-size:16px;cursor:pointer;border-radius:4px;margin-top:10px;">Retry</button>
        </div>
      `;
    }
  });
}

document.cookie = "access=true";

// Console helper: Test background re-verification immediately
window.testRecaptchaReverify = () => {
  console.log('\n=== Manual Re-Verification Test ===');
  verifyRecaptcha(true);
};

window.WSUnmute = () => {
  const b = document.getElementById('UnMutePlayer');
  if (b) b.style.display = 'none';
  if (player) player.setVolume(100);
};

console.log('✓ Type testRecaptchaReverify() in console to manually test background verification');

})();