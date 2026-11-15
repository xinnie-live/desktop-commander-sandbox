#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE="ghcr.io/xinnie-live/desktop-commander-sandbox:$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
if [ -L "$ROOT/.test-data" ]; then
  echo 'Refusing to write synthetic test credentials under a symlinked .test-data directory.' >&2
  exit 2
fi
mkdir -p "$ROOT/.test-data"
TEST_DIR=$(mktemp -d "$ROOT/.test-data/proxy-runtime.XXXXXX")
trap 'rm -rf "$TEST_DIR"; rmdir "$ROOT/.test-data" 2>/dev/null || true' EXIT

command -v docker >/dev/null 2>&1 || { echo 'Docker CLI is required.' >&2; exit 2; }
command -v openssl >/dev/null 2>&1 || { echo 'OpenSSL CLI is required.' >&2; exit 2; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "Fixed test image $IMAGE is missing; build it before running this offline check." >&2
  exit 2
}

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TEST_DIR/key.pem" \
  -out "$TEST_DIR/cert.pem" \
  -days 1 \
  -subj '/CN=proxy-probe.invalid' \
  -addext 'subjectAltName=DNS:proxy-probe.invalid' \
  >/dev/null 2>&1
chmod 0444 "$TEST_DIR/key.pem" "$TEST_DIR/cert.pem"
chmod 0755 "$TEST_DIR"
cp "$ROOT/scripts/proxy-runtime-probe.mjs" "$TEST_DIR/probe.mjs"

docker run --rm \
  --network none \
  --read-only \
  --user 10001:10001 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 32 \
  --memory 128m \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001 \
  --mount "type=bind,source=$TEST_DIR,target=/probe,readonly" \
  --env NODE_USE_ENV_PROXY=1 \
  --env HTTP_PROXY=http://127.0.0.1:18480 \
  --env HTTPS_PROXY=http://127.0.0.1:18480 \
  --env http_proxy=http://127.0.0.1:18480 \
  --env https_proxy=http://127.0.0.1:18480 \
  --env NO_PROXY= \
  --env no_proxy= \
  --env NODE_EXTRA_CA_CERTS=/probe/cert.pem \
  --entrypoint node \
  "$IMAGE" \
  /probe/probe.mjs
