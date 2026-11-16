# Security Model

[English](SECURITY_MODEL.md) | [简体中文](SECURITY_MODEL.zh-CN.md)

## Current architecture

The product has one `remote-device` Compose service on Docker Compose’s default bridge. It targets Docker Linux containers on macOS, Windows, and Linux. It does not use `network_mode: host` or share the host network namespace. The container still has ordinary Docker outbound connectivity.

The product does not require a particular proxy. It works directly when the container network permits direct access. System HTTP proxy settings are not read by default. A user may explicitly follow current system HTTP(S) settings, enter a generic proxy in the local console, or configure `.env`. Explicit HTTP(S) proxies are also used for build dependency downloads; Docker Engine pulls base images through its own registry proxy configuration. BuildKit proxy values are not declared or referenced in the Dockerfile. The build uses Compose 2.24.1+ `build.extra_hosts` to map `host.docker.internal`. Node’s environment proxy affects supported HTTP/HTTPS/fetch clients and does not guarantee WebSocket or full-traffic proxying. Loopback proxy URLs are mapped to `host.docker.internal`; this mapping is not an access-control policy. The host proxy must accept Docker network connections, and reachability depends on Docker Engine/Desktop, VPN, firewall, and proxy bind address.

Runtime proxy environment variables are stored in Docker container configuration and are visible to local Docker administrators, including proxy credentials. Stopping the container does not clear them; recreate or remove the container to clear them. A proxy set through `.env` also remains in the local project file. Host platforms other than macOS + OrbStack have not been tested. PAC/WPAD and SOCKS are not directly supported by system-proxy following.

## Assets to protect

- Host files that were not explicitly authorized, and integrity of read-only mounted files.
- Remote Device session credentials and device identity.
- Local per-run logs containing complete container stdout/stderr, which may include authorization data, credentials, tool arguments/results, file contents, and host paths.
- The host Docker daemon and other host-management interfaces.
- Telemetry produced by local tools and the user’s understanding of what is protected.

## Trust boundaries

- AI clients and their accounts, third-party cloud relays/services.
- Remote Device and Local MCP tools, including terminal-command execution.
- Linux containers, Docker Engine or Docker Desktop VM, and host networking on each platform.
- The on-demand local console and browser session. The console process uses the current OS user’s Docker CLI permissions.

The project does not assume that clients or cloud services are absolutely trustworthy. This is not an allegation that a specific service is malicious or compromised.

The console uses a fixed default loopback port (53707). Any browser on the host can open the address and obtain the current per-start token with a same-origin JSON POST to `/api/session`. This endpoint requires the exact Origin and custom request header, rejects cross-origin fetch metadata, and offers no CORS preflight. It performs no device or filesystem operation. The browser keeps the token only in memory; API routes still validate it. This is a browser-origin boundary, not authentication between local OS users: processes or other users that can reach host loopback are trusted by this design.

## Threat scenarios

| Scenario | Current controls | Residual risk |
|---|---|---|
| Local run logs are exposed or shared | Raw output is kept only in the current user’s application log directory; POSIX directory/file modes are `0700`/`0600`; retain at most 7 matching run files, each at most 10 MB; cleanup is non-recursive and limited to matching regular files | The logs intentionally are not redacted and can contain credentials, authorization links/codes, user data, tool arguments/results, and host paths. Anyone with access to the user account or copied log files can read that content. There is no age-based expiry or upload by the console. |
| Cloud service or account is misused | Mount only the selected workspace and explicitly selected extra folders, with per-folder read/write permissions; read-only container rootfs; tool UID 10002; stop the container when needed | Data legitimately readable after authorization may still be transferred through a valid remote connection. On Linux, the tool child also joins the current primary group to access bind mounts; other group members can access sandbox data. The terminal can read system files, the tool home volume, and temporary files readable by its UID. |
| Prompt injection or harmful remote terminal command | Do not mount a home root, real keys, browser config, project source, or Docker Socket. No `privileged` or host PID. Only the fixed UID helper receives `SETUID`/`SETGID`; no other capabilities. Use default bridge. | Tools can read/write paths available to their UID and reach external addresses through Docker bridge. Do not use this as a strong sandbox for untrusted code. |
| Writable workspace receives malicious content | Use a dedicated `sandbox-workspace/`; inspect content before executing it on the host | Scripts, Git hooks, package lifecycle scripts, and Makefiles may have effects if a user later runs them. |
| Container reaches a local management service | No Docker Socket, no host PID, demoted tool UID, default bridge | Compose explicitly maps `host.docker.internal` to the host gateway for optional proxies. The container may try other host listeners reachable through that gateway; the exact scope depends on Docker Desktop/Engine firewall and bind addresses and has not been exhaustively tested. |
| Network or proxy is unavailable | No dependency on a specific proxy app or port; direct connection, explicit system HTTP(S) proxy, or generic proxy settings are available | The container still needs Docker network access to Remote Device. There is no outbound filtering. System proxy is read only when selected. PAC/WPAD, SOCKS, or a host proxy unreachable from the container require manual handling. |
| Local web page misuses the console | Listen only on `127.0.0.1`; random per-start token; Host/Origin/custom-header validation; strict CSP; no CORS; fixed Compose operations only | The local process has the user’s Docker permissions. These controls cannot isolate malicious same-user processes, a controlled browser, or the host account. |
| User selects an overly broad folder or permission | Arbitrary paths come only from the native folder picker; new mounts default to read-only; maximum 8 mounts with independent permission; review all paths and modes before one apply; reject read/write mounts containing project source, local mount config, or control files | The selected folder and every descendant are exposed. Read-only data is still readable. A read/write mount lets the container attempt modifications, subject to host file permissions and runtime sharing rules. The product cannot determine which files are private; the user chooses the scope. |
| Container/runtime vulnerability | Read-only rootfs, cleared default capabilities, limited mounts, pinned versions, no Docker Socket | No guarantee against container escape, Docker Desktop VM/host vulnerabilities, or unknown upstream flaws. |

## File and process boundaries

- `/workspace`: dedicated project host bind mount by default; user may choose read-only or read/write.
- `/mnt/remote-device/<folder-name>`: up to 8 explicit folders from the native picker, each independently read-only/read-write. The folder basename is used for the container target; duplicate basenames receive a stable mount-ID suffix. The list is saved per Compose project in the current user’s application configuration directory. Local control logic generates the fixed Compose override; it and the config file are outside Agent-writable mounts.
- `/home/tool`: tool home (the `tool-config` Compose volume), writable by the tool UID and retained across container recreation.
- `/tmp`: container tmpfs, cleared on stop.
- `/var/lib/remote-device`: device-state named volume; remote tool UID 10002 currently cannot read/write it. Do not inspect real session state directly.
- Remote Device parent process runs as UID 10001; Local MCP tools run as UID 10002. On Linux the host runtime adds the current primary GID to the container and grants it to the tool process for project-owned bind mounts. Other members of that group get corresponding directory access. The root filesystem is read-only, but system files may still be readable by the tool UID.

Upstream `allowedDirectories` constrains some file tools only; it is not an operating-system boundary for terminal commands.

## Telemetry

npm lifecycle scripts are disabled during image installation. Runtime sets `DESKTOP_COMMANDER_DISABLE_TELEMETRY=1`, supported by the pinned upstream version. This does not disconnect required Remote Device cloud connections or provide full traffic auditing; the terminal can still connect to external services over the shared network.

## Out of scope

- Preventing harmful model/client suggestions or blocking exfiltration of readable data over a valid connection.
- Configuring or enforcing the host system proxy route.
- Consistent behavior across all Windows/Linux/macOS Docker runtimes, VPNs, and firewalls.
- Defending a compromised OS, Docker Desktop VM, Docker daemon, or same-user process.
- General enterprise network policy, terminal command review, or content filtering.

## Required validation and open items

Validation applies only to the specific image, Compose configuration, operating system, container runtime, and test path recorded. Host-management reachability on each platform, optional proxy/WebSocket behavior, offline recovery, and runtime-specific differences remain open. Do not mark incomplete checks as passing or make broad claims that the system is secure.
