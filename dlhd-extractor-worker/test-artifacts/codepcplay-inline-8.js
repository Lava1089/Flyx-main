(function(){
  'use strict';

  const var_85fcdb8d1a      = "f473b1eadeda036e5fd6f361bbdbb904434ca4ac";
  const var_85099c2cb1 = "premium51";
  const var_d840cee167    = "US";
  const var_e8252ce128  = "1770415293";
  const var_2b0889c8df     = "1770501693";

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

  const validDomain = "codepcplay.fun";
  
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