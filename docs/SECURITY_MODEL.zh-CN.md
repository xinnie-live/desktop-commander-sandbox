# 安全模型

[English](SECURITY_MODEL.md) | [简体中文](SECURITY_MODEL.zh-CN.md)

## 当前架构

产品只有一个 `remote-device` Compose 服务，使用 Docker Compose 默认 bridge 网络，目标运行于 macOS、Windows 和 Linux 的 Docker Linux containers。该服务不设置 `network_mode: host`，不共享宿主机网络命名空间；容器仍有 Docker 常规外网出站能力。

产品不依赖特定代理软件；容器网络可直连时直接工作。默认不读取宿主 HTTP 代理；用户可以明确选择跟随当前系统 HTTP(S) 设置，也可通过本机控制台临时输入或 `.env` 配置通用代理。显式 HTTP(S) 代理也会用于构建阶段的依赖下载；Docker Engine 拉取基础镜像使用其自身 registry 代理配置。BuildKit 代理参数不会在 Dockerfile 中声明或引用；构建步骤通过 Compose 2.24.1+ 的 `build.extra_hosts` 映射 `host.docker.internal`。Node 的环境代理支持影响相应 HTTP/HTTPS/fetch 客户端，不保证 WebSocket 或全流量代理。回环代理地址会映射到 `host.docker.internal`；该映射不是访问控制策略，宿主代理必须接受来自 Docker 网络的请求。具体可达性受 Docker Engine/Desktop、VPN、防火墙和代理监听地址影响。运行时代理环境变量会存入 Docker 容器配置，本机 Docker 管理员可以查看其中的代理地址和认证信息；停止容器不会清除这些值，容器重建或删除后才会清除。`.env` 配置还会留在项目本地文件中。除 macOS + OrbStack 外的宿主平台目前未实测。PAC/WPAD 与 SOCKS 暂不支持直接跟随。

## 需要保护的资产

- 未明确授权的宿主机文件及只读挂载文件完整性。
- Remote Device 会话凭据和设备身份。
- 每次运行完整保存容器 stdout/stderr 的本机日志；其中可能包含授权信息、凭据、工具参数/结果、文件内容和本机路径。
- 宿主机 Docker 守护进程及其他管理接口。
- 本机工具产生的遥测数据与用户对保护范围的正确认知。

## 信任边界

- AI 客户端及其账号、第三方云端中继/服务。
- Remote Device 与 Local MCP 工具（包含终端命令执行）。
- Linux 容器、Docker Engine 或 Docker Desktop VM 与各平台宿主机网络。
- 本机按需控制台及浏览器会话。控制台进程使用当前操作系统用户的 Docker CLI 权限。

本项目不假定客户端或云端服务绝对可信；这不代表对具体服务存在恶意或已被攻陷的指控。

控制台默认使用固定回环端口 53707。本机任意浏览器可打开地址，通过同源 JSON POST `/api/session` 自动取得每次启动随机生成的令牌。该接口要求准确的 Origin 和自定义请求头，拒绝跨源 Fetch Metadata，且不提供 CORS 预检；不会执行设备或文件操作。浏览器仅在内存保存令牌，后续 API 仍需校验。这是浏览器来源边界，不是本机操作系统用户之间的身份认证：能访问宿主回环地址的进程和其他本机用户属于本设计的信任范围。

## 威胁场景

| 场景 | 当前控制 | 残余风险 |
|---|---|---|
| 本机运行日志泄露或被转发 | 原始输出仅保存在当前用户的应用日志目录；POSIX 目录/文件权限为 `0700`/`0600`；最多 7 份匹配日志、每份最多 10 MB；清理不递归且只处理名称匹配的普通文件 | 日志按设计不脱敏，可能含凭据、授权链接/码、用户数据、工具参数/结果和本机路径。能访问当前用户账号或拿到日志副本的人可以读取；不按日期过期，控制台也不上传日志。 |
| 云端服务或账号被滥用 | 仅挂载用户选定的工作区和额外文件夹，并逐项设置读写权限；容器 rootfs 只读；工具进程 UID 10002；可停止容器 | 已授权可读数据仍可通过合法远程连接传输。Linux 上工具子进程还加入当前主组以访问 bind mount，其他组成员可访问该 sandbox 数据。终端也能读取容器内该 UID 可读的系统文件、工具家目录卷和临时目录。 |
| 提示词注入或远程终端执行有害命令 | 不挂载主目录根路径、真实密钥、浏览器配置、项目源码或 Docker Socket；不使用 privileged 或 host PID；仅向固定 UID helper 提供 `SETUID`/`SETGID`，不添加其他 capabilities；使用默认 bridge | 工具可在容器内读写自身有权限访问的路径，并通过 Docker bridge 连接外部地址；不要把该容器用作运行不可信代码的强隔离环境。 |
| RW workspace 被写入恶意内容 | 使用单独的 `sandbox-workspace/`；宿主机执行前检查内容 | 脚本、Git hooks、包生命周期脚本和 Makefile 可能在用户之后执行时造成影响。 |
| 容器连接本机管理接口 | 不挂载 Docker Socket；未设置 host PID；工具 UID 降权；使用默认 bridge | Compose 显式提供 `host.docker.internal` host-gateway 映射以支持可选代理。容器可能尝试连接该网关上可达的宿主监听服务；具体范围受 Docker Desktop/Engine 防火墙和监听地址影响，尚未穷举。 |
| 网络或代理不可用 | 产品不绑定特定代理软件或端口；可使用直连、用户明确选择的系统 HTTP(S) 代理或通用代理设置 | 容器仍需要通过 Docker 网络访问 Remote Device 服务。项目不提供出站过滤；系统代理仅在用户选择后读取，PAC/WPAD、SOCKS 及不可由容器访问的宿主代理仍需手动处理。 |
| 本机网页误用控制台 | 控制台只监听 `127.0.0.1`，每次启动随机令牌，校验 Host/Origin/custom header，严格 CSP、无 CORS，API 仅有固定 Compose 操作 | 本机控制进程拥有用户的 Docker 权限；这些措施不能隔离同一用户权限下的恶意进程、受控浏览器或宿主机账号。 |
| 用户误选过宽目录或权限 | 任意路径只能来自系统原生文件夹选择器；新挂载默认只读，最多 8 项；每项独立权限；先暂存，再由用户在统一应用前复核全部路径与权限。读写挂载若包含项目源码、本机挂载配置或控制文件会被拒绝 | 挂载会开放所选目录及全部子内容。只读仍可读取其中资料；读写挂载允许容器尝试修改，实际效果受主机文件权限和运行时共享规则影响。产品不能判断目录内哪些文件是私密内容；用户需自行选择范围。 |
| 容器或运行时漏洞 | rootfs 只读、capabilities 默认清空、限定挂载、固定版本、无 Docker Socket | 不保证抵御容器逃逸、Docker Desktop VM/宿主机漏洞或尚未发现的上游漏洞。 |

## 文件与进程边界

- `/workspace`：默认的项目专用宿主目录 bind mount；用户可选择只读或读写。
- `/mnt/remote-device/<folder-name>`：用户经系统原生选择器明确选择的最多 8 个目录；容器路径使用所选文件夹的最后一级名称，同名时追加稳定挂载 ID；每项独立配置只读或读写，挂载清单按 Compose 项目保存在当前用户的应用配置目录。控制台由固定逻辑生成运行时 Compose 覆盖文件；此目录和配置文件不位于 Agent 可写挂载中。
- `/home/tool`：工具家目录（Compose 卷名为 `tool-config`），工具 UID 可写并跨容器重建保留。
- `/tmp`：容器 tmpfs，停止后清空。
- `/var/lib/remote-device`：设备状态命名卷；远程工具 UID 10002 当前无权读写。不要直接检查其中的真实会话状态。
- Remote Device 父进程 UID 10001，Local MCP 工具 UID 10002。Linux 主机运行时会把当前主组 GID 加入容器并授予工具进程，以便跨 UID 写入项目专用 bind mount；该组成员会有相应目录访问权限。容器根文件系统只读，但系统文件仍可能对工具 UID 可读。

上游 `allowedDirectories` 只能约束部分文件类工具，不能充当终端命令的操作系统边界。

## 遥测

镜像安装时禁用 npm lifecycle scripts，运行时设置固定上游版本支持的 `DESKTOP_COMMANDER_DISABLE_TELEMETRY=1`。这不切断 Remote Device 必需的云端连接，也不是完整流量审计；共享网络下终端仍可能连接外部服务。

## 不在保证范围内

- 阻止模型或客户端给出有害建议，或阻止通过合法连接外传可读取数据。
- 配置或强制宿主系统代理路由。
- Windows/Linux/macOS 各种 Docker 运行时、VPN 与防火墙组合的一致行为。
- 防御已被攻陷的操作系统、Docker Desktop VM、Docker daemon 或同用户进程。
- 提供通用企业网络策略、终端命令审查或内容过滤。

## 必须验证与保留的未解决项

验证只适用于明确记录的镜像、Compose、操作系统、容器运行时与测试路径。当前仍需确认各平台宿主管理面可达性、可选代理/WebSocket 行为、断网恢复和不同运行时表现；没有完成的事项不得标成通过，也不得笼统宣称系统整体安全。
