# K3 AI Server 运维手册

本文是部署完成后的日常入口。正式运行只使用 systemd 用户服务，不使用 `nohup`、手工 PID 文件或其他并行启动方式。

## 1. 服务说明

### 1.1 服务清单

| unit | 端口 | 作用 |
|---|---|---|
| `llama-server.service` | 8080 | 本地模型 API |
| `agent-dsh.service` | 3080 | DSH Agent 和 Web UI；dsh-web.service 为兼容别名 |

unit 源文件位于 model/systemd/ 和 agents/dsh/systemd/，安装后复制到 `$HOME/.config/systemd/user/`。

### 1.2 正式运行机制

- `systemctl --user enable`：把两个 unit 加入用户默认 target；
- `loginctl enable-linger`：让用户管理器在没有登录会话时也随系统运行；
- `Restart=on-failure`：进程异常退出后自动拉起；
- systemd journal：统一保存服务标准输出和错误日志。

## 2. 首次部署后确认

无论使用一键部署还是手动部署，最终都应得到相同的两个 systemd 用户服务。以下检查不区分安装方式。

### 2.1 检查开机自启

```bash
systemctl --user is-enabled llama-server.service
systemctl --user is-enabled agent-dsh.service
loginctl show-user "$USER" -p Linger
```

预期两个 unit 都显示 `enabled`，linger 显示 `Linger=yes`。

### 2.2 检查服务

```bash
bash scripts/status.sh
```

正常时应同时看到：

```text
llama-server.service: active
agent-dsh.service: active
Model API: healthy
DSH Web UI: healthy
```

## 3. 下次如何访问

### 3.1 K3 已开机

systemd 会自动启动两个服务。先在 K3 服务设备执行：

```bash
cd k3-agent-server
bash scripts/status.sh
```

如果全部正常，不需要执行部署或启动命令。

### 3.2 服务未运行

```bash
bash scripts/start.sh
```

该脚本先启动并等待模型 API，再启动并等待 DSH Web。它不会创建第二套后台进程。

### 3.3 在访问设备建立隧道

```bash
K3_IP=<K3_IP> K3_USER=<K3_USER> bash scripts/tunnel.sh
```

保持该终端运行，在访问设备浏览器打开 <http://127.0.0.1:3080>。

也可以直接执行：

```bash
ssh -N -L 127.0.0.1:3080:127.0.0.1:3080 <K3_USER>@<K3_IP>
```

## 4. 启动、停止和重启

### 4.1 启动完整服务器

```bash
bash scripts/start.sh
```

### 4.2 停止完整服务器

```bash
bash scripts/stop.sh
```

停止顺序是 DSH → 模型服务。

### 4.3 重启完整服务器

```bash
bash scripts/stop.sh
bash scripts/start.sh
```

### 4.4 单独操作服务

```bash
systemctl --user restart llama-server.service
systemctl --user restart agent-dsh.service

systemctl --user stop agent-dsh.service
systemctl --user start agent-dsh.service
```

修改模型服务时，先停止 DSH 可以避免请求落到正在重启的模型 API。

## 5. 状态和健康检查

### 5.1 项目状态脚本

```bash
bash scripts/status.sh
```

脚本同时检查 unit 的 `active` 状态和 HTTP 端点；任意一项失败时返回非零状态。

### 5.2 systemd 状态

```bash
systemctl --user status llama-server.service agent-dsh.service
systemctl --user show llama-server.service -p ActiveState -p SubState -p NRestarts
systemctl --user show agent-dsh.service -p ActiveState -p SubState -p NRestarts
```

### 5.3 HTTP 检查

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/v1/models
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/
```

## 6. 日志

### 6.1 最近日志

```bash
journalctl --user -u llama-server.service -n 100 --no-pager
journalctl --user -u agent-dsh.service -n 100 --no-pager
```

### 6.2 实时日志

```bash
journalctl --user -u llama-server.service -f
journalctl --user -u agent-dsh.service -f
```

### 6.3 本次开机日志

```bash
journalctl --user -b -u llama-server.service -u agent-dsh.service --no-pager
```

## 7. 修改服务配置

### 7.1 配置来源

模型服务配置：

```text
model/systemd/llama-server.service
```

DSH 服务配置：

```text
agents/dsh/systemd/agent-dsh.service
```

部署文档中也记录了 unit 的关键配置和参数含义；服务配置不只存在于脚本文件。

### 7.2 修改后重新安装

在项目目录修改源文件后执行：

```bash
bash scripts/install-systemd-user-services.sh
bash scripts/stop.sh
bash scripts/start.sh
```

不要只编辑 `$HOME/.config/systemd/user/` 中的副本，否则下次安装脚本会覆盖改动。

### 7.3 变更模型参数

线程数、上下文长度、模型路径、监听地址或端口都在 `llama-server.service` 的 `ExecStart` 中。修改后应同步更新模型接入文档中的 Base URL、Context window 和 Model ID。

3080 和 8080 默认保持 `127.0.0.1` 监听。需要局域网或公网访问时，应单独设计认证、TLS、防火墙和反向代理，不能只把 `--host` 改为 `0.0.0.0`。

## 8. 开机自启与崩溃恢复

### 8.1 重新启用

```bash
bash scripts/install-systemd-user-services.sh
sudo loginctl enable-linger "$USER"
```

### 8.2 验证重启恢复

设备重启后重新连接 SSH，再执行：

```bash
loginctl show-user "$USER" -p Linger
bash scripts/status.sh
```

如果 unit 为 enabled 但没有启动，查看本次开机日志：

```bash
journalctl --user -b -u llama-server.service -u agent-dsh.service --no-pager
```

### 8.3 关闭开机自启

```bash
systemctl --user disable --now agent-dsh.service llama-server.service
```

只有明确不再需要无人登录启动时，才执行：

```bash
sudo loginctl disable-linger "$USER"
```

## 9. 升级与回滚

### 9.1 DSH 升级

本项目的正式基线固定为 rc.8。升级时：

1. 不直接覆盖 `$HOME/dsh-runtime`；
2. 在独立目录安装候选精确版本；
3. 使用 3081 等临时端口启动；
4. 验证 CLI、原生模块、工作区、真实模型请求和兼容层；
5. 修改项目中的 unit 源文件；
6. 重新安装 unit 并切换；
7. 保留 rc.8 目录直到新版本稳定。

回滚时恢复 unit 中的 rc.8 路径，重新安装并重启服务。

### 9.2 模型或 llama-server 升级

更换模型前先保留旧 GGUF 和当前 unit。候选模型使用独立文件名或临时端口验证，确认 `/health`、`/v1/models` 和最小聊天请求后再切换正式配置。

## 10. 故障排查

### 10.1 端口冲突

```bash
ss -lntp | grep -E ':(3080|8080)\b' || true
```

先确认监听进程是否由 systemd 用户服务启动，再决定停止哪个 unit。不要使用模糊的 `pkill node` 或 `pkill llama`。

### 10.2 模型服务失败

```bash
systemctl --user status llama-server.service
journalctl --user -u llama-server.service -n 100 --no-pager
test -s "$HOME/.cache/models/llm/deepseek-r1-distill-qwen-1.5b-q4_0.gguf"
command -v llama-server
```

### 10.3 DSH 服务失败

```bash
systemctl --user status agent-dsh.service
journalctl --user -u agent-dsh.service -n 100 --no-pager
test -x "$HOME/.local/bin/node"
test -f "$HOME/dsh-fetch-https-compat.mjs"
test -f "$HOME/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js"
```

### 10.4 页面正常但模型请求失败

按顺序检查：

1. `8080/v1/models`；
2. `8080/v1/chat/completions`；
3. DSH 中的 Provider ID、Base URL、协议、凭据和 Model ID；
4. `llama-server.service` journal；
5. `agent-dsh.service` journal；
6. 新建会话后的最小请求。

模型配置详见 [DSH 模型接入与切换](system-integration/dsh-model-integration.md)。
