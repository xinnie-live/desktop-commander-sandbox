# AI Workflow Guide

[English](AI_WORKFLOW.md) | [简体中文](AI_WORKFLOW.zh-CN.md)

How to let a web AI (ChatGPT, Claude) analyze files, edit code, install dependencies and run tests inside the sandbox. For setup and pairing, see the [user guide](USAGE.md).

## Know which environment you are in

| Environment | Responsible for | Common confusion |
|---|---|---|
| Host (macOS / Windows / Linux) | Docker, the local console, your original files | Tools and dependencies installed on the host do not exist in the container. |
| Container (Linux) | The AI's terminal, scripts and tests | `/workspace` is a mapped path; `127.0.0.1` inside the container is the container itself. |
| Web client and Remote service | The model and its tool calls | A running container does not prove the cloud connection or your app is healthy. |

Have the AI check the directory, OS, CPU architecture and available tools first. The image is based on Node.js 22; do not assume Python, uv, Git, ripgrep, compilers or browsers are present.

## Choose where to run

**Recommended: a runtime copy in the tool volume**

```text
/workspace/                        # your source, can be read-only
/home/tool/runs/sample-project/    # Linux runtime copy
  src/  .venv/  node_modules/  output/
```

Copy only the source files and manifests the task needs. Skip host `.venv`, `node_modules`, databases, credentials and caches, and prefer an explicit file list over copying everything. Changes in the copy do not reach your source automatically: review the diff, then copy approved changes back to a writable mount.

`/home/tool` is a persistent named volume. It survives stops, recreation and workspace switches. Use one subdirectory per project, and never delete the whole volume to clean up.

**Alternative: a dedicated folder inside a writable mount**

```text
/workspace/
  src/
  .container-runtime/   # Linux-only: runtime copy, .venv, node_modules, output
```

Use this when you want results visible on the host. **Every write here lands on the host.** This is organization, not a security boundary. Add `.container-runtime/` to that project's own `.gitignore`. Run installers inside the copy, not at the `/workspace` root, so Linux `node_modules` never mixes with the host's.

## Installing dependencies

- Do not reuse host virtual environments, native Node modules or binaries. Recreate them from manifests and lockfiles.
- The root filesystem is read-only and the tool user is not root, so `apt install` and writes to `/usr/local` are not supported. Install user-level tools under `/home/tool` or a writable dedicated folder. If you need system libraries, change the image deliberately instead of escalating privileges.
- With a `package-lock.json`, prefer `npm ci`. Review lifecycle scripts first; `--ignore-scripts` is a safe first pass but may leave some packages unusable.
- For Python, create a fresh `python3 -m venv .venv` in the runtime folder and install locked dependencies. If Python is missing, report it rather than downloading "latest".
- Never use `sudo`, loosen host permissions, disable certificate checks or expose the Docker socket to make an install work.
- `/tmp` is 256 MB and `noexec`; do not use it for dependencies.

## A trial without downloads

Pick an empty, writable trial folder in the console. Then have the AI run this **in the container terminal**, after confirming the directories do not exist yet:

```sh
mkdir /workspace/container-demo
printf 'alpha\nbeta\n' > /workspace/container-demo/input.txt
mkdir -p /home/tool/runs/container-demo
cp /workspace/container-demo/input.txt /home/tool/runs/container-demo/
cd /home/tool/runs/container-demo
node -e "const fs=require('node:fs'); const assert=require('node:assert/strict'); const lines=fs.readFileSync('input.txt','utf8').trim().split(/\r?\n/); assert.equal(lines.length,2); fs.writeFileSync('report.json', JSON.stringify({lines:lines.length})+'\n'); console.log('PASS: 2 lines');"
cp report.json /workspace/container-demo/report.json
```

Expect `PASS: 2 lines`, and `{"lines":2}` in `container-demo/report.json` on the host. This checks reading, isolated processing and write-back. It does not prove pairing stability, network access or your app's health.

## A reusable task brief

Paste this at the start of a session:

> You are using Remote Device inside a Linux container. First confirm the directory, architecture, tool versions, and mount permissions. Source is at `/workspace`; use `/home/tool/runs/<project-name>` for a runtime copy. Do not reuse host `.venv`, `node_modules`, or database directories. Copy only explicitly needed source files and dependency manifests, not credentials. Before installation, identify missing tools, fixed versions, installation paths, and network access, then act within this task's authorization. Write back only approved source changes or outputs and report changes and tests actually run. Do not modify Sandbox control source, Docker settings, host permissions, or stop Remote Device. When starting an application, record its command, working directory, ports, configuration mode, and process identifier without printing secrets. Verify process health, HTTP, dependencies, and target behavior separately; state what remains unverified.

The brief supplements the real mount permissions and container limits; it does not replace them.

## Network, certificates and previews

- **A certificate error is not a dead network.** `CERTIFICATE_VERIFY_FAILED` can come from the server chain, the runtime trust store or an enterprise proxy CA. Configure trusted CAs explicitly for the process that needs them. Never use `verify=False`, `curl -k` or disable TLS to pass a check.
- **Container localhost is not host localhost.** To reach an authorized host service, use `host.docker.internal`. The service's bind address, the firewall and authentication still apply.
- **No preview ports are published.** An app listening inside the container is not reachable from your host browser by default. Do not let the AI edit Compose, publish ports or disable the firewall without your approval.
- **Plain HTTP limits browser features.** For example, the Clipboard API needs a secure context. Apps should fall back gracefully.

## Verify layer by layer

| Layer | Verify | Does not prove |
|---|---|---|
| Local console | Local URL works, status is fresh | Cloud connection |
| Container | Docker reports running | App, model or data service health |
| App process | Right directory, command, config and port | Business behavior |
| HTTP / dependencies | Real responses and authorized connections | A 200 on the home page is not full success |
| Target task | Required result from synthetic input | One passing case is not full coverage |

When reporting a problem, include error categories, exit codes and a synthetic reproduction. Real run logs can contain tool arguments, file contents and secrets; never attach them to public issues.
