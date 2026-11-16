# 使用指南

[English](USAGE.md) | [简体中文](USAGE.zh-CN.md)

跳转到：[环境要求](#环境要求) · [启动控制台](#启动控制台) · [工作区与挂载](#工作区与挂载) · [运行日志](#运行日志) · [CLI](#cli) · [代理](#网络与代理) · [容器路径](#容器路径) · [常见问题](#常见问题)

想让容器里的 AI 干活更顺（运行副本、依赖安装、证书、预览），请看 [AI 工作流指南](AI_WORKFLOW.zh-CN.md)。

## 环境要求

需要 **Node.js 22.12.0 或更高版本**，以及能运行 Linux 容器的 Docker：Docker Desktop、OrbStack，或 Docker Engine 加 **Compose 插件 2.24.1+**。

宿主机需要 Node.js 来运行本地 CLI 和 Web 控制台。CI 覆盖 Node.js 22.21.0 和 24；容器独立使用固定的 Node.js 22.21.0 镜像，不需要手动在容器内安装 Node.js。


| 系统 | 准备 | 官方说明 |
|---|---|---|
| macOS | Node.js 22.12.0+，加 Docker Desktop 或 OrbStack | [Node.js](https://nodejs.org/en/download) · [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) |
| Windows | Node.js 22.12.0+，加使用 WSL 2 / Linux containers 后端的 Docker Desktop | [Node.js](https://nodejs.org/en/download) · [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) · [WSL](https://docs.docker.com/desktop/features/wsl/) |
| Linux | Node.js 22.12.0+、Docker Engine 和 Compose 插件；以有 Docker 权限的普通用户运行 | [Node.js](https://nodejs.org/en/download) · [Docker Engine](https://docs.docker.com/engine/install/) · [Compose 插件](https://docs.docker.com/compose/install/linux/) |

控制台没有 npm 依赖，不需要 `npm install`。Desktop Commander 及其锁定依赖会在首次构建镜像时装进 Docker 镜像。本项目不会替你安装软件、修改用户组或系统设置。Linux 上把用户加入 `docker` 组等同于给了 root 级的 Docker 控制权，只对可信用户这样做。

平台支持与已验证的 Docker 环境见 [README](../README.zh-CN.md#平台支持)。

### Linux 目录选择器与无图形环境

原生目录选择器需要可用的图形桌面会话，并在宿主 PATH 中提供 `zenity` 或 `kdialog`。需要在浏览器选择文件夹时，可通过发行版的软件包管理器安装其中一个。无图形桌面的主机可改用固定 CLI：

```sh
node scripts/console.mjs workspace create trial --main "/absolute/path/to/trial" --read-only
node scripts/console.mjs workspace list
```

请把示例替换为已有的专用文件夹，并满足下文的 Linux 主组权限要求。创建已保存档案不会启动设备或进行配对；准备好后再单独执行 CLI 的工作区切换和启动命令。本机控制台只监听宿主的 `127.0.0.1`，不要将其开放为远程端点。本次 Linux 复测未验证原生选择器及完整 UI 到容器流程。


## Windows 第一次安装

**你仍然在 Windows 上使用本项目，不需要自己安装一套 Linux、Ubuntu 或 Linux 桌面，也不需要进入 Linux 终端。** 本机启动器和浏览器控制台运行在 Windows；Docker Desktop 在后台提供沙箱需要的 Linux 容器环境。

1. 从 [Node.js 官网](https://nodejs.org/en/download)安装 Node.js 22.12.0 或更高版本。
2. 打开 [Docker Desktop for Windows 官方安装页](https://docs.docker.com/desktop/setup/install/windows-install/)，先核对系统要求，再选择匹配电脑处理器的安装包。普通 Intel / AMD 电脑选择 x86_64；Windows ARM 电脑按官方说明选择 Arm 版本。
3. 按安装向导选择 **WSL 2**，使用 **Linux 容器**。如提示缺少或需要更新 WSL 2，按[官方 WSL 指引](https://docs.docker.com/desktop/features/wsl/)完成；如提示重启，先重启电脑。WSL 2 是后台运行支持，不要求另外安装 Ubuntu。Docker 也有其他后端，本指南只介绍 WSL 2 路线。
4. 从开始菜单打开 **Docker Desktop**，由你确认首次使用条款，等待引擎启动完成。
5. 将项目 ZIP 完整解压到普通文件夹，关闭旧的命令窗口，再双击 **`start.cmd`**。不要在 ZIP 预览窗口内直接运行。启动器会检查环境并打开本机浏览器控制台。
6. 在控制台点 **准备镜像**，下载已发布镜像或从源码构建，二选一。未发布的开发版选择源码构建。镜像准备完成后点 **启动设备**；需要配对时，在官方页面核对设备码并亲自批准。

如果启动器仍找不到 Docker，在新开的 PowerShell 中依次运行 `docker --version`、`docker compose version`、`docker info`。第一条失败先检查安装或 PATH；只有第三条失败则先查看 Docker Desktop 的引擎状态。不必因此修改项目配置或额外安装 Linux。

Windows 完整流程尚未完成实机验收；镜像构建成功或本机容器运行，不等于云端连接已经验证。

## 让本机 Agent 协助安装

可以把仓库地址交给 Codex 或其他有本机终端权限的 Agent。它必须能访问仓库，并且实际操作的是你打算安装的电脑；只有网页阅读能力的 AI 无法直接安装，本身运行在云端的 Agent 也不能替你的电脑安装 Docker。

可复制下面的任务说明，并把仓库地址附在后面：

> 请帮我在这台电脑安装并试用 Desktop Commander Sandbox。先读取仓库 README、AGENTS.md 和 docs/USAGE.zh-CN.md，检查当前系统、CPU 架构、Node.js 和 Docker 环境。优先使用已发布版本；未发布时按锁定依赖从源码构建，不要擅自修改源码或版本来绕过失败。缺少系统依赖时使用官方来源，说明需要的安装或系统变更，按我的授权执行；遇到许可协议、管理员确认、系统重启或首次设备配对时交给我操作。Windows 按 Docker Desktop + WSL 2 / Linux 容器路线准备，不要求另装 Ubuntu。控制台不需要 npm install。使用默认示例文件夹试用；我授权启动专用试用设备并连接 Desktop Commander 云服务，首次设备码必须由我在官方页面核对并批准。其他真实文件夹由我选择。不要删除已有配置、状态卷或凭据，不要关闭隔离措施。完成后分别报告环境检查、镜像准备、本机启动、云端在线及示例文件读写的实际结果；没有验证的项目明确标为未验证。

给安装 Agent 的执行顺序：

1. 阅读仓库规则，检查现有安装和用户授权，复用符合要求的依赖。安装需要的具体版本应记录下来；不要用 `@latest` 替代项目锁定版本。
2. 获取发行版或源码并完整解压/检出。在宿主机项目目录运行 `npm run remote-device:doctor`；失败时先解决首个阻塞，再重试。不要把本项目装在 Agent 可写的沙箱挂载里。
3. 正式版本可运行 `npm run remote-device:pull`；未发布开发版使用 `npm run remote-device:build`。下载失败要报告真实原因，不要默默切换版本。若用户允许，也可选择本机源码构建。
4. 用启动器或 `npm run remote-device:dashboard` 打开本机控制台。启动设备和连接云服务需要用户明确授权；若原始请求已经明确包含，不必重复索要。首次配对仍必须由用户亲自核对并批准。
5. 只用专用示例文件核验读写；将本机运行与云端连接分开报告。安装过程遇到的真实日志、授权码和凭据不要上传到 issue 或写入公开报告。

## 启动控制台

在项目根目录运行：

```sh
npm run remote-device:doctor      # 只读检查 Node.js、Docker、Compose 和项目文件
npm run remote-device:dashboard   # 打印本机链接并在浏览器中打开
```

链接只在本机有效，控制台进程退出后失效。请从桌面会话里的终端启动：SSH、后台服务或受限的自动化 shell 打不开系统文件夹选择器。选择器失败时，从桌面终端重新启动控制台并使用新链接。

界面跟随浏览器语言（中文或英文），可用顶部按钮切换。

**首次启动**

1. 点“准备镜像”，在弹窗内选择“下载镜像”或“从源码构建”，二选一。当前开发版仅提供源码构建。准备完成后，首页显示“启动设备”；已有镜像时可直接启动。
2. 点“启动设备”。
3. 需要配对时，打开“查看日志”→“打开授权页面”，在官方页面核对设备码并自行批准，再回到控制台点“我已完成授权，返回控制台”。

控制台永远不会替你批准设备。“运行中”只表示本机容器在运行，控制台看不到设备是否已授权或在线，请到 ChatGPT、Claude 或 Desktop Commander 设备页确认。设备状态卷有效时，之后启动通常会自动重连，不用再批准。

“停止设备”会停止容器并断开远程工具，但保留设备状态、工具家目录卷和云端授权，下次启动会重连。停止不会撤销服务端授权。

主页显示 `docker stats` 提供的 CPU、内存、网络和磁盘 I/O、进程数；“更多详情”还会统计两个持久化数据卷的占用。项目没有设置 CPU/内存上限，也没有配置 Docker 健康检查。

## 升级与撤销授权

升级前结束正在执行的任务并停止设备，关闭旧控制台。在原项目目录更新到所选发行版，沿用原 Compose 项目名和工作区配置。在更新后的控制台打开“镜像选项”并点击“下载镜像”，或运行 `npm run remote-device:build`，再运行 `npm run remote-device:start`。

新镜像启动时会重建容器。宿主机挂载文件、设备状态卷和 `/home/tool` 工具卷会保留。运行中的命令会中断，`/tmp` 会清空。有效且兼容的设备状态通常会自动重连；首次配对或授权失效时，由你在官方页面核对设备码并批准。升级后运行 README 中的示例任务，核对宿主机输出。

停止设备保留云端授权。要撤销授权，请在[官方设备页](https://mcp.desktopcommander.app/)撤销对应设备。删除本地数据卷会清除设备状态和工具家目录，升级时请保留这些卷。

## 工作区与挂载

全新配置的 `default` 使用 `sandbox-workspace/default/work/`（读写，映射到 `/workspace`），并挂载同级 `reference/`（只读，映射到 `/mnt/remote-device/reference`）。构建或启动时会创建缺少的示例目录和 `reference/input.txt`。已有的示例文件和工作区档案会保留。

**工作区**是一份保存的文件夹档案：一个挂到 `/workspace` 的主文件夹、最多 8 个挂到 `/mnt/remote-device/<文件夹名>` 的额外文件夹，每个单独设为只读或读写。

- **新建**：在“新建工作区”里用系统选择器逐个添加文件夹，第一个是主文件夹。分别设好只读或读写后保存。不选文件夹时，会在 `sandbox-workspace/` 下建一个默认子文件夹。
- **编辑**：选中工作区 →“编辑”，可以改名称、主文件夹、额外文件夹和权限，核对完整清单后确认。编辑当前工作区会一次性应用全部修改，只有生效设置确实变了才重启，且最多重启一次。
- **切换**：保存不会切换当前工作区，需要选中档案后单独确认切换。所有工作区共用一份设备状态，切换后不用重新登录。
- **删除**：只删保存的档案，文件夹内容不受影响。`default` 工作区不能删除。删除当前工作区会恢复已保存的 `default` 档案；没有档案时使用上述内置示例映射。

名称为 1–28 个小写字母、数字、`_` 或 `-`，并以字母或数字开头；大写字母会自动转成小写。

**谨慎选择文件夹。** 被选文件夹及其中所有内容都会被 AI 看到。不要选主目录、磁盘根目录、凭据目录（`~/.ssh`、`~/.aws` 等）、浏览器资料目录，或装着私人资料的父文件夹。包含本项目源码或挂载设置的文件夹不能以读写方式挂载。只读文件夹仍然可被读取，不要在里面放秘密。

浏览器从不提交本机路径：选择器只返回短时编号，路径由本机进程解析，并生成固定的 Compose 覆盖文件。完整本机路径只在经过验证的工作区视图中显示，方便你核对映射。档案保存在用户配置目录，关闭控制台后仍保留。

**Linux**：工具进程用你的主组 GID 访问挂载目录。所选文件夹必须归该组所有，并给组读取/进入权限，读写挂载还需要写权限。不满足时控制台会拒绝应用，也不会自动修改你所选文件夹的权限。同组的其他本机用户也可能访问这些文件夹。

Linux 上仅新建的专用工作区根目录会自动设置组权限。已有目录及其内容不会被递归修改权限；请在应用挂载前自行准备所需组权限。读写挂载不能包含应用配置或日志目录，即使路径经过符号链接别名也会拒绝。

## 运行日志

点“查看日志”可查看本次或历史运行。每次启动设备写一个文件：

- macOS：`~/Library/Logs/Desktop Commander Sandbox/`
- Windows：`%LOCALAPPDATA%/Desktop Commander Sandbox/logs/`
- Linux：`${XDG_STATE_HOME:-~/.local/state}/desktop-commander-sandbox/logs/`

只保留最近 7 次运行，每个文件上限 10 MB，只会删除名称符合运行日志格式的文件。在 macOS 和 Linux 上，日志目录只有你自己能读。

**日志不做脱敏。** 它完整保留容器输出：授权链接和授权码、工具参数与结果、文件内容，以及命令打印出的路径和秘密。不要公开分享真实日志；想提前清除可以手动删除。

日志里上游的横幅可能提示 `npx …@latest` 之类的命令。这些命令会在宿主机上运行，与本沙箱无关，请使用本项目的控制台或 CLI。

## CLI

控制台里的功能都可以用固定 CLI 完成，完整参数见 `node scripts/console.mjs --help`。

```sh
npm run remote-device:status
npm run remote-device:build
npm run remote-device:start      # 打印文件夹映射并要求确认
npm run remote-device:stop       # 在另一个终端运行
```

`start` 支持用 `--main <绝对路径>` 指定 `/workspace`，用 `--read-only` / `--read-write` 设置主文件夹权限（默认只读），并可重复传入 `--mount-ro` / `--mount-rw <绝对路径>` 添加最多 8 个额外文件夹。`--yes` 跳过确认，`--no-open` 不自动打开浏览器。

`start` 进程同时持有设备输出和网页控制台。关闭浏览器不影响运行；按 `Ctrl+C` 会停止控制进程和设备。同一项目重复 `start` 会被拒绝，用 `dashboard` 打开正在运行的控制台。

**工作区与挂载**

```sh
npm run remote-device:workspace -- list
npm run remote-device:workspace -- create demo --main "/absolute/path/to/trial" --mount-ro "/absolute/path/to/reference"
npm run remote-device:workspace -- edit demo --read-write --mount-rw "/absolute/path/to/output"
npm run remote-device:workspace -- switch demo
npm run remote-device:workspace -- delete demo

npm run remote-device:mount -- list                     # 当前工作区的简写命令
npm run remote-device:mount -- add "/absolute/path" --read-only
npm run remote-device:mount -- mode mount-012345abcdef rw
npm run remote-device:mount -- remove mount-012345abcdef
```

`workspace edit` 可以把 `--label`、`--main`、`--read-only` / `--read-write`、`--mount-ro` / `--mount-rw`、`--remove-mount <编号>` 和 `--mount-mode <编号>:ro|rw` 合并成一次确认的修改，最多重启一次。每次修改都会先打印完整映射，输入 `y` 后才执行。网页控制台运行期间，CLI 可以读取档案，但会拒绝修改和构建，请在网页里操作。Windows 上请使用带盘符的绝对路径。

给 `dashboard`、`status` 或 `stop` 加上 `--workspace <名称>`，可以针对某个已保存的档案操作，不改变当前工作区。

**只读查询**

```sh
npm run remote-device:resources
npm run remote-device:storage
npm run remote-device:logs -- list
npm run remote-device:logs -- show 0123456789abcdef   # 原样输出，未脱敏
```

**独立设备实例**：`--project <名称>` 会选择另一套完全独立的设备状态和工具家目录卷，例如 `npm run remote-device:status -- --project demo`。日常切换工作区不需要它。默认项目名是 `desktop-commander-sandbox-local`。控制台以 `--project` 或 `REMOTE_DEVICE_PROJECT` 启动时，网页上的工作区切换会被禁用。

要清除本机设备会话和工具家目录，先停止设备，再运行 `docker compose -p <项目名> down --volumes` 删除该项目的数据卷。这不会撤销服务端授权。

## 网络与代理

容器使用 Docker 默认的 bridge 网络，不共享宿主机网络。它有正常的外网出站能力，**不过滤访问目标**。

容器不会继承宿主机的系统代理。需要代理时，在控制台“网络设置”里选择“直连”“系统”（读取 macOS 网络设置、Windows Internet 设置，或 Linux 环境变量与 GNOME 设置）或“手动”，然后保存。设置在下次构建或启动时生效，不影响正在运行的容器。

- 指向宿主机回环地址的代理会被改写为 `host.docker.internal`。代理必须允许来自 Docker 网络的连接，宿主防火墙也要放行。
- 不支持 PAC/WPAD 和 SOCKS，请手动填写一个 HTTP(S) 代理地址。
- 也可以把 `.env.example` 复制为 `.env`，设置 `REMOTE_DEVICE_HTTP_PROXY` / `REMOTE_DEVICE_HTTPS_PROXY`。
- CLI：在 `build` 或 `start` 上加 `--proxy project|direct|system|manual`。`manual` 会隐藏输入；不要把带凭据的代理地址写在命令行里。

本机任何有 Docker 权限的人都能在容器配置里看到代理变量，删除或重建容器才能清掉。代理覆盖 Node.js 的 HTTP(S)、`fetch()` 和 WebSocket 流量，不是全流量代理，也不是白名单。

## 容器路径

| 容器路径 | AI 工具的权限 | 生命周期 |
|---|---|---|
| `/workspace` | 按你的选择只读或读写 | 你的主文件夹 |
| `/mnt/remote-device/<文件夹名>` | 每个文件夹单独设只读或读写；只读由 Docker 强制 | 你的额外文件夹；重名时追加稳定 ID 后缀 |
| `/home/tool` | 读写 | 命名卷；重启后保留配置、运行副本和缓存 |
| `/tmp` | 读写，256 MB，`noexec` | 容器停止后清空 |
| `/var/lib/remote-device` | 仅设备服务使用 | 保存设备会话的命名卷 |
| 根文件系统 | 只读 | 镜像层；系统文件仍可读 |

写入挂载目录还受宿主机文件权限限制。这些限制只描述当前固定版本的镜像，不能防御运行时漏洞或容器逃逸。`allowedDirectories` 不是终端命令的权限边界。详见[安全模型](SECURITY_MODEL.zh-CN.md)。

## 常见问题

| 情况 | 处理 |
|---|---|
| macOS 提示缺少 Node.js | 在启动器输入 `y` 打开官方下载页，安装 Node.js 22.12.0+ 的 macOS 安装包，关闭旧终端窗口后重新双击 `start.command`。 |
| 启动器找不到 Docker | 按启动器显示的当前系统官方链接安装 Docker。Windows 选择 Docker Desktop + WSL 2 / Linux 容器；安装后启动 Docker Desktop，关闭旧窗口并重新双击启动器。已经安装时，在新终端检查 `docker --version` 和 PATH。后续检查会跳过，不表示项目配置损坏。 |
| Docker daemon 不可用 | 启动 Docker Desktop、OrbStack 或 Docker Engine，确认 `docker info` 能运行后重试。 |
| 镜像未构建 | 点“准备镜像”，选择下载或源码构建；开发版只能从源码构建。 |
| 文件夹选择器打不开 | 从桌面会话的终端重新启动控制台，不要通过 SSH。 |
| Linux：挂载被拒绝 | 把文件夹交给你的主组，并给组读取/进入（或写入）权限，或换一个文件夹。 |
| 设备一直不上线 | 查看“查看日志”、`npm run remote-device:status`，以及 ChatGPT 或 Claude 里的设备列表。网络需要代理时见[网络与代理](#网络与代理)。 |
| 页面显示状态待确认 | 检查运行控制台的终端；不要因为页面失联就停止容器。 |

镜像下载使用 Docker daemon 的网络和代理设置，控制台的 HTTP(S) 代理选项用于构建和设备运行。下载失败可查看日志，检查 GHCR 连通性、镜像是否已公开和对应版本是否已发布，再重试或选择源码构建。CLI 下载命令为 `npm run remote-device:pull`。
