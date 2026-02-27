# Flyx 2.0 - Self-Hosted Docker Setup

Run Flyx on your local network at `http://localhost`.

## Quick Start

```bash
# 1. Create your env file
cp docker/.env.example docker/.env
# Edit docker/.env — add your TMDB API key (free at themoviedb.org)

# 2. Run the setup script
# Linux/Mac:
chmod +x flyx.sh
./flyx.sh

# Windows (run PowerShell as Administrator):
.\flyx.ps1
```

That's it. The script builds and launches the container. Open
`http://localhost` to start using Flyx.

## Architecture

The container runs exactly two processes — no reverse proxy, no DNS
infrastructure, no service discovery.

```
 Devices on LAN
      │
      ▼
┌──────────┐
│  Browser  │──── http://localhost ──────┐
└──────────┘                            │
                                        ▼
              ┌──────────┐        ┌──────────┐
              │  Flyx    │        │  Proxy   │
              │  :3000   │        │  :8787   │
              │ (Node.js)│        │  (Bun)   │
              └────┬─────┘        └────┬─────┘
                   │                   │
              ┌────▼─────┐        Direct fetch
              │  SQLite  │        to upstream
              └──────────┘        CDNs & APIs
```

- **Next.js app** (Node.js, port 3000) — serves the frontend and API routes
- **Proxy server** (Bun, port 8787) — handles stream proxying, TMDB API proxying, and content extraction

## Ports

| Port | Service | Description |
|------|---------|-------------|
| 80   | Next.js | Main entry — `http://localhost` (mapped to 3000) |
| 8787 | Proxy   | Stream proxy, TMDB proxy, extractors |

## Commands

| Command | Description |
|---------|-------------|
| `./flyx.sh` | First-time setup + start |
| `./flyx.sh start` | Start all services |
| `./flyx.sh stop` | Stop all services |
| `./flyx.sh restart` | Restart everything |
| `./flyx.sh status` | Show service status |
| `./flyx.sh logs` | Tail all logs |
| `./flyx.sh clean` | Stop, remove volumes |

Windows: replace `./flyx.sh` with `.\flyx.ps1`.

## Environment Variables

See `docker/.env.example`. Only one is required:

- `NEXT_PUBLIC_TMDB_API_KEY` / `TMDB_API_KEY` — free at [themoviedb.org](https://www.themoviedb.org/settings/api)

Optional variables (auto-generated defaults if not set):
- `JWT_SECRET`, `SIGNING_SECRET`, `WATERMARK_SECRET`, `ADMIN_SECRET` — security secrets
- `ENABLE_VIDSRC_PROVIDER` — set to `"true"` to enable VidSrc (default: `"false"`)

## Troubleshooting

### Check services
```bash
docker compose ps
docker compose logs flyx
```

### Proxy health check
```bash
curl http://localhost:8787/health
```

### Full rebuild
```bash
./flyx.sh clean
./flyx.sh start
```
