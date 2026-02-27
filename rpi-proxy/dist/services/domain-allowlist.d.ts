/**
 * Domain Allowlist for Proxy Security
 * Only proxy requests to known/trusted domains.
 */
/** CDN-Live specific domains */
export declare const CDN_LIVE_DOMAINS: string[];
/** Check if a URL's domain is in the proxy allowlist */
export declare function isAllowedProxyDomain(url: string): boolean;
/** Check if a URL belongs to a CDN-Live domain */
export declare function isCdnLiveDomain(urlStr: string): boolean;
//# sourceMappingURL=domain-allowlist.d.ts.map