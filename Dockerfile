# Pinned multi-platform manifest index; supports linux/amd64 and linux/arm64.
FROM gcc:15-bookworm@sha256:9ca91b05c7b07d2979f16413e8b2cd6ec8a7c80ffca4121ccab0aeba33f90460 AS helper-build
WORKDIR /build
COPY docker/drop_uid_exec.c ./drop_uid_exec.c
RUN gcc -DDEVICE_UID=10001 -DDEVICE_GID=10001 -DTOOL_UID=10002 -DTOOL_GID=10002 \
    -O2 -Wall -Wextra -Werror -o /drop-uid-exec ./drop_uid_exec.c

# Pinned multi-platform manifest index; supports linux/amd64 and linux/arm64.
FROM node:22.21.0-bookworm-slim@sha256:f9f7f95dcf1f007b007c4dcd44ea8f7773f931b71dc79d57c216e731c87a090b

ENV HOME=/var/lib/remote-device \
    DESKTOP_COMMANDER_DISABLE_TELEMETRY=1 \
    NODE_USE_ENV_PROXY=1 \
    REMOTE_DEVICE_SANDBOX_DISABLE_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    npm_config_update_notifier=false

RUN groupadd --gid 10001 remote-device \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /var/lib/remote-device --shell /usr/sbin/nologin remote-device \
    && groupadd --gid 10002 tool \
    && useradd --uid 10002 --gid 10002 --create-home --home-dir /home/tool --shell /usr/sbin/nologin tool \
    && install -d -o 10001 -g 10001 -m 0700 /var/lib/remote-device \
    && install -d -o 10002 -g 10002 -m 0750 /home/tool

WORKDIR /opt/desktop-commander-sandbox
COPY package.json package-lock.json ./
COPY scripts/patch-upstream.mjs ./scripts/patch-upstream.mjs
COPY scripts/third-party-notices.mjs ./scripts/third-party-notices.mjs
COPY LICENSE THIRD-PARTY-NOTICES.md ./
COPY third-party/ ./third-party/
# Lifecycle scripts are disabled: the upstream install hook and transitive
# browser installers have not been approved or needed for the core Remote flow.
RUN npm ci --omit=dev --ignore-scripts \
    && node scripts/patch-upstream.mjs \
    && node scripts/third-party-notices.mjs \
    && npm cache clean --force

COPY --from=helper-build --chown=0:0 /drop-uid-exec /usr/local/bin/drop-uid-exec
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null \
    && chown root:root /usr/local/bin/drop-uid-exec \
    && chmod 4755 /usr/local/bin/drop-uid-exec \
    && test "$(find / -xdev -perm /6000 -type f -print 2>/dev/null | wc -l)" -eq 1

WORKDIR /workspace
USER 10001:10001
ENTRYPOINT ["/opt/desktop-commander-sandbox/node_modules/.bin/desktop-commander"]
CMD ["remote"]
