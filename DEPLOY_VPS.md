# Deploy to VPS (Docker Compose)

## 1) Install Docker on VPS
- Ubuntu: install Docker Engine + Docker Compose plugin.

## 2) Upload project
- Copy this project folder to your VPS.

## 3) Configure environment
- In project root, create .env from .env.example and set strong DB_PASSWORD.

## 4) Start stack
- Run:
  docker compose --env-file .env -f docker-compose.prod.yml up -d --build

## 5) Open app
- Frontend: http://<your-vps-ip>/
- Backend via proxy: http://<your-vps-ip>/api

## 6) Check logs
- docker compose -f docker-compose.prod.yml logs -f frontend
- docker compose -f docker-compose.prod.yml logs -f backend
- docker compose -f docker-compose.prod.yml logs -f postgres

## 7) Stop stack
- docker compose -f docker-compose.prod.yml down

## Optional HTTPS
- Put Nginx Proxy Manager, Caddy, or Traefik in front of port 80 and attach your domain.
