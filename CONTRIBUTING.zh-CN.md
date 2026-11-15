# 参与开发

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

修改挂载、Docker、网络或设备生命周期前，请阅读 [开发规则](AGENTS.zh-CN.md)和[安全模型](docs/SECURITY_MODEL.zh-CN.md)。

## 本地开发

使用 Node.js 22 或更高版本。在项目根目录运行：

依赖安装和许可证声明收集固定使用 **npm 10.9.4**（`packageManager` 同步声明）。宿主仍支持 Node 22 和 Node 24。npm 11 可能将锁文件去重为不同的物理安装布局，严格的 notices 收集器不支持该布局。请运行 `npx --yes npm@10.9.4 ci --omit=dev --ignore-scripts --no-audit --no-fund`，再运行 `npm run remote-device:notices`。必需包缺失仍然报错，不允许忽略。CI 固定 npm，并在两个 Node 版本上收集声明。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

离线测试无需 Docker。控制器测试使用合成数据，配置和运行日志必须放在临时目录。测试不会打开原生目录选择器、启动真实 Remote Device、配对或连接其云端服务。

## 代码地图

| 区域 | 入口文件 | 职责 |
|---|---|---|
| 容器镜像 | `Dockerfile`、`docker/drop_uid_exec.c` | 固定并补丁化上游工具包；让 Remote Device 父进程与工具子进程使用配置好的 UID。 |
| 容器策略 | `compose.yaml`、`scripts/mount-compose.mjs`、`scripts/validate-compose.mjs` | 定义单个服务、固定卷和基础挂载，生成固定格式的额外挂载覆盖文件，并拒绝策略漂移。 |
| 本机控制器 | `scripts/console.mjs` | 实现固定 CLI、本机 loopback HTTP 控制台、会话校验、工作区/挂载操作及固定 Docker Compose 调用。 |
| 本机配置与路径 | `scripts/workspace-selection.mjs`、`scripts/workspace-settings.mjs`、`scripts/public-data.mjs` | 校验工作区选择、保存每用户配置；经认证的本机工作区/挂载页可显示完整路径，其他 API 文本会脱敏，浏览器只提交选择器编号。 |
| 日志与网络设置 | `scripts/run-log-security.mjs`、`scripts/system-proxy.mjs` | 为界面提取受支持的官方授权链接，并读取或校验可选 HTTP(S) 代理设置。运行日志在本机完整保存容器 stdout/stderr，最多 7 份、每份 10 MB。控制台不探测或声称云端连接状态。 |
| 浏览器界面 | `web/` | 提供中英文静态控制台资源。经认证的本机工作区/挂载页会显示完整路径；浏览器请求只提交选择器编号，不提交宿主路径。 |
| 回归检查 | `tests/*.test.mjs`、`.github/workflows/ci.yml` | 使用合成目录、伪 Docker 进程和 CI 中的离线容器检查验证行为。 |
| 用户与维护者文档 | `docs/`、根目录 `*.md` | 说明安装、使用、威胁边界和发布要求。 |

## 验证改动

- **代码、界面或文档**：运行 `npm test`，同步修改受影响的中英文说明。
- **Compose、镜像、挂载或生命周期**：检查 `docker compose config --quiet` 和 `node scripts/validate-compose.mjs --self-test`；构建固定镜像后运行 `npm run test:docker-host`。该测试使用独立 Compose 项目和无网络的 shell 容器，检查合成挂载和数据卷保留，只清理自己创建的资源。
- **真实界面**：用合成目录验证创建、切换、修改权限和删除档案。检查取消与确认停机、启停后的本次与历史日志、中英文显示、状态失联提示，以及运行中应用一批改动最多重启一次。检查日志只保留符合规则的 7 份文件、每份最多 10 MB。
- **平台与连接**：使用干净副本，在每种拟声明支持的宿主系统与 Docker 组合上分别验证构建、启停、挂载、数据卷保留和原生目录选择器。真实配对由用户自行核对并批准，云端连接需单独验证；离线测试和 CI 不能替代这些结果。

提交 PR 时说明改动原因、影响、实际运行的检查和未验证的范围。

## 上游升级

Dependabot 每周检查依赖更新。补丁脚本从锁文件读取目标版本，校验安装版本并尝试现有补丁；匹配失败会终止构建。更新 PR 由现有 CI 构建并运行离线检查。补丁或测试失败时检查上游变更，修复后重新验证。发布前使用专用试用目录验证旧镜像到新镜像的数据保留、实际重连和读写权限，记录版本、环境与结果。真实配对由用户手动批准。

## 发布检查

准备新版本：同步修改 `package.json`、`package-lock.json` 的 `version` 和 `compose.yaml` 的 `image:` 标签，在 `CHANGELOG.md` 增加对应小节，然后推送 `vX.Y.Z` tag。`.github/workflows/release.yml` 会在 amd64 与 arm64 runner 上原生构建镜像、发布到 GHCR，并创建附带源码包的草稿 GitHub Release。首次公开 Release 前，在仓库 **Packages** 设置中把 GHCR 包设为公开，并完成下面的下载检查。Release 仍是草稿时，标签和已公开镜像也已可见。

运行 `npm run remote-device:package`。检查源码包能在干净目录运行 `npm test`，且不含本地配置、日志、凭据、挂载数据或 Docker 状态。公开仓库的 CI 需实际运行；在发布说明中记录通过的平台与运行时版本，并保留未验证项。若分发已构建镜像，请核对镜像所含第三方软件的许可证和声明。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要提交公开 issue。

项目代码使用 [MIT 许可证](LICENSE)，第三方依赖保留各自的许可证。

### 依赖与分发材料

发布前对锁文件运行 `npm audit --omit=dev --ignore-scripts --registry=https://registry.npmjs.org`；
发布工作流遇到漏洞告警会失败。跨主版本覆盖应限制在受影响的消费者，避免破坏其他库。
修改后构建镜像，运行 `sh scripts/smoke-dependencies.sh` 及已有运行检查。
依赖检查在禁用外网的容器里使用合成 RSA 密钥、glob 文件和回环 HTTP，
不进行真实注册或云端连接。

[第三方声明](THIRD-PARTY-NOTICES.md)说明镜像附带的材料。构建时生成实际 npm
清单、保留原始声明；缺少许可证声明、安装版本偏离锁文件或 `buffers` 实现偏离
已核实的许可来源时会失败。升级 sharp/libvips 时，同时更新上游许可表、源码许可文本
合集和 `third-party/sources.lock.json`；按上游构建脚本和 librsvg Cargo.lock
核对新增源码及补丁，记录固定 URL 和已验证哈希，不使用可变分支地址。
运行 `npm run remote-device:third-party` 生成独立原生库源码附件；发布工作流会把它
及校验和附到草稿 Release。镜像分发期间应保留该附件和文档所列源码入口。

## 首次公开发布

以 `0.0.0-dev` 公开源码不需要先打发布标签。推送前检查准确的暂存区内容（包括新增声明和素材），排除本机数据与凭据，并与已测试的源码包核对。首次源码提交推送后，必须确认同一个提交上的跨平台 Actions 矩阵通过；本机测试不能代替 Windows CI 结果。未完成相应验收前，保留开发版及平台未验证标记。

发布流程会先推送版本镜像及 `latest`，之后才创建草稿 Release；草稿状态不会使这些镜像标签保持私有。正式宣布 Release 前，启用私密漏洞报告，核对 GHCR 可见性，并在干净试用环境验证匿名拉取和启动。

1. 在 GitHub 创建 `xinnie-live/desktop-commander-sandbox` 仓库，检查待提交文件，再提交并推送源码。启用 Actions 和私密漏洞报告。
2. 等待默认分支 CI 通过。当前仅 macOS + OrbStack 做过真实配对与升级验证，保留其他平台的待验证标记。
3. 选定首个正式版本（例如 `0.1.0`），同步包版本、锁文件根版本和 Compose 镜像标签，在更新日志添加对应版本小节。提交后推送同名 `v0.1.0` 标签。
4. 发布流程先运行测试并验证源码包及校验和，再构建两个架构的镜像并创建草稿 Release。下载附件含源码 ZIP 和 SHA-256 校验文件。源码包包含构建所需文件，用户可选择预制镜像或自行构建。
5. 首次上传后，在 GitHub Packages 中把镜像设为 Public。用空的临时 Docker 配置分别验证 `linux/amd64` 和 `linux/arm64` 版本镜像的匿名拉取；在专用试用副本中验证控制台下载、下载失败恢复和 Release 安装说明。不要退出或替换用户现有的 Docker 登录配置。
6. 检查 Release 附件、说明、文档链接和漏洞报告入口。记录实际通过的平台与剩余验收缺口，再公开草稿 Release。失败的流程先修复，已发布版本用新版本号更新。

预制镜像只更新容器内软件。本机控制台随源码 ZIP 更新。源码包包含 macOS、Windows 和 Linux 启动脚本，README 提供启动说明。
