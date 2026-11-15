# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Private vulnerability reporting is enabled. Report through GitHub: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/xinnie-live/desktop-commander-sandbox/security/advisories/new)).

Please include:

- the affected version or commit
- host OS, Docker runtime, and versions
- impact and minimal reproduction steps

Use synthetic folders and redacted logs. Never include device codes, authorization links, credentials, or real run logs: run logs keep full container output and may contain secrets.

This is a volunteer-maintained project. Reports are handled on a best-effort basis, with no guaranteed response time.

## Scope

In scope: this repository's container configuration, privilege-drop helper, local console and CLI, and the patch applied to the pinned Desktop Commander release.

Out of scope: vulnerabilities in Desktop Commander itself, the Remote relay service, ChatGPT, or Claude. Report those to the respective vendors.

See the [security model](docs/SECURITY_MODEL.md) for documented limits, such as unfiltered outbound network access and readable read-only mounts.

---

## 报告安全问题（中文）

请**不要**在公开 issue 中提交安全问题。请通过仓库的 **Security → Report a vulnerability** 私下报告，并附上受影响版本、宿主系统与 Docker 版本、影响和最小复现步骤。请使用合成数据和脱敏日志，切勿附带设备码、授权链接、凭证或真实运行日志。本项目由个人维护，尽力处理，不承诺响应时间。
