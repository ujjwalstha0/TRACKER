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

## 5.1) OHLC auto-update (daily incremental)
- This stack now auto-runs incremental OHLC backfill daily in backend.
- Default behavior:
  - enabled: true
  - run once after startup (after 90s)
  - repeat every 24 hours
  - incremental window: last 1 day
- Configure in `.env` if needed:
  - `OHLC_AUTO_BACKFILL_ENABLED=true`
  - `OHLC_AUTO_BACKFILL_RUN_ON_STARTUP=true`
  - `OHLC_AUTO_BACKFILL_STARTUP_DELAY_MS=90000`
  - `OHLC_AUTO_BACKFILL_INTERVAL_HOURS=24`
  - `OHLC_AUTO_BACKFILL_SINCE_DAYS=1`
  - `OHLC_AUTO_BACKFILL_SYMBOLS_LIMIT=220`
  - `OHLC_AUTO_BACKFILL_THROTTLE_MS=45`

## 5.2) Check auto backfill status
- `curl -fsS http://127.0.0.1:8087/api/ohlc/backfill/status`
- `docker compose --project-name nepse_tracker --env-file .env -f docker-compose.prod.yml logs --tail=200 tracker-backend | grep -i "automatic OHLC backfill\|Started automatic OHLC backfill"`

## 5.3) Add watchdog (recommended)
- Make script executable:
  - `chmod +x scripts/vps-backfill-watchdog.sh`
- Run once manually:
  - `APP_PORT=8087 MAX_COMPLETED_AGE_HOURS=30 ./scripts/vps-backfill-watchdog.sh`
- Add cron (every 2 hours):
  - `crontab -e`
  - Add line:
    - `0 */2 * * * cd /opt/tracker && APP_PORT=8087 MAX_COMPLETED_AGE_HOURS=30 ./scripts/vps-backfill-watchdog.sh >> /var/log/tracker-backfill-watchdog.log 2>&1`

## 6) Logs
- docker compose --project-name nepse_tracker logs -f tracker-frontend
- docker compose --project-name nepse_tracker logs -f tracker-backend
- docker compose --project-name nepse_tracker logs -f tracker-db

## 7) Stop only this stack
- docker compose --project-name nepse_tracker down
