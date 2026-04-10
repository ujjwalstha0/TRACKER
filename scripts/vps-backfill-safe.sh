#!/usr/bin/env bash
set -euo pipefail

# Safe defaults for this project only.
PROJECT_NAME="${PROJECT_NAME:-nepse_tracker}"
STACK_DIR="${STACK_DIR:-/opt/tracker}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
APP_PORT="${APP_PORT:-8087}"
SYMBOLS_LIMIT="${SYMBOLS_LIMIT:-220}"
THROTTLE_MS="${THROTTLE_MS:-45}"
SINCE_DAYS="${SINCE_DAYS:-}"
POLL_SECONDS="${POLL_SECONDS:-5}"

echo "[1/5] Moving to stack directory: ${STACK_DIR}"
cd "${STACK_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found in ${STACK_DIR}."
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERROR: ${COMPOSE_FILE} not found in ${STACK_DIR}."
  exit 1
fi

# Only this compose project is started/updated.
echo "[2/5] Starting/updating compose project: ${PROJECT_NAME}"
docker compose \
  --project-name "${PROJECT_NAME}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  up -d --build

echo "[3/5] Current containers for ${PROJECT_NAME}"
docker compose \
  --project-name "${PROJECT_NAME}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  ps

BACKFILL_BASE="http://127.0.0.1:${APP_PORT}/api/ohlc/backfill"

if [[ -n "${SINCE_DAYS}" ]]; then
  PAYLOAD="{\"symbolsLimit\":${SYMBOLS_LIMIT},\"throttleMs\":${THROTTLE_MS},\"sinceDays\":${SINCE_DAYS}}"
else
  PAYLOAD="{\"symbolsLimit\":${SYMBOLS_LIMIT},\"throttleMs\":${THROTTLE_MS}}"
fi

echo "[4/5] Starting OHLC backfill job"
echo "Payload: ${PAYLOAD}"
curl -fsS -X POST "${BACKFILL_BASE}/start" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}"
echo

echo "[5/5] Polling backfill status every ${POLL_SECONDS}s"
while true; do
  STATUS_JSON="$(curl -fsS "${BACKFILL_BASE}/status")"
  echo "${STATUS_JSON}"

  if echo "${STATUS_JSON}" | grep -q '"status":"COMPLETED"'; then
    echo "Backfill completed successfully."
    break
  fi

  if echo "${STATUS_JSON}" | grep -q '"status":"FAILED"'; then
    echo "Backfill failed. Check tracker-backend logs:"
    echo "docker compose --project-name ${PROJECT_NAME} --env-file ${ENV_FILE} -f ${COMPOSE_FILE} logs -f tracker-backend"
    exit 1
  fi

  sleep "${POLL_SECONDS}"
done

echo "Done. This script touched only compose project '${PROJECT_NAME}'."
