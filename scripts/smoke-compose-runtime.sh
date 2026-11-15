#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE="ghcr.io/xinnie-live/desktop-commander-sandbox:$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
PROJECT_NAME="remote-device-compose-smoke-$$"
if [ "$(uname -s)" = Darwin ]; then
    TMP_ROOT=/private/tmp
else
    TMP_ROOT=${TMPDIR:-/tmp}
fi
TEST_ROOT=$(mktemp -d "${TMP_ROOT%/}/remote-device-compose-smoke.XXXXXX")
OVERRIDE_FILE="$TEST_ROOT/override.yaml"
WORKSPACE="$TEST_ROOT/sandbox-workspace"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Required fixed image $IMAGE is not present; build it before running this offline check." >&2
    rm -rf "$TEST_ROOT"
    exit 2
fi

mkdir -p "$TEST_ROOT/scripts" "$TEST_ROOT/docker"
cp "$ROOT/compose.yaml" "$ROOT/Dockerfile" "$ROOT/.dockerignore" \
    "$ROOT/package.json" "$ROOT/package-lock.json" "$TEST_ROOT/"
cp "$ROOT/scripts/patch-upstream.mjs" "$TEST_ROOT/scripts/"
cp "$ROOT/docker/drop_uid_exec.c" "$TEST_ROOT/docker/"
cd "$TEST_ROOT"

cleanup() {
    docker compose -p "$PROJECT_NAME" -f compose.yaml -f "$OVERRIDE_FILE" \
        down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

mkdir -p "$WORKSPACE"
export REMOTE_DEVICE_WORKSPACE_PATH="$WORKSPACE"
export REMOTE_DEVICE_WORKSPACE_READ_ONLY=false
if [ "$(uname -s)" = Linux ]; then
    WORKSPACE_GID=$(id -g)
    case "$WORKSPACE_GID" in
        ''|0|*[!0-9]*) echo "Linux bind-mount smoke requires a non-root numeric primary GID." >&2; exit 2 ;;
    esac
    if [ "$WORKSPACE_GID" -gt 65535 ]; then
        echo "Linux bind-mount smoke requires a primary GID no greater than 65535." >&2
        exit 2
    fi
    chmod 2770 "$WORKSPACE"
    export REMOTE_DEVICE_WORKSPACE_GID="$WORKSPACE_GID"
    export REMOTE_DEVICE_DOCKER_GROUP_GID="$WORKSPACE_GID"
fi
cat > "$OVERRIDE_FILE" <<'YAML'
services:
  remote-device:
    network_mode: none
YAML

# Override the image's default Remote Device entrypoint. The run stays offline.
docker compose -p "$PROJECT_NAME" -f compose.yaml -f "$OVERRIDE_FILE" \
    run --rm --no-deps --entrypoint /bin/sh remote-device -c '
        set -eu
        test "$(id -u)" = 10001
        printf SYNTHETIC_RW_OK > /workspace/write-check.txt
        if [ -e /var/run/docker.sock ] || [ -e /Users ]; then
            echo FORBIDDEN_PATH_PRESENT >&2
            exit 1
        fi
        printf "PASS compose runtime uid=%s workspace=rw docker_socket=absent users_root=absent network=none\\n" "$(id -u)"
    '

test "$(cat "$WORKSPACE/write-check.txt")" = SYNTHETIC_RW_OK
echo "PASS synthetic Compose mount checks"
