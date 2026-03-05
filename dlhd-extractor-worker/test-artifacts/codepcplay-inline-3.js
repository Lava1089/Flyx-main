(function() {
    const banner = document.getElementById("bet-banner");
    const closeBtn = document.getElementById("bet-banner-close");

    function setCookie(n, v, d) {
        let t = new Date();
        t.setTime(t.getTime() + (d*24*60*60*1000));
        document.cookie = n + "=" + v + ";expires=" + t.toUTCString() + ";path=/";
    }

    function getCookie(n) {
        let name = n + "=";
        let parts = document.cookie.split(';');
        for (let c of parts) {
            c = c.trim();
            if (c.startsWith(name)) return c.substring(name.length);
        }
        return "";
    }

    if (!getCookie("bet_banner_seen")) {
        setTimeout(() => { banner.style.display = "block"; }, 700);

        setTimeout(() => {
            banner.classList.add("fadeout");
            setTimeout(() => { banner.style.display = "none"; }, 900);
        }, 15000);

        setCookie("bet_banner_seen", "1", 1);
    }

    closeBtn.addEventListener("click", () => {
        banner.classList.add("fadeout");
        setTimeout(() => { banner.style.display = "none"; }, 900);
    });
})();