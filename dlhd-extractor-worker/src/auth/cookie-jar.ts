/**
 * Cookie Jar - Session Cookie Management
 * 
 * Manages cookies for maintaining session state across requests.
 * Parses Set-Cookie headers and includes cookies in subsequent requests.
 * 
 * Requirements: 3.2
 * - WHEN authentication requires cookies, THE Auth_Handler component SHALL manage cookie state across requests
 */

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CookieJarOptions {
  /** Whether to enforce domain matching (default: false for same-origin) */
  enforceDomain?: boolean;
  /** Default domain for cookies without explicit domain */
  defaultDomain?: string;
}

/**
 * Cookie Jar for managing session cookies
 * 
 * Property 3: Auth Context Completeness
 * - All required cookies SHALL be preserved across subsequent requests
 */
export class CookieJar {
  private cookies: Map<string, Cookie> = new Map();

  constructor(_options: CookieJarOptions = {}) {
    // Options reserved for future use (domain enforcement, etc.)
  }

  /**
   * Parse a Set-Cookie header and store the cookie
   */
  parseCookie(setCookieHeader: string): Cookie | null {
    if (!setCookieHeader || typeof setCookieHeader !== 'string') {
      return null;
    }

    const parts = setCookieHeader.split(';');
    if (parts.length === 0) {
      return null;
    }

    // First part is name=value (don't trim the value, only the name)
    const nameValue = parts[0];
    const attributes = parts.slice(1).map((p) => p.trim());
    const eqIndex = nameValue.indexOf('=');
    if (eqIndex === -1) {
      return null;
    }

    const name = nameValue.substring(0, eqIndex).trim();
    // Preserve the exact value - only trim surrounding quotes if present
    let value = nameValue.substring(eqIndex + 1);
    // Remove surrounding quotes if present (RFC 6265)
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    if (!name) {
      return null;
    }

    const cookie: Cookie = { name, value };

    // Parse attributes
    for (const attr of attributes) {
      const attrLower = attr.toLowerCase();
      const attrEqIndex = attr.indexOf('=');

      if (attrLower === 'secure') {
        cookie.secure = true;
      } else if (attrLower === 'httponly') {
        cookie.httpOnly = true;
      } else if (attrEqIndex !== -1) {
        const attrName = attr.substring(0, attrEqIndex).trim().toLowerCase();
        const attrValue = attr.substring(attrEqIndex + 1).trim();

        switch (attrName) {
          case 'domain':
            cookie.domain = attrValue.startsWith('.') ? attrValue.substring(1) : attrValue;
            break;
          case 'path':
            cookie.path = attrValue;
            break;
          case 'expires':
            cookie.expires = new Date(attrValue);
            break;
          case 'max-age':
            cookie.maxAge = parseInt(attrValue, 10);
            break;
          case 'samesite':
            const sameSiteValue = attrValue.toLowerCase();
            if (sameSiteValue === 'strict') cookie.sameSite = 'Strict';
            else if (sameSiteValue === 'lax') cookie.sameSite = 'Lax';
            else if (sameSiteValue === 'none') cookie.sameSite = 'None';
            break;
        }
      }
    }

    return cookie;
  }

  /**
   * Add a cookie to the jar
   */
  setCookie(cookie: Cookie): void {
    if (!cookie || !cookie.name) {
      return;
    }
    
    // Check if cookie is expired
    if (this.isCookieExpired(cookie)) {
      this.cookies.delete(cookie.name);
      return;
    }

    this.cookies.set(cookie.name, cookie);
  }

  /**
   * Parse and add a cookie from Set-Cookie header
   */
  setFromHeader(setCookieHeader: string): Cookie | null {
    const cookie = this.parseCookie(setCookieHeader);
    if (cookie) {
      this.setCookie(cookie);
    }
    return cookie;
  }

  /**
   * Parse multiple Set-Cookie headers from a Response
   */
  setFromResponse(response: Response): void {
    // Try getAll first (Cloudflare Workers support this)
    const setCookieHeaders = response.headers.getAll?.('Set-Cookie') || [];
    
    // Fallback for environments that don't support getAll
    if (setCookieHeaders.length === 0) {
      const singleCookie = response.headers.get('Set-Cookie');
      if (singleCookie) {
        // Some servers send multiple cookies in one header separated by comma
        // But this is tricky because expires dates also contain commas
        // For safety, treat as single cookie
        this.setFromHeader(singleCookie);
      }
    } else {
      for (const header of setCookieHeaders) {
        this.setFromHeader(header);
      }
    }
  }

  /**
   * Get a specific cookie by name
   */
  getCookie(name: string): Cookie | undefined {
    const cookie = this.cookies.get(name);
    if (cookie && this.isCookieExpired(cookie)) {
      this.cookies.delete(name);
      return undefined;
    }
    return cookie;
  }

  /**
   * Get all valid (non-expired) cookies
   */
  getAllCookies(): Cookie[] {
    const validCookies: Cookie[] = [];
    const expiredNames: string[] = [];

    for (const [name, cookie] of this.cookies) {
      if (this.isCookieExpired(cookie)) {
        expiredNames.push(name);
      } else {
        validCookies.push(cookie);
      }
    }

    // Clean up expired cookies
    for (const name of expiredNames) {
      this.cookies.delete(name);
    }

    return validCookies;
  }

  /**
   * Get cookies as a Map (for AuthContext compatibility)
   */
  getCookiesMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const cookie of this.getAllCookies()) {
      map.set(cookie.name, cookie.value);
    }
    return map;
  }

  /**
   * Build Cookie header string for requests
   */
  getCookieHeader(): string {
    const cookies = this.getAllCookies();
    if (cookies.length === 0) {
      return '';
    }
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Check if a cookie is expired
   */
  private isCookieExpired(cookie: Cookie): boolean {
    const now = Date.now();

    // Check max-age first (takes precedence over expires)
    if (cookie.maxAge !== undefined) {
      // maxAge is in seconds, we need to track when it was set
      // For simplicity, we'll check expires if set, otherwise assume valid
      if (cookie.maxAge <= 0) {
        return true;
      }
    }

    // Check expires
    if (cookie.expires) {
      return cookie.expires.getTime() < now;
    }

    return false;
  }

  /**
   * Delete a cookie by name
   */
  deleteCookie(name: string): boolean {
    return this.cookies.delete(name);
  }

  /**
   * Clear all cookies
   */
  clear(): void {
    this.cookies.clear();
  }

  /**
   * Get the number of cookies in the jar
   */
  get size(): number {
    return this.cookies.size;
  }

  /**
   * Check if a cookie exists
   */
  hasCookie(name: string): boolean {
    const cookie = this.getCookie(name);
    return cookie !== undefined;
  }

  /**
   * Merge cookies from another CookieJar
   */
  merge(other: CookieJar): void {
    for (const cookie of other.getAllCookies()) {
      this.setCookie(cookie);
    }
  }

  /**
   * Create a CookieJar from a Map (for AuthContext compatibility)
   */
  static fromMap(cookieMap: Map<string, string>): CookieJar {
    const jar = new CookieJar();
    for (const [name, value] of cookieMap) {
      jar.setCookie({ name, value });
    }
    return jar;
  }
}
