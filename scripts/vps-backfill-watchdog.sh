#!/usr/bin/env bash
set -euo pipefail

APP_PORT="${APP_PORT:-8087}"
MAX_COMPLETED_AGE_HOURS="${MAX_COMPLETED_AGE_HOURS:-30}"
STATUS_URL="http://127.0.0.1:${APP_PORT}/api/ohlc/backfill/status"
START_URL="http://127.0.0.1:${APP_PORT}/api/ohlc/backfill/start"

SYMBOLS_LIMIT="${OHLC_AUTO_BACKFILL_SYMBOLS_LIMIT:-220}"
SINCE_DAYS="${OHLC_AUTO_BACKFILL_SINCE_DAYS:-1}"
THROTTLE_MS="${OHLC_AUTO_BACKFILL_THROTTLE_MS:-45}"

start_incremental_backfill() {
  local payload
  payload="{\"symbolsLimit\":${SYMBOLS_LIMIT},\"sinceDays\":${SINCE_DAYS},\"throttleMs\":${THROTTLE_MS}}"

  local start_json
  start_json="$(curl -fsS -X POST "${START_URL}" -H "Content-Type: application/json" -d "${payload}")"

  local start_status
  start_status="$(printf '%s' "${start_json}" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"

  if [[ "${start_status}" == "RUNNING" || "${start_status}" == "COMPLETED" ]]; then
    echo "[WATCHDOG] Started incremental OHLC backfill with payload: ${payload}."
    return 0
  fi

  echo "[WATCHDOG] Failed to start incremental OHLC backfill. Response: ${start_json}"
  return 1
}

STATUS_JSON="$(curl -fsS "${STATUS_URL}")"
STATUS="$(printf '%s' "${STATUS_JSON}" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
FINISHED_AT="$(printf '%s' "${STATUS_JSON}" | sed -n 's/.*"finishedAt":"\([^"]*\)".*/\1/p')"

if [[ "${STATUS}" == "FAILED" ]]; then
  echo "[WATCHDOG] OHLC backfill status is FAILED."
  exit 1
fi

if [[ "${STATUS}" == "RUNNING" ]]; then
  echo "[WATCHDOG] OHLC backfill is currently RUNNING."
  exit 0
fi

if [[ "${STATUS}" == "IDLE" ]]; then
  echo "[WATCHDOG] OHLC backfill status is IDLE. Triggering incremental start."
  start_incremental_backfill
  exit $?
fi

if [[ "${STATUS}" != "COMPLETED" ]]; then
  echo "[WATCHDOG] Unexpected OHLC backfill status: ${STATUS:-unknown}. Triggering incremental start."
  start_incremental_backfill
  exit $?
fi

if [[ -z "${FINISHED_AT}" || "${FINISHED_AT}" == "null" ]]; then
  echo "[WATCHDOG] Backfill is COMPLETED but finishedAt is missing."
  exit 1
fi

NOW_EPOCH="$(date -u +%s)"
FINISHED_EPOCH="$(date -u -d "${FINISHED_AT}" +%s)"
MAX_AGE_SECONDS="$((MAX_COMPLETED_AGE_HOURS * 3600))"
AGE_SECONDS="$((NOW_EPOCH - FINISHED_EPOCH))"

if (( AGE_SECONDS > MAX_AGE_SECONDS )); then
  echo "[WATCHDOG] Last completed backfill is too old (${AGE_SECONDS}s). Triggering incremental start."
  start_incremental_backfill
  exit $?
fi

echo "[WATCHDOG] OHLC backfill is healthy. Last completion age: ${AGE_SECONDS}s."
