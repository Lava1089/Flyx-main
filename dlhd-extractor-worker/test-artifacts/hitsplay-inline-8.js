(function(){
  'use strict';

  const var_3fb23df358      = "f473b1eadeda036e5fd6f361bbdbb904434ca4ac";
  const var_f109443b2f = "premium51";
  const var_6c22758cb1    = "US";
  const var_c9fa7ef56e  = "1770415294";
  const var_41621c8fe8     = "1770501694";

  let isSandboxed = false;

  function detectSandbox() {
    try {
        if (window.self !== window.top) {
        let canAccessParent = false;
        try {
          void window.top.location.href;
          canAccessParent = true;
        } catch (e) {}

        try {
          if (!canAccessParent && (!document.domain || document.domain === '')) {
            isSandboxed = true;
            console.log('S1: Detected sandbox restrictions');
            return;
          }
        } catch (e) {
          isSandboxed = true;
          console.log('S2: Sandbox restriction error', e.message);
          return;
        }
      }
      
      try {
        const testBlob = new Blob(['test'], { type: 'text/plain' });
        const testUrl = URL.createObjectURL(testBlob);
        URL.revokeObjectURL(testUrl);
      } catch (e) {
        isSandboxed = true;
        console.log('S3: Blob URL creation blocked');
      }
    } catch (err) {
      console.log('S4: Sandbox detection error (assuming not sandboxed)', err.message);
    }
  }

  function fetchWithRetry(url, retries, delay, init) {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        fetch(url, init)
          .then(r => { if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
          .then(resolve)
          .catch(err => (retries--) ? setTimeout(attempt, delay) : reject(err));
      };
      attempt();
    });
  }

  const validDomain = "hitsplay.fun";
  
  function validateDomain() {
    const host = location.hostname;
    if (!validDomain || host !== validDomain && !host.endsWith('.' + validDomain)) {
      document.body.innerHTML = '';
      throw new Error('Unauthorized domain');
    }
  }
  
  // Run domain check immediately and on load
  validateDomain();
  
  window.addEventListener('load', () => {
    validateDomain();
    detectSandbox();
    console.log('Player initialized, sandbox check complete');
  });

})();