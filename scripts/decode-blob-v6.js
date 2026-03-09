#!/usr/bin/env node
/**
 * New approach: Execute the obfuscated JS in a sandboxed environment.
 * We'll create a minimal browser-like environment and let the JS decode itself.
 * 
 * The key insight: the obfuscated JS reads window['ZpQw9XkLmN8c3vR3'],
 * decodes it, and sets it as an iframe src. We can intercept that.
 */
const fs = require('fs');
const vm = require('vm');

// Read the embed page
const html = fs.readFileSync('data/embed-44-raw.html', 'utf8');

// Extract all script contents
const scripts = [];
const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = scriptRe.exec(html)) !== null) {
  if (m[1].trim().length > 0) {
    scripts.push(m[1]);
  }
}
console.log(`Found ${scripts.length} script blocks`);

// Find the script that contains the obfuscated code (the big one)
const mainScript = scripts.find(s => s.includes('_0x4360') || s.includes('_0x4ef1') || s.includes('_0x3f5a'));
if (!mainScript) {
  console.log('Could not find main obfuscated script');
  // Try the one with ZpQw9XkLmN8c3vR3
  const blobScript = scripts.find(s => s.includes('ZpQw9XkLmN8c3vR3'));
  if (blobScript) {
    console.log('Found blob script, length:', blobScript.length);
    console.log('First 200 chars:', blobScript.substring(0, 200));
  }
  process.exit(1);
}

console.log(`Main script length: ${mainScript.length}`);

// The blob is set BEFORE the main script runs
// Extract the blob assignment
const blobMatch = html.match(/window\['ZpQw9XkLmN8c3vR3'\]\s*=\s*'([^']+)'/);
const blobValue = blobMatch ? blobMatch[1] : '';

// Create a mock DOM environment
const iframeSrcs = [];
const createdElements = [];
const setAttributes = [];

const mockDocument = {
  createElement: function(tag) {
    const elem = {
      _tag: tag,
      id: '',
      style: new Proxy({}, { set: () => true, get: () => '' }),
      setAttribute: function(name, value) {
        setAttributes.push({ tag, name, value });
        this[name] = value;
      },
      getAttribute: function(name) { return this[name] || ''; },
      appendChild: function(child) {},
      removeChild: function(child) {},
      addEventListener: function() {},
      removeEventListener: function() {},
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      innerHTML: '',
      innerText: '',
      textContent: '',
      src: '',
      href: '',
      width: '100%',
      height: '100%',
      title: '',
      rel: '',
      target: '',
      className: '',
      parentNode: null,
      childNodes: [],
      children: [],
      firstChild: null,
      lastChild: null,
      nextSibling: null,
      previousSibling: null,
      nodeType: 1,
      nodeName: tag.toUpperCase(),
      tagName: tag.toUpperCase(),
      ownerDocument: null,
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 1920, height: 1080, right: 1920, bottom: 1080 }),
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementsByTagName: () => [],
      getElementsByClassName: () => [],
      cloneNode: function() { return this; },
      contains: () => false,
      focus: () => {},
      blur: () => {},
      click: () => {},
      dispatchEvent: () => true,
    };
    
    // Track iframe src changes
    if (tag === 'iframe') {
      Object.defineProperty(elem, 'src', {
        set: function(v) {
          this._src = v;
          iframeSrcs.push(v);
          console.log(`[IFRAME SRC SET] ${v}`);
        },
        get: function() { return this._src || ''; }
      });
    }
    
    createdElements.push(elem);
    return elem;
  },
  getElementById: function(id) { return null; },
  getElementsByTagName: function(tag) { return []; },
  getElementsByClassName: function(cls) { return []; },
  querySelector: function(sel) { return null; },
  querySelectorAll: function(sel) { return []; },
  body: {
    appendChild: function(child) {},
    removeChild: function(child) {},
    style: {},
    innerHTML: '',
    children: [],
    childNodes: [],
    classList: { add: () => {}, remove: () => {} },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 1920, height: 1080 }),
  },
  head: { appendChild: function() {} },
  documentElement: { style: {}, clientWidth: 1920, clientHeight: 1080 },
  referrer: 'https://daddylive.dad/',
  title: '',
  cookie: '',
  domain: 'daddylive.dad',
  URL: 'https://daddylive.dad/embed/stream-44.php',
  location: { href: 'https://daddylive.dad/embed/stream-44.php', hostname: 'daddylive.dad', protocol: 'https:', pathname: '/embed/stream-44.php', search: '', hash: '' },
  readyState: 'complete',
  addEventListener: function() {},
  removeEventListener: function() {},
  createEvent: function() { return { initEvent: () => {} }; },
  createTextNode: function(text) { return { nodeType: 3, textContent: text }; },
};

const mockWindow = {
  ZpQw9XkLmN8c3vR3: blobValue,
  document: mockDocument,
  location: { href: 'https://daddylive.dad/embed/stream-44.php', hostname: 'daddylive.dad', protocol: 'https:', pathname: '/embed/stream-44.php', search: '', hash: '', origin: 'https://daddylive.dad', replace: () => {} },
  navigator: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    language: 'en-US',
    languages: ['en-US', 'en'],
    platform: 'Win32',
    vendor: 'Google Inc.',
    appName: 'Netscape',
    appVersion: '5.0',
    product: 'Gecko',
    productSub: '20030107',
    cookieEnabled: true,
    onLine: true,
    hardwareConcurrency: 8,
    maxTouchPoints: 0,
    deviceMemory: 8,
    javaEnabled: () => false,
    sendBeacon: () => true,
    vibrate: () => false,
    share: async () => {},
    canShare: () => false,
    clipboard: { writeText: async () => {}, readText: async () => '' },
    permissions: { query: async () => ({ state: 'granted', cameras: [], microphones: [] }) },
    mediaDevices: { enumerateDevices: async () => [] },
    connection: { effectiveType: '4g', downlink: 10, rtt: 50 },
    getBattery: async () => ({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 }),
    getGamepads: () => [],
    requestMediaKeySystemAccess: async () => { throw new Error('not supported'); },
    locks: { request: async () => {} },
    storage: { estimate: async () => ({ quota: 1000000000, usage: 0 }) },
    serviceWorker: { register: async () => ({}), ready: Promise.resolve({}) },
    credentials: { get: async () => null, create: async () => null },
    geolocation: { getCurrentPosition: () => {} },
    mediaSession: { setActionHandler: () => {} },
    wakeLock: { request: async () => ({ release: async () => {} }) },
    usb: { getDevices: async () => [] },
    bluetooth: { getAvailability: async () => false },
    xr: { isSessionSupported: async () => false },
    hid: { getDevices: async () => [] },
    serial: { getPorts: async () => [] },
    gpu: { requestAdapter: async () => null },
    scheduling: { isInputPending: () => false },
    ink: { requestPresenter: async () => ({}) },
    managed: { getManagedConfiguration: async () => ({}) },
    login: { setStatus: () => {} },
    windowControlsOverlay: { visible: false },
    userActivation: { hasBeenActive: true, isActive: true },
    webdriver: false,
    pdfViewerEnabled: true,
    permissions: { query: async () => ({ state: 'granted', cameras: [], microphones: [] }) },
    mediaDevices: { enumerateDevices: async () => [] },
  },
  screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 },
  innerWidth: 1920,
  innerHeight: 1080,
  outerWidth: 1920,
  outerHeight: 1080,
  devicePixelRatio: 1,
  self: null,
  top: null,
  parent: null,
  frames: [],
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  addEventListener: function(event, handler) {
    // Capture DOMContentLoaded handlers
    if (event === 'load' || event === 'DOMContentLoaded') {
      try { handler(); } catch(e) {}
    }
  },
  removeEventListener: function() {},
  setTimeout: function(fn, ms) { try { fn(); } catch(e) {} return 1; },
  setInterval: function(fn, ms) { return 1; },
  clearTimeout: function() {},
  clearInterval: function() {},
  requestAnimationFrame: function(fn) { try { fn(0); } catch(e) {} return 1; },
  cancelAnimationFrame: function() {},
  fetch: async function() { return { ok: false, status: 404, json: async () => ({}), text: async () => '' }; },
  XMLHttpRequest: function() { return { open: () => {}, send: () => {}, setRequestHeader: () => {}, addEventListener: () => {} }; },
  atob: function(str) { return Buffer.from(str, 'base64').toString('binary'); },
  btoa: function(str) { return Buffer.from(str, 'binary').toString('base64'); },
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
  encodeURI: encodeURI,
  decodeURI: decodeURI,
  escape: escape,
  unescape: unescape,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  isFinite: isFinite,
  JSON: JSON,
  Math: Math,
  Date: Date,
  RegExp: RegExp,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Boolean: Boolean,
  Error: Error,
  TypeError: TypeError,
  RangeError: RangeError,
  SyntaxError: SyntaxError,
  URIError: URIError,
  Promise: Promise,
  Symbol: Symbol,
  Map: Map,
  Set: Set,
  WeakMap: WeakMap,
  WeakSet: WeakSet,
  Proxy: Proxy,
  Reflect: Reflect,
  URL: URL,
  URLSearchParams: URLSearchParams,
  TextEncoder: TextEncoder,
  TextDecoder: TextDecoder,
  console: {
    log: function() { console.log('[VM]', ...arguments); },
    warn: function() {},
    error: function() {},
    info: function() {},
    debug: function() {},
  },
  Request: function(url, opts) { this.url = url; this.keepalive = opts?.keepalive; },
  crypto: { subtle: { digest: async () => new ArrayBuffer(32) }, getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; } },
  performance: { now: () => Date.now() },
  Image: function() { return { src: '', onload: null, onerror: null }; },
  HTMLElement: function() {},
  HTMLIFrameElement: function() {},
  HTMLDivElement: function() {},
  HTMLAnchorElement: function() {},
  HTMLImageElement: function() {},
  HTMLVideoElement: function() {},
  HTMLScriptElement: function() {},
  Element: function() {},
  Node: function() {},
  Event: function(type) { this.type = type; this.preventDefault = () => {}; this.stopPropagation = () => {}; },
  CustomEvent: function(type, opts) { this.type = type; this.detail = opts?.detail; },
  DOMParser: function() { return { parseFromString: () => mockDocument }; },
  MutationObserver: function() { return { observe: () => {}, disconnect: () => {} }; },
  ResizeObserver: function() { return { observe: () => {}, disconnect: () => {} }; },
  IntersectionObserver: function() { return { observe: () => {}, disconnect: () => {} }; },
  getComputedStyle: () => new Proxy({}, { get: () => '' }),
  matchMedia: () => ({ matches: false, addListener: () => {}, removeListener: () => {} }),
  postMessage: () => {},
  open: () => null,
  close: () => {},
  focus: () => {},
  blur: () => {},
  print: () => {},
  alert: () => {},
  confirm: () => false,
  prompt: () => null,
  _Hasync: [],
};

mockWindow.self = mockWindow;
mockWindow.top = mockWindow;
mockWindow.parent = mockWindow;
mockWindow.window = mockWindow;

// Create the VM context
const context = vm.createContext(mockWindow);

// First set the blob value
vm.runInContext(`window['ZpQw9XkLmN8c3vR3'] = '${blobValue}';`, context);

// Now run the main script
console.log('\nExecuting obfuscated script...');
try {
  vm.runInContext(mainScript, context, { timeout: 10000 });
} catch (e) {
  console.log(`Script error: ${e.message}`);
  if (e.message.includes('is not defined')) {
    console.log('Missing global:', e.message);
  }
}

// Check results
console.log(`\nIframe srcs captured: ${iframeSrcs.length}`);
for (const src of iframeSrcs) {
  console.log(`  ${src}`);
}

console.log(`\nElements created: ${createdElements.length}`);
for (const elem of createdElements) {
  if (elem._src) console.log(`  ${elem._tag}: src=${elem._src}`);
  if (elem.href) console.log(`  ${elem._tag}: href=${elem.href}`);
}

console.log(`\nAttributes set: ${setAttributes.length}`);
for (const attr of setAttributes) {
  if (attr.name === 'src' || attr.name === 'href') {
    console.log(`  ${attr.tag}.${attr.name} = ${attr.value}`);
  }
}

// Check if the blob was decoded and stored somewhere
console.log(`\nWindow ZpQw9XkLmN8c3vR3: ${typeof context.ZpQw9XkLmN8c3vR3 === 'string' ? context.ZpQw9XkLmN8c3vR3.substring(0, 100) : context.ZpQw9XkLmN8c3vR3}`);

// Check for any new window properties
const knownProps = new Set(Object.keys(mockWindow));
for (const key of Object.keys(context)) {
  if (!knownProps.has(key) && key !== 'ZpQw9XkLmN8c3vR3') {
    const val = context[key];
    if (typeof val === 'string' && val.length < 500) {
      console.log(`  New window.${key} = ${val}`);
    } else if (typeof val === 'string') {
      console.log(`  New window.${key} = [string, ${val.length} chars]`);
    } else {
      console.log(`  New window.${key} = ${typeof val}`);
    }
  }
}
