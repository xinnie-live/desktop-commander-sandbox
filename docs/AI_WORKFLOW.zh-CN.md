# AI 工作流指南

[English](AI_WORKFLOW.md) | [简体中文](AI_WORKFLOW.zh-CN.md)

介绍如何让网页端 AI（ChatGPT、Claude）在沙箱里分析文件、改代码、装依赖和跑测试。安装和配对见[使用指南](USAGE.zh-CN.md)。

## 先分清在哪个环境

| 环境 | 负责 | 常见误解 |
|---|---|---|
| 宿主机（macOS / Windows / Linux） | Docker、本地控制台、你的原始文件 | 宿主机上装的工具和依赖，容器里并没有。 |
| 容器（Linux） | AI 的终端、脚本和测试 | `/workspace` 是映射路径；容器里的 `127.0.0.1` 指容器自己。 |
| 网页端与 Remote 服务 | 模型和工具调用 | 容器在运行，不代表云端连接或你的应用正常。 |

让 AI 先确认目录、系统、CPU 架构和可用工具。镜像基于 Node.js 22，不要默认 Python、uv、Git、ripgrep、编译器或浏览器已经存在。

## 选择运行位置

**推荐：在工具卷里放运行副本**

```text
/workspace/                        # 你的源码，可以只读
/home/tool/runs/sample-project/    # Linux 运行副本
  src/  .venv/  node_modules/  output/
```

只复制任务需要的源文件和依赖清单，跳过宿主的 `.venv`、`node_modules`、数据库、凭据和缓存，优先用明确的文件清单而不是整体复制。副本里的修改不会自动回到源码：先看 diff，再把确认过的修改复制回可写挂载。

`/home/tool` 是持久化命名卷，停止、重建和切换工作区后都保留。每个项目用一个子目录，清理时不要删除整个卷。

**备选：在可写挂载里建专用目录**

```text
/workspace/
  src/
  .container-runtime/   # 仅 Linux 使用：运行副本、.venv、node_modules、产物
```

适合希望在宿主机直接看到结果的情况。**这里的每次写入都会落到宿主机。** 这只是整理方式，不是安全边界。把 `.container-runtime/` 加进该项目自己的 `.gitignore`。在副本里运行安装命令，不要在 `/workspace` 根目录运行，避免 Linux 的 `node_modules` 与宿主的混在一起。

## 安装依赖

- 不要复用宿主的虚拟环境、原生 Node 模块或二进制文件，按清单和锁文件重新创建。
- 根文件系统只读，工具用户不是 root，所以不支持 `apt install` 或写 `/usr/local`。用户级工具装到 `/home/tool` 或可写的专用目录。需要系统库时，有意识地修改镜像，而不是提权。
- 有 `package-lock.json` 时优先 `npm ci`。先审查生命周期脚本；`--ignore-scripts` 适合作为安全的第一步，但部分包可能因此不可用。
- Python 项目在运行目录里新建 `python3 -m venv .venv` 并安装锁定的依赖。如果没有 Python，先报告，不要下载“最新版”。
- 不要为了装上依赖而使用 `sudo`、放宽宿主权限、关闭证书校验或暴露 Docker socket。
- `/tmp` 只有 256 MB 且为 `noexec`，不要用来放依赖。

## 无需下载的试用

在控制台里选一个空的、可写的试用文件夹。确认下面的目录还不存在后，让 AI **在容器终端里**运行：

```sh
mkdir /workspace/container-demo
printf 'alpha\nbeta\n' > /workspace/container-demo/input.txt
mkdir -p /home/tool/runs/container-demo
cp /workspace/container-demo/input.txt /home/tool/runs/container-demo/
cd /home/tool/runs/container-demo
node -e "const fs=require('node:fs'); const assert=require('node:assert/strict'); const lines=fs.readFileSync('input.txt','utf8').trim().split(/\r?\n/); assert.equal(lines.length,2); fs.writeFileSync('report.json', JSON.stringify({lines:lines.length})+'\n'); console.log('PASS: 2 lines');"
cp report.json /workspace/container-demo/report.json
```

应看到 `PASS: 2 lines`，宿主机上的 `container-demo/report.json` 内容为 `{"lines":2}`。这验证了读取、隔离处理和回写，不能证明配对稳定、网络可用或你的应用正常。

## 可复用的任务说明

在会话开头粘贴：

> 你通过 Remote Device 在 Linux 容器内执行任务。先确认当前目录、系统架构、工具版本以及挂载权限。源码位于 `/workspace`；运行副本放在 `/home/tool/runs/<本次项目名>`，不要复用宿主 `.venv`、`node_modules` 或数据库目录。只复制明确需要的源文件和依赖清单，不复制凭据。安装前说明缺少的工具、固定版本、安装目标和网络访问；按本次授权执行。只回写我允许修改的源文件或产物，列出修改与实际运行的测试。不要修改 Sandbox 控制源码、Docker 配置、宿主权限或停止 Remote Device。启动应用时记录命令、工作目录、端口、配置模式和进程标识，不打印秘密；分别验证进程、HTTP、依赖连接和目标功能，未验证的部分明确说明。

这段说明是对真实挂载权限和容器限制的补充，不能替代它们。

## 网络、证书与预览

- **证书错误不等于断网。** `CERTIFICATE_VERIFY_FAILED` 可能来自服务端证书链、运行时信任库或企业代理 CA。为需要的进程显式配置可信 CA。不要用 `verify=False`、`curl -k` 或关闭 TLS 来通过检查。
- **容器的 localhost 不是宿主机的 localhost。** 访问已授权的宿主服务请用 `host.docker.internal`，服务的监听地址、防火墙和认证仍然生效。
- **没有发布预览端口。** 容器里监听的应用默认无法从宿主浏览器访问。未经你同意，不要让 AI 修改 Compose、发布端口或关闭防火墙。
- **纯 HTTP 会限制浏览器功能。** 例如 Clipboard API 需要安全上下文，应用应提供降级方案。

## 分层验证

| 层级 | 验证 | 不能证明 |
|---|---|---|
| 本地控制台 | 本机链接可用，状态是最新的 | 云端连接 |
| 容器 | Docker 显示运行中 | 应用、模型或数据服务正常 |
| 应用进程 | 目录、命令、配置和端口正确 | 业务行为 |
| HTTP / 依赖 | 真实响应和已授权的连接 | 首页返回 200 不等于全部成功 |
| 目标任务 | 用合成输入得到要求的结果 | 一个用例通过不等于全覆盖 |

报告问题时附上错误类别、退出码和合成数据的复现步骤。真实运行日志可能包含工具参数、文件内容和秘密，不要附在公开 issue 里。
