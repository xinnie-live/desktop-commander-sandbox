# User Guide

[English](USAGE.md) | [简体中文](USAGE.zh-CN.md)

Jump to: [Prerequisites](#prerequisites) · [Start the console](#start-the-console) · [Workspaces and mounts](#workspaces-and-mounts) · [Run logs](#run-logs) · [CLI](#cli) · [Proxies](#network-and-proxies) · [Container paths](#container-paths) · [Common issues](#common-issues)

For how to get good results from the AI inside the container (runtime copies, dependencies, certificates, previews), see the [AI workflow guide](AI_WORKFLOW.md).

## Prerequisites

You need **Node.js 22.12.0 or later** and Docker that runs Linux containers: Docker Desktop, OrbStack, or Docker Engine with the **Compose plugin 2.24.1+**.

The host computer needs Node.js for the local CLI and Web console. CI covers Node.js 22.21.0 and 24; the container independently uses the pinned Node.js 22.21.0 image. You do not install Node.js inside the container manually.


| Platform | Setup | Official guides |
|---|---|---|
| macOS | Node.js 22.12.0+, plus Docker Desktop or OrbStack | [Node.js](https://nodejs.org/en/download) · [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) |
| Windows | Node.js 22.12.0+, plus Docker Desktop with the WSL 2 / Linux containers backend | [Node.js](https://nodejs.org/en/download) · [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) · [WSL](https://docs.docker.com/desktop/features/wsl/) |
| Linux | Node.js 22.12.0+, Docker Engine and the Compose plugin; run as a regular user allowed to use Docker | [Node.js](https://nodejs.org/en/download) · [Docker Engine](https://docs.docker.com/engine/install/) · [Compose plugin](https://docs.docker.com/compose/install/linux/) |

The console has no npm dependencies, so `npm install` is not needed. Desktop Commander and its pinned dependencies are installed into the Docker image when you first build it. This project never installs software, changes group membership, or modifies system settings for you. On Linux, adding a user to the `docker` group grants root-equivalent control of the Docker daemon; do it only for trusted users.

See the [README](../README.md#platform-status) for verified Docker environments.

### Linux folder picker and headless hosts

The native folder picker needs an active graphical desktop session and either `zenity` or `kdialog` installed on the host and available in PATH. Install one through your distribution's package manager if you want to choose folders in the browser. A headless host can use the fixed CLI instead:

```sh
node scripts/console.mjs workspace create trial --main "/absolute/path/to/trial" --read-only
node scripts/console.mjs workspace list
```

Replace the example with a dedicated existing folder that meets the Linux group-permission requirements below. Creating this saved profile does not start or pair a device. Use the CLI workspace switch/start commands separately when ready. The web console binds only to the host's `127.0.0.1`; do not expose it as a remote endpoint. The Linux retest did not validate the native picker or a complete UI-to-container session.


## First-time Windows setup

**Keep using Windows: you do not need to install a separate Linux system, Ubuntu, or Linux desktop, or enter a Linux terminal.** The launcher and browser console run on Windows. Docker Desktop supplies the Linux container environment in the background.

1. Install Node.js 22.12.0 or later from the [official Node.js website](https://nodejs.org/en/download).
2. Open the [official Docker Desktop Windows installation guide](https://docs.docker.com/desktop/setup/install/windows-install/), check its system requirements, and choose the installer for your CPU. Intel / AMD PCs use x86_64; Windows ARM PCs should follow the official Arm instructions.
3. Choose **WSL 2** and **Linux containers**. If prompted, enable or update WSL 2 using the [official WSL guide](https://docs.docker.com/desktop/features/wsl/), and restart Windows if requested. WSL 2 is background infrastructure; a separate Ubuntu installation is not required. Docker has other backends; this guide covers the WSL 2 route.
4. Open **Docker Desktop** from Start, review and accept its first-use terms yourself, and wait for the engine to start.
5. Fully extract the project ZIP into a normal folder, close old command windows, and double-click **`start.cmd`**. Do not run it inside a ZIP preview. It checks prerequisites and opens the local browser console.
6. Select **Prepare image**, then download a published image or build from source. Unpublished development versions require a source build. Once ready, select **Start device**. If pairing is requested, verify the code and approve it yourself on the official page.

If Docker is still missing, run `docker --version`, `docker compose version`, and `docker info` in a new PowerShell window. If the first fails, check installation and PATH. If only the third fails, check the Docker Desktop engine. Do not change project configuration or install a separate Linux system to resolve these symptoms.

The complete Windows workflow has not yet been verified on a real Windows host. A successful image build or running container does not establish cloud connectivity.

## Installation with a local agent

You can give the repository URL to Codex or another agent with local terminal access. It must be able to access the repository and operate on the intended computer. A browsing-only AI cannot install software; a cloud-hosted agent cannot install Docker on your computer through its own terminal.

Copy this request and append the repository URL:

> Help me install and try Desktop Commander Sandbox on this computer. First read README, AGENTS.md, and docs/USAGE.md, then check the OS, CPU architecture, Node.js, and Docker. Prefer a published release; if unpublished, build from source with locked dependencies. Do not change source or versions to bypass failures. Use official sources for missing system dependencies, explain required installation or system changes, and act within my authorization. Hand off license agreements, administrator confirmations, reboots, and first-time device pairing to me. On Windows, use Docker Desktop with WSL 2 / Linux containers; do not require a separate Ubuntu installation. The console does not need npm install. Use default sample folders; I authorize starting a dedicated trial device and connecting it to the Desktop Commander cloud service. I must personally verify and approve its first device code on the official page. I will select any other real folders. Preserve existing configuration, volumes, and credentials, and keep isolation enabled. Report actual results separately for prerequisites, image preparation, local startup, cloud status, and sample file reads/writes. Mark anything untested as unverified.

Agent execution order:

1. Read repository rules, inspect existing installations and user authorization, and reuse compatible dependencies. Record installed versions; never replace project locks with `@latest`.
2. Obtain and fully extract/check out the release or source. Run `npm run remote-device:doctor` from the host project directory; fix the first blocker and retry. Do not install this project inside an Agent-writable sandbox mount.
3. For published releases, use `npm run remote-device:pull`; for unpublished development versions, use `npm run remote-device:build`. Report download failures instead of silently changing versions. Building locally is also an option when authorized.
4. Open the launcher or run `npm run remote-device:dashboard`. Starting a device and connecting to cloud services requires explicit user authorization; do not ask again if the original request already includes it. First pairing still requires the user's own verification and approval.
5. Verify only dedicated sample files. Report local operation separately from cloud connectivity. Never upload real logs, authorization codes, or credentials to issues or public reports.

## Start the console

From the project root:

```sh
npm run remote-device:doctor      # read-only check of Node.js, Docker, Compose and project files
npm run remote-device:dashboard   # prints a local URL and opens it in your browser
```

The URL works only on this machine and expires when the console process exits. Start the console from a terminal in your desktop session: the native folder picker cannot open from SSH, background services or restricted automation shells. If the picker fails, restart the console from a desktop terminal and use the new URL.

The UI follows your browser language (Chinese or English); use the header button to switch.

**First start**

1. Select **Prepare image**, then choose either **Download image** or **Build from source**. Development versions only support source builds. Once ready, the main action becomes **Start device**. Existing images can be started directly.
2. Select **Start device**.
3. If pairing is needed, open **View logs** → **Open authorization page**. Check the device code on the official page and approve it yourself, then return and select **I have authorized the device — return to console**.

The console never approves a device for you. "Running" means only that the local container is running; the console cannot see whether the device is authorized or online. Confirm that in ChatGPT, Claude, or on the Desktop Commander device page. With a valid saved device state, later starts usually reconnect without approval.

**Stop device** stops the container and disconnects the remote tools. It keeps the device state, the tool home volume, and the cloud authorization, so the next start reconnects. Stopping does not revoke the authorization on the service side.

The dashboard shows CPU, memory, network and block I/O, and process count from `docker stats`. **More details** also measures the two persistent volumes. No CPU or memory limit and no Docker health check are configured.

## Upgrading and revoking authorization

Finish active tasks, stop the device, and close the old console. Update the original project directory to the selected release, keeping the same Compose project name and workspace configuration. Open **Image options** and select **Download image** in the updated console, or run `npm run remote-device:build`, then run `npm run remote-device:start`.

Starting the new image recreates the container. Host-mounted files, the device-state volume, and the `/home/tool` volume persist. Running commands are interrupted and `/tmp` is cleared. A valid, compatible saved session usually reconnects automatically. For first pairing or invalid authorization, verify the device code and approve it on the official page. Run the README example after upgrading and check its host output.

Stopping the device keeps cloud authorization. Revoke the corresponding device on the [official device dashboard](https://mcp.desktopcommander.app/) to withdraw access. Deleting local volumes clears device state and the tool home, so keep those volumes during upgrades.

## Workspaces and mounts

On a fresh setup, `default` mounts `sandbox-workspace/default/work/` read/write at `/workspace` and its sibling `reference/` read-only at `/mnt/remote-device/reference`. Building or starting prepares any missing demo folders and `reference/input.txt`. Existing sample files and saved profiles are preserved.

A **workspace** is a saved folder profile: one main folder mounted at `/workspace`, up to 8 extra folders under `/mnt/remote-device/<folder-name>`, and a read-only or read/write setting for each.

- **Create:** in **New workspace**, add folders with the system picker one at a time. The first becomes the main folder. Set each to read-only or read/write, then save. If you pick no folder, a default subfolder is created under `sandbox-workspace/`.
- **Edit:** select a workspace → **Edit**. Change the name, the main folder, the extra folders and the permissions, then review the full list and confirm. Editing the active workspace applies everything at once, with at most one restart, and only if an effective setting changed.
- **Switch:** saving never switches the active workspace. Select a profile and confirm the switch separately. All workspaces share one device state, so switching keeps you signed in.
- **Delete:** removes only the saved profile; folder contents stay. The `default` workspace cannot be deleted. Deleting the active workspace restores the saved `default` profile, or uses the built-in demo mounts if there is no saved profile.

Names are 1–28 lowercase letters, digits, `_` or `-`, starting with a letter or digit. Uppercase letters are converted to lowercase.

**Choose folders carefully.** Each selected folder and everything inside it is visible to the AI. Never select your home folder, a drive root, credential directories (`~/.ssh`, `~/.aws`, …), browser profiles, or a parent folder that holds private data. Folders containing this project's source or its mount settings cannot be mounted read/write. Read-only folders can still be read, so do not put secrets in them.

The browser never submits host paths. The picker returns a short-lived ID, and the local process resolves the path and writes a fixed Compose override. Full host paths are shown only in the authenticated workspace views, so you can verify the mapping. Profiles are saved in your user configuration directory and persist after the console closes.

**Linux:** the tool process accesses bind mounts with your primary group GID. Selected folders must be owned by that group and grant group read/traverse access, plus write access for read/write mounts. The console refuses to apply a mount that does not meet this and never changes permissions on folders you pick. Other local users in the same group may also be able to access these folders.

On Linux, only newly created dedicated workspace roots receive group permissions automatically. Existing folders and their contents are never recursively chmodded; prepare required group access yourself before applying a mount. Writable mounts cannot include the application configuration or log directory, even through symlink aliases.

## Run logs

Select **View logs** to see the current run or an earlier one. Each device start writes one file:

- macOS: `~/Library/Logs/Desktop Commander Sandbox/`
- Windows: `%LOCALAPPDATA%/Desktop Commander Sandbox/logs/`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/desktop-commander-sandbox/logs/`

The 7 most recent runs are kept, each capped at 10 MB. Only files matching the run-log name pattern are ever deleted. On macOS and Linux, the directory is readable only by you.

**Logs are not redacted.** They keep the complete container output: authorization links and codes, tool arguments and results, file contents, and any paths or secrets a command printed. Never share real logs publicly. Delete them manually if you want them gone sooner.

Upstream banners in the log may suggest `npx …@latest` commands. Those run on the host and are not part of this sandbox; use this project's console or CLI instead.

## CLI

Everything in the console is also available from a fixed CLI. Run `node scripts/console.mjs --help` for the full reference.

```sh
npm run remote-device:status
npm run remote-device:build
npm run remote-device:start      # prints the folder mapping and asks for confirmation
npm run remote-device:stop       # run from another terminal
```

`start` accepts `--main <absolute-path>` for `/workspace`, `--read-only` / `--read-write` for the main folder (read-only by default), and repeated `--mount-ro` / `--mount-rw <absolute-path>` for up to 8 extra folders. `--yes` skips the confirmation and `--no-open` keeps the browser closed.

The `start` process owns both the device output and the web console. Closing the browser changes nothing; `Ctrl+C` stops the controller and the device. A second `start` for the same project is rejected; use `dashboard` to open the running console.

**Workspaces and mounts**

```sh
npm run remote-device:workspace -- list
npm run remote-device:workspace -- create demo --main "/absolute/path/to/trial" --mount-ro "/absolute/path/to/reference"
npm run remote-device:workspace -- edit demo --read-write --mount-rw "/absolute/path/to/output"
npm run remote-device:workspace -- switch demo
npm run remote-device:workspace -- delete demo

npm run remote-device:mount -- list                     # shortcuts for the active workspace
npm run remote-device:mount -- add "/absolute/path" --read-only
npm run remote-device:mount -- mode mount-012345abcdef rw
npm run remote-device:mount -- remove mount-012345abcdef
```

`workspace edit` can combine `--label`, `--main`, `--read-only` / `--read-write`, `--mount-ro` / `--mount-rw`, `--remove-mount <id>` and `--mount-mode <id>:ro|rw` into one confirmed change, with at most one restart. Every change prints the full mapping and asks for `y`. While a web console is running, the CLI can read profiles but rejects changes and builds; make them in the web console instead. On Windows, use drive-qualified absolute paths.

Add `--workspace <name>` to `dashboard`, `status` or `stop` to target a saved profile without changing the active one.

**Read-only information**

```sh
npm run remote-device:resources
npm run remote-device:storage
npm run remote-device:logs -- list
npm run remote-device:logs -- show 0123456789abcdef   # raw, unredacted output
```

**Separate device instances.** `--project <name>` selects an entirely separate device state and tool home volume, for example `npm run remote-device:status -- --project demo`. You do not need it for everyday workspace switching. The default project is `desktop-commander-sandbox-local`. When the console runs with `--project` or `REMOTE_DEVICE_PROJECT`, web workspace switching is disabled.

To erase the local device session and tool home, stop the device, then remove that project's volumes with `docker compose -p <project> down --volumes`. This does not revoke the service-side authorization.

## Network and proxies

The container uses Docker's default bridge network, not the host network. It has normal outbound internet access: destinations are **not filtered**.

Containers do not inherit the host's system proxy. If you need one, open **Network settings** in the console and choose **direct**, **system** (read from macOS network settings, Windows Internet Settings, or Linux environment and GNOME settings) or **manual**, then save. The setting applies to the next build or start, not to a running container.

- A proxy on the host's loopback address is rewritten to `host.docker.internal`. The proxy must accept connections from the Docker network, and the host firewall must allow them.
- PAC/WPAD and SOCKS are not supported; enter an HTTP(S) proxy URL manually instead.
- Alternatively, copy `.env.example` to `.env` and set `REMOTE_DEVICE_HTTP_PROXY` / `REMOTE_DEVICE_HTTPS_PROXY`.
- CLI: `--proxy project|direct|system|manual` on `build` or `start`. `manual` reads the URL without echo; never put a URL containing credentials on the command line.

Proxy variables are visible in the container configuration to anyone with Docker access on this machine. Remove or recreate the container to clear them. The proxy covers HTTP(S), `fetch()` and WebSocket traffic from Node.js; it is not a full-traffic proxy or an allowlist.

## Container paths

| Container path | Access for the AI's tools | Lifetime |
|---|---|---|
| `/workspace` | Read-only or read/write, as you chose | Your main folder |
| `/mnt/remote-device/<folder-name>` | Read-only or read/write per folder; read-only is enforced by Docker | Your extra folders; duplicate names get a stable ID suffix |
| `/home/tool` | Read/write | Named volume; keeps configuration, runtime copies and caches across restarts |
| `/tmp` | Read/write, 256 MB, `noexec` | Cleared when the container stops |
| `/var/lib/remote-device` | Device service only | Named volume holding the device session |
| Root filesystem | Read-only | Image layer; system files are still readable |

Writes to mounted folders are also limited by host file permissions. These limits describe the current pinned image. They do not protect against runtime vulnerabilities or container escape. `allowedDirectories` is not a boundary for terminal commands. See the [security model](SECURITY_MODEL.md).

## Common issues

| Situation | What to do |
|---|---|
| macOS reports missing Node.js | Enter `y` in the launcher to open the official download page. Install Node.js 22.12.0+ using its macOS installer, close the old terminal window, and double-click `start.command` again. |
| Launcher cannot find Docker | Follow the platform-specific official installation link shown by the launcher. On Windows, use Docker Desktop with WSL 2 / Linux containers. Start Docker Desktop, close the old window, and relaunch. If already installed, check `docker --version` and PATH in a new terminal. Dependent checks are skipped; this does not indicate broken project configuration. |
| Docker daemon unavailable | Start Docker Desktop, OrbStack or Docker Engine, check that `docker info` works, and try again. |
| Image not built | Select **Prepare image**, then download or build. Development versions require a source build. |
| Folder picker does not open | Restart the console from a terminal in your desktop session, not over SSH. |
| Linux: mount refused | Give the folder to your primary group and grant group read/traverse (or write) access, or choose another folder. |
| Device does not come online | Check **View logs**, `npm run remote-device:status`, and the device list in ChatGPT or Claude. If your network needs a proxy, see [Network and proxies](#network-and-proxies). |
| The page says status is unconfirmed | Check the terminal running the console. Do not stop the container just because the page lost contact. |

Image downloads use the Docker daemon network and proxy settings. Console HTTP(S) proxy settings apply to builds and device operation. On download failure, check the logs, GHCR connectivity, package visibility, and release availability, then retry or build from source. The CLI download command is `npm run remote-device:pull`.
