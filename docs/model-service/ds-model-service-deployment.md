# DeepSeek × K3 Pico-ITX 模型服务部署

本文建立一个独立的本地模型服务：

```text
GGUF 模型
→ SpacemiT llama.cpp
→ llama-server
→ http://127.0.0.1:8080/v1
```

DSH 只是该服务的一个客户端。其他 OpenAI-compatible 客户端也可以通过 SSH 隧道调用模型 API。

## 1. 部署说明

### 1.1 固定配置

| 项目 | 固定值 |
|---|---|
| 服务设备 | SpacemiT K3 Pico-ITX，`riscv64` |
| 推理程序 | SpacemiT `llama-server` |
| 模型 | DeepSeek-R1-Distill-Qwen-1.5B Q4_0 |
| 模型文件 | `deepseek-r1-distill-qwen-1.5b-q4_0.gguf` |
| 监听地址 | `127.0.0.1` |
| 端口 | `8080` |
| 上下文长度 | `2048` |
| CPU 线程 | `8` |

### 1.2 部署方式

方式一是一键部署完整 AI 服务器：


```bash
bash scripts/deploy.sh
```

方式二是手动部署模型服务：依次完成本文第 2 至第 5 节。手动部署与一键部署使用相同的模型文件、启动参数和 systemd unit，是正式支持的等价路径。

如果只部署模型服务，不需要先安装 DSH；模型 API 可以独立运行并供其他客户端调用。

## 2. 环境准备

### 2.1 检查架构和资源

```bash
uname -m
free -h
df -h "$HOME"
```

架构必须是 `riscv64`。当前模型文件约 1 GB，建议为整个项目预留至少 10 GB 可用空间。

### 2.2 检查端口

```bash
ss -lntp | grep -E ':8080\b' || true
```

首次部署时 8080 不应被其他程序占用。不要在没有确认进程归属的情况下结束监听进程。

### 2.3 检查下载地址

```bash
curl -I --max-time 15 \
  https://archive.spacemit.com/spacemit-ai/model_zoo/llm/deepseek-r1-distill-qwen-1.5b-q4_0.gguf
```

## 3. 安装推理环境

### 3.1 安装 SpacemiT 软件包

```bash
sudo apt update
sudo apt install -y llama.cpp-tools-spacemit curl ca-certificates
```

旧版 Bianbu 软件源可能使用旧包名：

```bash
sudo apt install -y llama-server
```

只在新包名确实不存在时使用旧包名。安装后确认实际命令：

```bash
command -v llama-server
llama-server --version
command -v llama-cli || true
```

如果两个包名都不存在，不要直接从未知分支构建源码；先确认 Bianbu 软件源和固件版本。源码构建只有固定上游提交并记录编译选项后才具有可复现性。

## 4. 下载与运行模型

### 4.1 下载固定模型

```bash
MODEL_DIR="$HOME/.cache/models/llm"
MODEL_FILE="deepseek-r1-distill-qwen-1.5b-q4_0.gguf"
MODEL_URL="https://archive.spacemit.com/spacemit-ai/model_zoo/llm/$MODEL_FILE"

mkdir -p "$MODEL_DIR"
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"

if [[ ! -s "$MODEL_PATH" ]]; then
  if ! curl --fail --location --retry 3 --continue-at - \
    "$MODEL_URL" -o "$MODEL_PATH.part"; then
    REMOTE_SIZE="$(curl --fail --silent --show-error --location --head "$MODEL_URL" \
      | awk 'tolower($1) == "content-length:" { gsub("\r", "", $2); size = $2 } END { print size }' || true)"
    LOCAL_SIZE=0
    if [[ -f "$MODEL_PATH.part" ]]; then
      LOCAL_SIZE="$(wc -c < "$MODEL_PATH.part" | tr -d '[:space:]')"
    fi
    [[ -s "$MODEL_PATH.part" && -n "$REMOTE_SIZE" && "$LOCAL_SIZE" == "$REMOTE_SIZE" ]]
  fi
  mv "$MODEL_PATH.part" "$MODEL_PATH"
fi

ACTUAL_HASH="$(sha256sum "$MODEL_PATH" | awk '{ print $1 }')"
if [[ -f "$MODEL_PATH.sha256" ]]; then
  RECORDED_HASH="$(awk 'NF { print $1; exit }' "$MODEL_PATH.sha256")"
  [[ "$RECORDED_HASH" == "$ACTUAL_HASH" ]]
else
  printf '%s  %s\n' "$ACTUAL_HASH" "$MODEL_PATH" > "$MODEL_PATH.sha256"
fi
```

如果续传返回 HTTP 416，只有远端 `Content-Length` 与 `.part` 文件大小一致时才继续。已有 SHA-256 记录时必须比对，不能用当前文件的新哈希覆盖旧记录。

### 4.2 首次命令行推理

如果软件包提供 `llama-cli`，先做最小推理：

```bash
MODEL="$HOME/.cache/models/llm/deepseek-r1-distill-qwen-1.5b-q4_0.gguf"

llama-cli \
  -m "$MODEL" \
  -t 8 \
  -c 2048 \
  -p "只回复 OK"
```

命令应能加载 GGUF 并输出结果。加载失败时先检查模型路径、文件大小和日志，不要继续配置 DSH。

## 5. 启动本地 API

### 5.1 手工前台验证

部署 systemd 前，可以在 K3 服务设备前台运行：

```bash
llama-server \
  -m "$HOME/.cache/models/llm/deepseek-r1-distill-qwen-1.5b-q4_0.gguf" \
  -t 8 \
  -c 2048 \
  --host 127.0.0.1 \
  --port 8080
```

另开一个终端检查：

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/v1/models
```

验证完成后按 `Ctrl+C` 停止前台进程，再配置正式服务。

### 5.2 systemd 服务配置

正式运行使用 `$HOME/.config/systemd/user/llama-server.service`。项目提供的完整配置位于 `model/systemd/llama-server.service`，关键内容如下：

```ini
[Unit]
Description=SpacemiT K3 local model API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PATH=%h/.local/bin:%h/.local/node/bin:/usr/local/bin:/usr/bin:/bin
ExecStartPre=/usr/bin/test -s %h/.cache/models/llm/deepseek-r1-distill-qwen-1.5b-q4_0.gguf
ExecStart=/usr/bin/env llama-server -m %h/.cache/models/llm/deepseek-r1-distill-qwen-1.5b-q4_0.gguf -t 8 -c 2048 --host 127.0.0.1 --port 8080
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

只安装模型服务 unit：

```bash
mkdir -p "$HOME/.config/systemd/user"
install -m 0644 \
  model/systemd/llama-server.service \
  "$HOME/.config/systemd/user/llama-server.service"

systemctl --user daemon-reload
systemctl --user enable llama-server.service
sudo loginctl enable-linger "$USER"
systemctl --user start llama-server.service
```

`enable-linger` 让用户服务在没有登录会话时也能随系统启动。`Restart=on-failure` 让模型进程异常退出后自动拉起。

完成 DSH 手动部署后，再执行 `scripts/install-systemd-user-services.sh` 安装整套 unit，并使用 `scripts/start.sh` 按模型服务 → DSH 的顺序启动。

### 5.3 API 请求验证

```bash
curl -fsS http://127.0.0.1:8080/v1/models

curl -fsS http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "deepseek-r1-distill-qwen-1.5b-q4_0.gguf",
    "messages": [{"role": "user", "content": "只回复 OK"}],
    "max_tokens": 32,
    "stream": false
  }'
```

如果 `/v1/models` 返回的模型 ID 与文件名不同，聊天请求应使用接口实际返回的 ID。

### 5.4 从访问设备访问 8080

在实际访问服务的设备执行：

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8080:127.0.0.1:8080 <K3_USER>@<K3_IP>
```

然后访问设备上的客户端使用 `http://127.0.0.1:8080/v1`。不要把 K3 的 8080 直接绑定到局域网地址。

## 6. 性能验证与运维

### 6.1 查看状态和日志

```bash
systemctl --user status llama-server.service
journalctl --user -u llama-server.service -n 100 --no-pager
journalctl --user -u llama-server.service -f
```

### 6.2 重启和停止

```bash
systemctl --user restart llama-server.service
systemctl --user stop llama-server.service
systemctl --user start llama-server.service
```

完整服务器同时启停时使用项目脚本，确保顺序正确：

```bash
bash scripts/stop.sh
bash scripts/start.sh
```

### 6.3 性能检查

如果软件包提供 `llama-bench`：

```bash
llama-bench \
  -m "$HOME/.cache/models/llm/deepseek-r1-distill-qwen-1.5b-q4_0.gguf" \
  -t 8
```

性能结果受散热、系统负载、线程数、上下文长度和软件包版本影响。本手册不预置未经当前设备测量的速度结论。

### 6.4 常见问题

| 现象 | 检查 |
|---|---|
| unit 提示模型文件不存在 | 检查固定路径和 `test -s` |
| 8080 无响应 | 查看 `llama-server.service` 状态和 journal |
| 8080 已被占用 | 用 `ss -lntp` 确认实际监听进程 |
| 模型加载失败 | 检查文件大小、下载日志和本机 SHA-256 记录 |
| DSH 能打开但对话失败 | 先直接调用 `/v1/models` 和 `/v1/chat/completions` |

日常完整流程见[运维手册](../operations-manual.md)。
