// (function checkDebugger() {
//   const url = '/shockwave.php?rand=' + encodeURIComponent(Math.random());

//   fetch(url, {
//     cache: 'no-store',
//     method: 'GET',
//     headers: {
//       'Accept': 'text/plain'
//     }
//   })
//     .then(response => {
//       if (!response.ok) {
//         throw new Error(`HTTP error ${response.status}`);
//       }
//       return response.text();
//     })
//     .then(text => {
//       // Clean result to avoid hidden chars or spaces
//       const clean = text.replace(/[\r\n\t ]+/g, '').trim();

//       if (clean === 'yes') {
//         window.location.href = '/debugger2.php';
//       } else if (clean !== 'no') {
//         console.warn('Unexpected server response:', clean);
//       }
//     })
//     .catch(err => {
//       console.error('Debugger check failed:', err);
//     });
// })();

(function() {
    const redirectURL = "/debugger.php";
    const localStorageKey = "xxz1cxc";

    function setBan() {
        localStorage.setItem(localStorageKey, "13232322jfj");
    }
    function isBanned() {
        return localStorage.getItem(localStorageKey) === "1";
    }

    // Detect if user is on mobile device
    const isMobile = /android|iphone|ipad|ipod|windows phone|mobile/i.test(navigator.userAgent);

    // Only run debugger detection for non-mobile
    if (!isMobile) {
        if (isBanned()) {
            window.location.href = redirectURL;
            return;
        }

        const detectDevTools = () => {
            const threshold = 100;
            const check = () => {
                const start = performance.now();
                debugger; // Pauses if DevTools open
                return performance.now() - start > threshold;
            };
            if (check()) {
                setBan();
                window.location.href = redirectURL;
            }
        };

        setInterval(detectDevTools, 500);
        debugger; // Triggers pause if DevTools open
    }
})();