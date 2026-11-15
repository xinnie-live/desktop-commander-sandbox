## What and why / 改动与原因



## Checks / 验证

- [ ] `npm test`
- [ ] Compose / image / mount changes: ran the Docker checks in CONTRIBUTING.md / 已运行 CONTRIBUTING.md 中的 Docker 检查
- [ ] Anything not run is listed below as unverified / 未运行的检查已在下方列为未验证

Commands and results / 命令与结果：

## Safety / 安全边界

- [ ] Does not widen browser API input, host paths, or Compose/Docker command input / 未扩大浏览器 API、宿主路径或 Compose/Docker 命令的输入范围
- [ ] Does not expose the Docker socket, host namespaces, or credentials to the agent / 未向 Agent 暴露 Docker socket、宿主命名空间或凭据
- [ ] Logs, errors and reports contain no codes, tokens, emails, device IDs, or real user data / 日志、错误和报告不含授权码、令牌、邮箱、设备标识或真实数据
- [ ] English and Chinese docs updated if behavior changed / 行为变化已同步中英文文档

Unverified / 未验证：
