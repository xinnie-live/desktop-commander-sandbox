#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE=${IMAGE:-ghcr.io/xinnie-live/desktop-commander-sandbox:$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")}
VOLUME="remote-device-integration-smoke-$$"

cleanup() {
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker volume create "$VOLUME" >/dev/null

# Seed only synthetic state into a Docker-managed volume. No host path is mounted.
docker run --rm --network none --read-only --user 0:0 \
    --volume "$VOLUME:/var/lib/remote-device" \
    --entrypoint /bin/sh "$IMAGE" -c '
        mkdir -p /var/lib/remote-device/.desktop-commander-device
        chown 10001:10001 /var/lib/remote-device/.desktop-commander-device
        chmod 0700 /var/lib/remote-device/.desktop-commander-device
        printf SYNTHETIC_ONLY > /var/lib/remote-device/.desktop-commander-device/device.json
        chown 10001:10001 /var/lib/remote-device/.desktop-commander-device/device.json
        chmod 0600 /var/lib/remote-device/.desktop-commander-device/device.json
    '

docker run --rm -i --network none --read-only \
    --cap-drop ALL --cap-add SETUID --cap-add SETGID \
    --user 10001:10001 --group-add 23456 \
    --env HOME=/var/lib/remote-device \
    --env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    --env TMPDIR=/tmp \
    --env USER=remote-device \
    --env LOGNAME=remote-device \
    --env DESKTOP_COMMANDER_DISABLE_TELEMETRY=1 \
    --env PUPPETEER_SKIP_DOWNLOAD=1 \
    --env REMOTE_DEVICE_SANDBOX_DISABLE_BROWSER_DOWNLOAD=1 \
    --env REMOTE_DEVICE_WORKSPACE_GID=23456 \
    --env PARENT_SECRET_SENTINEL=SYNTHETIC_PARENT_SECRET_123 \
    --volume "$VOLUME:/var/lib/remote-device" \
    --tmpfs /tmp:rw,nosuid,nodev,size=64m \
    --tmpfs /home/tool:rw,nosuid,nodev,size=64m,uid=10002,gid=10002 \
    --entrypoint node "$IMAGE" --input-type=module <<'NODE'
const { DesktopCommanderIntegration } = await import(
  "/opt/desktop-commander-sandbox/node_modules/@wonderwhy-er/desktop-commander/dist/remote-device/desktop-commander-integration.js"
);
const integration = new DesktopCommanderIntegration();

try {
  await integration.initialize();
  const listed = await integration.listClientTools();
  const envResult = await integration.callClientTool("start_process", {
    command: 'if [ -n "$PARENT_SECRET_SENTINEL" ]; then echo ENV_LEAK; else echo ENV_STRIPPED; fi',
    timeout_ms: 5000,
  });
  const envOutput = JSON.stringify(envResult);
  if (!envOutput.includes("ENV_STRIPPED") || envOutput.includes("ENV_LEAK")) {
    throw new Error("Synthetic parent environment sentinel check failed");
  }

  const groupResult = await integration.callClientTool("start_process", {
    command: "id -G",
    timeout_ms: 5000,
  });
  const groupOutput = JSON.stringify(groupResult);
  if (!groupOutput.includes("23456") || !groupOutput.includes("10002")) {
    throw new Error("Supplementary workspace group was not retained by the tool child");
  }

  const credentialResult = await integration.callClientTool("start_process", {
    command: "cat /var/lib/remote-device/.desktop-commander-device/device.json",
    timeout_ms: 5000,
  });
  const credentialOutput = JSON.stringify(credentialResult);
  if (credentialOutput.includes("SYNTHETIC_ONLY") || !credentialOutput.includes("Permission denied")) {
    throw new Error("Synthetic credential isolation check failed");
  }

  await integration.shutdown();
  if (integration.ready) throw new Error("Integration did not become not-ready after shutdown");
  console.log(JSON.stringify({
    integrationReadyThenShutdown: true,
    toolCount: listed.tools.length,
    parentEnvironment: "stripped",
    supplementaryWorkspaceGroup: "retained",
    syntheticCredential: "permission denied",
    realRemoteDeviceStarted: false,
    cloudConnected: false,
  }));
} catch (error) {
  await integration.shutdown().catch(() => {});
  console.error(`Synthetic integration verification failed: ${error.message}`);
  process.exitCode = 1;
}
NODE
