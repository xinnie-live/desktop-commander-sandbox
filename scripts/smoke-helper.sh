#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/desktop-commander-sandbox-helper.XXXXXX")
BUILDX_CONFIG="$TMP_ROOT/buildx"
IMAGE="desktop-commander-sandbox-helper-smoke:$$"
VOLUME="desktop-commander-sandbox-helper-smoke-$$"
WORKSPACE_VOLUME="desktop-commander-sandbox-helper-workspace-smoke-$$"
mkdir -p "$BUILDX_CONFIG" "$TMP_ROOT/context"

cleanup() {
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
    docker volume rm "$WORKSPACE_VOLUME" >/dev/null 2>&1 || true
    docker image rm "$IMAGE" >/dev/null 2>&1 || true
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

cp "$ROOT/docker/drop_uid_exec.c" "$TMP_ROOT/context/drop_uid_exec.c"
cat > "$TMP_ROOT/context/Dockerfile" <<'EOF'
FROM gcc:12-bookworm@sha256:5b83b2851a74d87a3ebf35dc04f16ea1540aff7538b0688b0c9fcd7a407c24a4
COPY drop_uid_exec.c /tmp/drop_uid_exec.c
RUN gcc -DDEVICE_UID=10001 -DDEVICE_GID=10001 -DTOOL_UID=10002 -DTOOL_GID=10002 \
    -O2 -Wall -Wextra -Werror -o /usr/local/bin/drop-uid-exec /tmp/drop_uid_exec.c \
    && rm /tmp/drop_uid_exec.c \
    && find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null \
    && chown root:root /usr/local/bin/drop-uid-exec \
    && chmod 4755 /usr/local/bin/drop-uid-exec \
    && test "$(find / -xdev -perm /6000 -type f -print 2>/dev/null | wc -l)" -eq 1
EOF

BUILDX_CONFIG="$BUILDX_CONFIG" docker build --network=none \
    -t "$IMAGE" "$TMP_ROOT/context"

docker volume create "$VOLUME" >/dev/null
docker volume create "$WORKSPACE_VOLUME" >/dev/null
docker run --rm --network none --user 0:0 \
    --mount "type=volume,src=$VOLUME,dst=/state" "$IMAGE" \
    /bin/sh -c 'mkdir -p /state && chmod 0700 /state && chown 10001:10001 /state && printf synthetic-only > /state/token && chmod 0600 /state/token && chown 10001:10001 /state/token'
docker run --rm --network none --user 0:0 \
    --mount "type=volume,src=$WORKSPACE_VOLUME,dst=/workspace" "$IMAGE" \
    /bin/sh -c 'chown 0:23456 /workspace && chmod 2770 /workspace'

docker run --rm --network none --read-only --cap-drop ALL --cap-add SETUID --cap-add SETGID \
    --user 10001:10001 --group-add 23456 \
    --mount "type=volume,src=$VOLUME,dst=/secrets,readonly" \
    --mount "type=volume,src=$WORKSPACE_VOLUME,dst=/workspace" \
    --entrypoint /usr/local/bin/drop-uid-exec "$IMAGE" --workspace-gid 23456 -- /bin/sh -c '
set -eu
test "$(id -u)" = 10002
groups=" $(id -G) "
case "$groups" in *" 23456 "*) ;; *) echo "FAIL workspace group not retained"; exit 43 ;; esac
case "$groups" in *" 10002 "*) ;; *) echo "FAIL tool group missing"; exit 44 ;; esac
test "$(umask)" = "0007"
touch /workspace/group-test
test "$(stat -c %g /workspace/group-test)" = "23456"
test "$(stat -c %a /workspace/group-test)" = "660"
grep -Eq "^CapEff:[[:space:]]+0+$" /proc/self/status
grep -Eq "^CapAmb:[[:space:]]+0+$" /proc/self/status
grep -Eq "^NoNewPrivs:[[:space:]]+1$" /proc/self/status
if /bin/cat /secrets/token >/dev/null 2>&1; then echo "FAIL synthetic credential readable"; exit 41; fi
if /usr/local/bin/drop-uid-exec -- /usr/bin/id >/dev/null 2>&1; then echo "FAIL helper reusable by tool UID"; exit 42; fi
echo "PASS uid=10002 groups=10002+container-supplementary CapEff=0 CapAmb=0 NoNewPrivs=1 credential=denied helper-reuse=denied"
'
