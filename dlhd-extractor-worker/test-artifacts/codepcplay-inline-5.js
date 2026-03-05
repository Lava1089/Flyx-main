// Get encoded domains list from PHP
var encodedDomains = "WyJ0aGVkYWRkeS50byIsInNwb3J0c3NsaXZlLnNob3AiLCJiaXp6LXN0cmVhbXMydS5zaG9wIiwidG9wc3RyZWFtei5zaG9wIiwiZGFkZHlsaXZlLm1wIiwid29ybGRzc3RyZWFtLnNob3AiLCJsaXZld29ybGQuc2hvcCIsIm1penR2LmxpdmUiLCI0a3N0cmVhbXMuc2hvcCIsInNvb3BlcnN0cmVhbXM0dS5zaG9wIiwiZ29vbXN0cmVhbS5zaG9wIiwiMXN0c3RyZWFtcy5zaG9wIiwiNGtuZXR3b3JrLnNob3AiLCJtaXp0di50b3AiLCJkYWRkeWxpdmUzLmNsaWNrIiwiZGFkZHlsaXZlMi50b3AiLCJnb21zdHJlYW1zLmluZm8iLCJkdWJ6bmV0d29ya3ouc2hvcCIsImRhZGR5bGl2ZS5kYWQiLCJ0bnQtc3BvcnRzLnNob3AiLCJmcmVlc3BvcnRzaHEuc2hvcCIsImtsdWJzcG9ydHMud2Vic2l0ZSIsInRyaXBwbGVzdHJlYW0uc2hvcCIsImhvbW9zcG9ydHQuc2hvcCIsImhkc3RyZW1pbmcuc2hvcCIsImZzc3BvcnR6aGQuc2hvcCIsImtsdWJzcG9ydHMuc3RvcmUiLCJmc3Nwb3J0c2hkZC5zaG9wIiwicmVkZGl0LXN0cmVhbWluZy5zaG9wIiwiZ29vbWhkLnNob3AiLCJkbGhkLmNsaWNrIiwidHZzcG9ydHNsaXZlLnNob3AiLCJlbmdzdHJlYW1zLnNob3AiLCJ6aWdnb2dyYXRpcy5zaG9wIiwidGhlZGFkZHkuZGFkIiwieWVhaHN0cmVhbXMuY29tIiwiZGFkZHlsaXZlMy5jb20iLCJidWZmenRyZWFtei5zaG9wIiwia2lja3N0cmVhbS5zaG9wIiwidGhlZGFkZHkudG9wIiwicm9qYWRpcmVjdC5zaG9wIiwic3BvcnRzc3RyZWFtcy5zaG9wIiwiZGFkZHlsaXZlc3RyZWFtLmNvbSIsInBvc2NpdGVjaHMuc2hvcCIsImRsaGQuZGFkIiwiZ29hbHN0cmVhbWVyLnNob3AiLCJmdWJvdHYuc2hvcCIsImxpdmluZ3Nwb3J0cy5zaG9wIiwic3RyZWFtbHlkZXYuc2hvcCIsImRhZGR5bGl2ZXN0cmVhbS5zaG9wIiwiYWxsc3BvcnRzcy5zaG9wIiwicmlwcGxlcGxheS5zaG9wIiwidmljdG9yeXN0cmVhbS5zaG9wIiwibGl2ZXNwb3J0aHViLnNob3AiLCJzcG9ydHlodWJzLnNob3AiLCJldmVyeXNwb3J0c3R2LnNob3AiLCJwcm9zdHJlYW1zLnNob3AiLCJkZXBvcnRlbGlicmVzLnNob3AiLCJ5ZWFocGFuZWwuc2hvcCIsInRoZXNwb3J0c3RyZWFtLnNob3AiLCJrbHVic3BvcnRzLnNob3AiLCJwYW5kYXN0cmVhbXMuc2hvcCIsIm92b2dvYWwuY2ZkIiwid29ybGRzcG9ydHo0dS5jZmQiLCJrbHVic3BvcnRzLnNicyIsImRhZGR5aGQuY29tIiwic3BvcnRtYXJnaW4uY2ZkIiwiZGFkZHlsaXZlNC5jbGljayIsImxpdmV2ZXJzZS5jZmQiLCJmcmVldHZzcG9yLmNmZCIsImFwa3NoaXAuY2ZkIiwic3RpY2t5LXNwb3J0cy5jZmQiLCJva2F5LXN0cmVhYS5jZmQiLCJkYWRkeWxpdmVzdHJlYW0uY2ZkIiwidmlwLXN0cmVhbWVzLnNob3AiLCJmYW92b3JpdGUtc3RyZWFtLnNob3AiLCJkbGhkLmxpbmsiLCJhcmVuYXByaW1ldHYuY29tIiwiZWxpdGVzdHJlYW1zLnNob3AiLCJzdHJlYW1jcmFmdC5zaG9wIiwidG9wc3RyZWFtc3ouc2hvcCIsImxpdmVzcG9ydHouc2hvcCJd";

// Decode Base64 JSON list into array
var allowedDomains = JSON.parse(atob(encodedDomains));

/**
 * Extract hostname safely
 */
function getHostname(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch (e) {
        return "";
    }
}

/**
 * Check if domain is exactly in the whitelist
 * Prevents "1miztv.shop" or "fake-miztv.shop" from passing
 */
function isAllowedDomain(hostname) {
    return allowedDomains.some(function(domain) {
        return hostname === domain.toLowerCase(); // strict exact match
    });
}

var currentReferer = document.referrer;
var refererHostname = getHostname(currentReferer);

console.log("Current Referrer:", currentReferer);
console.log("Referer Hostname:", refererHostname);

if (currentReferer === "" || !isAllowedDomain(refererHostname)) {
    console.log("Referrer not allowed. Redirecting to error page.");
    window.location = "/xx.html";
} else {
    console.log("Referrer is allowed");
}