#!/bin/sh
# Start-up script: restore the database from the bucket (if backups are configured), then run the app
# while Litestream keeps copying every change back to the bucket.
# Works with Backblaze B2 (recommended), Cloudflare R2, AWS S3, Supabase Storage or any S3-compatible bucket.
set -e

export DB_PATH="${DB_PATH:-/data/learninghub.db}"
export LITESTREAM_PATH="${LITESTREAM_PATH:-peakpoints/learninghub.db}"
CONFIG="${LITESTREAM_CONFIG:-/app/litestream.yml}"

if [ -n "$LITESTREAM_BUCKET" ]; then
  # Accept the endpoint with or without "https://" and a trailing slash (e.g. s3.us-west-004.backblazeb2.com)
  EP="$(printf '%s' "$LITESTREAM_ENDPOINT" | sed -e 's#/*$##')"
  case "$EP" in
    http://*|https://*) ;;
    "") echo "[start] ERROR: LITESTREAM_ENDPOINT is not set"; exit 1 ;;
    *) EP="https://$EP" ;;
  esac
  export LITESTREAM_ENDPOINT="$EP"

  # Backblaze B2 endpoints look like s3.<region>.backblazeb2.com - take the region from there if not given
  if [ -z "$LITESTREAM_REGION" ]; then
    LITESTREAM_REGION="$(printf '%s' "$EP" | sed -n 's#^https\{0,1\}://s3\.\([^.]*\)\.backblazeb2\.com.*#\1#p')"
    [ -n "$LITESTREAM_REGION" ] || LITESTREAM_REGION="auto"
  fi
  export LITESTREAM_REGION

  echo "[start] Bucket backup is ON (bucket: $LITESTREAM_BUCKET, endpoint: $LITESTREAM_ENDPOINT, region: $LITESTREAM_REGION)"
  # Only restores when the local file is missing (a fresh/restarted Render container) and a backup exists.
  litestream restore -config "$CONFIG" -if-db-not-exists -if-replica-exists "$DB_PATH"
  exec litestream replicate -config "$CONFIG" -exec "node server.js"
else
  echo "[start] WARNING: LITESTREAM_BUCKET is not set - data is stored only on this machine's disk."
  exec node server.js
fi
