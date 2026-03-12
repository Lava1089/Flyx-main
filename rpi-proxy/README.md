# Raspberry Pi CORS Proxy

A lightweight proxy server that runs on your Raspberry Pi, allowing your Vercel backend to make requests through your residential IP.

## Setup

### 1. Install on Raspberry Pi

```bash
# Copy the rpi-proxy folder to your Pi
scp -r rpi-proxy pi@raspberrypi.local:~/

# SSH into your Pi
ssh pi@raspberrypi.local

# Install dependencies (none needed - pure Node.js)
cd rpi-proxy
```

### 2. Set your API key

```bash
# Create a strong random key
export API_KEY=$(openssl rand -hex 32)
echo "Your API key: $API_KEY"

# Or set a custom one
export API_KEY="your-secret-key-here"
```

### 3. Run the server

```bash
# Start the server
node server.js

# Or run in background with PM2
npm install -g pm2
pm2 start server.js --name rpi-proxy
pm2 save
pm2 startup  # Auto-start on boot
```

### 4. Expose to the internet (choose one)

#### Option A: Cloudflare Tunnel (Recommended - Free & Secure)

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/

# Quick tunnel (temporary URL)
cloudflared tunnel --url localhost:3001

# Or create a permanent tunnel
cloudflared tunnel login
cloudflared tunnel create rpi-proxy
cloudflared tunnel route dns rpi-proxy proxy.yourdomain.com
cloudflared tunnel run rpi-proxy
```

#### Option B: ngrok

```bash
# Install ngrok
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok

# Run
ngrok http 3001
```

### 5. Configure Vercel

Add these environment variables to your Vercel project:

```
RPI_PROXY_URL=https://your-tunnel-url.trycloudflare.com
RPI_PROXY_KEY=your-api-key-here
```

## Usage

From your Vercel backend:

```typescript
const RPI_PROXY_URL = process.env.RPI_PROXY_URL;
const RPI_PROXY_KEY = process.env.RPI_PROXY_KEY;

async function fetchViaRpiProxy(url: string): Promise<Response> {
  const proxyUrl = `${RPI_PROXY_URL}/proxy?url=${encodeURIComponent(url)}`;
  return fetch(proxyUrl, {
    headers: { 'X-API-Key': RPI_PROXY_KEY }
  });
}
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /proxy?url=<encoded_url>` | Proxy a request through the Pi |
| `GET /fetch-rust?url=<encoded_url>&headers=<json>&timeout=<secs>` | Chrome-like TLS fetch via rust-fetch binary (binary mode) |
| `GET /health` | Health check |

### DLHD Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /dlhd-key-v4?url=&jwt=&timestamp=&nonce=&keyPath=&fingerprint=` | Passthrough for DLHD key fetch (CF Worker provides auth) |
| `GET /dlhdprivate?url=&headers=` | Passthrough proxy for DLHD M3U8/segments |
| `GET /fetch-socks5?url=&headers=&proxy=` | Fetch a URL through a SOCKS5 proxy (bridges CF Worker → SOCKS5 → target) |

### AnimeKai Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /animekai?url=<url>&ua=<user_agent>&referer=<referer>&origin=<origin>&auth=<auth>` | Proxy AnimeKai/MegaUp/Flixer/dvalna CDN streams |
| `GET /animekai/extract?embed=<encrypted>` | Full extraction from encrypted embed |
| `GET /animekai/full-extract?kai_id=<id>&episode=<num>` | Complete extraction from anime ID |

### VIPRow Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /viprow/stream?url=<event_path>&link=<num>&cf_proxy=<proxy_url>` | Extract VIPRow m3u8 stream |
| `GET /viprow/manifest?url=<url>&cf_proxy=<proxy_url>` | Proxy VIPRow manifest with URL rewriting |
| `GET /viprow/key?url=<url>` | Proxy VIPRow AES-128 decryption keys |
| `GET /viprow/segment?url=<url>` | Proxy VIPRow video segments |

### PPV Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /ppv?url=<encoded_url>` | Proxy PPV.to/poocloud.in streams (requires IPv4) |

### IPTV Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /iptv/api?url=<url>&mac=<mac>&token=<token>` | Proxy IPTV Stalker portal API calls |
| `GET /iptv/stream?url=<url>&mac=<mac>&token=<token>` | Proxy IPTV streams |

## CDN-Specific Behavior

### AnimeKai/MegaUp CDN
MegaUp blocks datacenter IPs and requests with Origin/Referer headers. The `/animekai` endpoint fetches WITHOUT these headers from your residential IP.

### Flixer CDN (p.XXXXX.workers.dev)
Flixer CDN blocks datacenter IPs but REQUIRES a Referer header. Pass `?referer=https://flixer.sh/` to include it.

### dvalna.ru (DLHD CDN)
dvalna.ru blocks datacenter IPs. The CF Worker handles all authentication and passes pre-computed headers to the RPI proxy via `/dlhd-key-v4` and `/dlhdprivate` endpoints.

### SOCKS5 Proxy Bridge (`/fetch-socks5`)
CF Workers can't reliably do SOCKS5+TLS (startTls SNI issues), so the RPI acts as a bridge: CF Worker → RPI → SOCKS5 proxy → target. The RPI's own IP may be banned, but the SOCKS5 proxy's IP isn't. Rotates through 20 verified US SOCKS5 proxies. Pass `?proxy=host:port` to use a specific proxy, or omit to auto-rotate.

### VIPRow/Casthill (boanki.net)
VIPRow blocks Cloudflare Workers entirely. The RPI proxy handles full stream extraction including token refresh via boanki.net with Origin: `https://casthill.net`.

### PPV.to (poocloud.in)
PPV streams require:
- Residential IP (blocks datacenter IPs)
- IPv4 connection (blocks IPv6 via Cloudflare)
- Referer: `https://modistreams.org/`

## Security

- API key authentication required for all proxy requests (except /health)
- Rate limiting: 2000 requests/minute (high limit for CF worker which handles many users)
- Only GET requests allowed
- No request body forwarding (safe for read-only proxying)
- Domain allowlists for VIPRow proxying (peulleieo.net, boanki.net only)
- No caching for keys, auth tokens, or m3u8 manifests (must be fresh)

## Systemd Service (Alternative to PM2)

Create `/etc/systemd/system/rpi-proxy.service`:

```ini
[Unit]
Description=RPI CORS Proxy
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/rpi-proxy
Environment=API_KEY=your-secret-key
Environment=PORT=3001
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl enable rpi-proxy
sudo systemctl start rpi-proxy
```
