#!/usr/bin/env bash
set -euo pipefail

APP_PORT="${APP_PORT:-8087}"
MAX_COMPLETED_AGE_HOURS="${MAX_COMPLETED_AGE_HOURS:-30}"
STATUS_URL="http://127.0.0.1:${APP_PORT}/api/ohlc/backfill/status"

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

if [[ "${STATUS}" != "COMPLETED" ]]; then
  echo "[WATCHDOG] Unexpected OHLC backfill status: ${STATUS:-unknown}."
  exit 1
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
  echo "[WATCHDOG] Last completed backfill is too old (${AGE_SECONDS}s)."
  exit 1
fi

echo "[WATCHDOG] OHLC backfill is healthy. Last completion age: ${AGE_SECONDS}s."
