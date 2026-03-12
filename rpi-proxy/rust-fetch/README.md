# Rust Fetch - Lightweight Browser-like HTTP Client

A fast, lightweight alternative to Puppeteer/Playwright for bypassing Cloudflare protection.

## Features

- **Chrome-like TLS fingerprint**: Mimics Chrome's exact headers and TLS configuration
- **JavaScript execution**: Uses Boa engine to solve JS challenges (no Chromium!)
- **HTTP/2 support**: Native HTTP/2 with proper ALPN negotiation
- **Cookie handling**: Automatic cookie jar for session management
- **Compression**: Supports gzip, deflate, and brotli
- **Fast**: ~10MB binary, <50ms startup time (vs 2GB+ Chromium, 5s+ startup)

## Installation

```bash
cd rpi-proxy/rust-fetch
cargo build --release
sudo cp target/release/rust-fetch /usr/local/bin/
```

## Usage

### Basic fetch
```bash
rust-fetch --url "https://example.com"
```

### With custom headers
```bash
rust-fetch --url "https://api.example.com" \
  --headers '{"Authorization": "Bearer token123"}'
```

### Disable challenge solving (faster)
```bash
rust-fetch --url "https://example.com" --solve-challenges false
```

### Custom timeout
```bash
rust-fetch --url "https://slow-site.com" --timeout 60
```

### Binary fetch mode (raw bytes for AES keys, segments)
```bash
rust-fetch --url "https://cdn.example.com/key" --mode fetch-bin
```

### Available modes
| Mode | Description |
|------|-------------|
| `fetch` | Plain fetch, outputs text to stdout (default) |
| `fetch-bin` | Binary fetch, outputs raw bytes to stdout (for AES keys, segments) |
| `megacloud` | Fetch MegaCloud embed, decrypt, output sources JSON |
| `megaup` | Fetch MegaUp /media/, decrypt via API, output sources JSON |
| `kai-encrypt` | AnimeKai encrypt (`--url` is the plaintext) |
| `kai-decrypt` | AnimeKai decrypt (`--url` is the ciphertext) |
| `recaptcha-v3` | Solve reCAPTCHA v3 via HTTP-only (no browser) |
| `dlhd-whitelist` | Full DLHD flow: reCAPTCHA → verify → whitelist IP |

## Integration with RPI Proxy

Add endpoint to `server.js`:

```javascript
if (reqUrl.pathname === '/fetch-rust') {
  const targetUrl = reqUrl.searchParams.get('url');
  const { spawn } = require('child_process');
  
  const rust = spawn('rust-fetch', ['--url', targetUrl]);
  rust.stdout.pipe(res);
  rust.stderr.on('data', (data) => console.error(`[Rust] ${data}`));
}
```

## Performance Comparison

| Tool | Binary Size | Startup Time | Memory Usage | TLS Fingerprint |
|------|-------------|--------------|--------------|-----------------|
| Puppeteer | 2.5GB | 5-8s | 500MB+ | Chrome (real) |
| Playwright | 2.8GB | 6-10s | 600MB+ | Chrome (real) |
| curl-impersonate | 15MB | <10ms | 5MB | Chrome (mimicked) |
| **rust-fetch** | **10MB** | **<50ms** | **15MB** | **Chrome (mimicked)** |

## How It Works

1. **TLS Mimicry**: Uses reqwest with custom headers to match Chrome's fingerprint
2. **JS Execution**: Boa engine executes challenge scripts without full browser
3. **Challenge Detection**: Scrapes HTML for Cloudflare patterns
4. **Cookie Persistence**: Maintains session across challenge solving

## Limitations

- Cannot solve CAPTCHA challenges (requires human interaction)
- Cannot execute complex DOM manipulation (no full browser engine)
- May fail on advanced bot detection (use Puppeteer as fallback)

## Future Improvements

- [ ] Turnstile CAPTCHA solver integration
- [ ] WebAssembly challenge support
- [ ] Proof-of-work challenge solver
- [ ] Custom cipher suite configuration
- [ ] HTTP/3 support
