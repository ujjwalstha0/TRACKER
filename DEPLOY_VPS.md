# Deploy to Existing VPS Safely

This stack is isolated from your old project using different container names, internal ports, and Docker volumes.

## 1) Prepare DNS
- Point sachetana.online to 187.127.137.246.

## 2) Upload and configure
- Clone repo on VPS and create .env from .env.example.
- Keep APP_PORT on a free port (default 8087), and keep BACKEND_PORT as 3001.

## 3) Start this project stack
- Run:
  docker compose --project-name nepse_tracker --env-file .env up -d --build

## 4) Connect existing VPS reverse proxy
- In your current VPS proxy (Nginx, Caddy, NPM), add host rule:
  - host: sachetana.online
  - upstream: http://127.0.0.1:8087
- TLS remains managed by your existing proxy setup.

## 5) Verify
- Open https://sachetana.online
- API is proxied at https://sachetana.online/api

## 6) Logs
- docker compose --project-name nepse_tracker logs -f tracker-frontend
- docker compose --project-name nepse_tracker logs -f tracker-backend
- docker compose --project-name nepse_tracker logs -f tracker-db

## 7) Stop only this stack
- docker compose --project-name nepse_tracker down
