# DeepSeek Harness × K3 Pico-ITX 部署

本文在 K3 上建立 DSH Agent 服务：

```text
DeepSeek Harness
→ 工作区、文件、Shell 和工具
→ DSH Web
→ http://127.0.0.1:3080
```

DSH 不负责运行 GGUF 模型。本地模型服务应按照[模型服务部署](../model-service/ds-model-service-deployment.md)独立建立。

## 1. 部署说明

### 1.1 固定版本

| 项目 | 固定值 |
|---|---|
| Node.js | v24.19.0 `linux-riscv64` |
| pnpm | v10.28.0 |
| DSH | `@deepseek-ai/dsh@0.1.0-rc.8` |
| DSH 运行目录 | `$HOME/dsh-runtime` |
| 兼容层 | `$HOME/dsh-fetch-https-compat.mjs` |
| Web 地址 | `http://127.0.0.1:3080` |
| 模型 API | `http://127.0.0.1:8080/v1` |

`rc.8` 是本项目固定的部署基线，不表示上游最新版本。不要在正常部署中使用不带版本号的 `npm install` 或 `npx`。

### 1.2 部署方式

方式一是一键部署完整 AI 服务器：


```bash
bash scripts/deploy.sh
```

方式二是手动部署：先完成模型服务手动部署，再依次完成本文第 2 至第 5 节。手动部署与一键部署使用相同的 Node.js、pnpm、DSH、兼容层和 systemd 配置，是正式支持的等价路径。

不要先执行一半一键部署、再从手动流程中间继续。需要切换方式时，先通过版本、文件和 unit 状态确认已经完成的步骤。

## 2. 环境准备

### 2.1 检查系统

```bash
uname -m
command -v sudo apt systemctl loginctl curl
free -h
df -h "$HOME"
```

架构必须为 `riscv64`。当前用户必须是能执行 `sudo` 的普通用户。

### 2.2 安装编译工具

DSH 的 `node-pty` 在 RISC-V 上需要本机编译：

```bash
sudo apt update
sudo apt install -y build-essential python3 curl xz-utils ca-certificates
```

### 2.3 检查网络与端口

```bash
curl -I --max-time 15 https://unofficial-builds.nodejs.org/
curl -I --max-time 15 https://registry.npmjs.org/@deepseek-ai%2Fdsh
ss -lntp | grep -E ':3080\b' || true
```

如果使用代理，`NO_PROXY` 应包含 `127.0.0.1,localhost`。

## 3. 安装 DSH

### 3.1 固定目录安装 Node.js

Node.js 官方发布不提供 `linux-riscv64` 成品包。本流程使用固定版本的 Node.js unofficial-builds，并用同一发布目录的 SHA-256 清单校验：

```bash
TEMP_DIR="$(mktemp -d)"
BASE_URL="https://unofficial-builds.nodejs.org/download/release/v24.19.0"
ARCHIVE="node-v24.19.0-linux-riscv64.tar.xz"

curl -fL "$BASE_URL/$ARCHIVE" -o "$TEMP_DIR/$ARCHIVE"
curl -fL "$BASE_URL/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"

EXPECTED="$(awk -v file="$ARCHIVE" '$2 == file { print $1 }' "$TEMP_DIR/SHASUMS256.txt")"
ACTUAL="$(sha256sum "$TEMP_DIR/$ARCHIVE" | awk '{ print $1 }')"
test -n "$EXPECTED" && test "$EXPECTED" = "$ACTUAL"

mkdir -p "$HOME/.local" "$HOME/.local/bin"
tar -xJf "$TEMP_DIR/$ARCHIVE" -C "$HOME/.local"
ln -sfn "$HOME/.local/node-v24.19.0-linux-riscv64" "$HOME/.local/node"

for command_name in node npm npx corepack; do
  ln -sfn "$HOME/.local/node/bin/$command_name" "$HOME/.local/bin/$command_name"
done

rm -rf "$TEMP_DIR"
```

验证：

```bash
"$HOME/.local/bin/node" --version
"$HOME/.local/bin/node" -p process.arch
```

预期分别为 `v24.19.0` 和 `riscv64`。

### 3.2 安装 pnpm

```bash
export PATH="$HOME/.local/bin:$PATH"

"$HOME/.local/bin/npm" install \
  --prefix "$HOME/.local/pnpm10" \
  --registry=https://registry.npmjs.org \
  --save-exact pnpm@10.28.0

"$HOME/.local/pnpm10/node_modules/.bin/pnpm" --version
```

### 3.3 安装固定 DSH 版本

```bash
mkdir -p "$HOME/dsh-runtime"

cat > "$HOME/dsh-runtime/package.json" <<'EOF'
{
  "name": "k3-dsh-runtime",
  "private": true,
  "packageManager": "pnpm@10.28.0",
  "dependencies": {
    "@deepseek-ai/dsh": "0.1.0-rc.8"
  }
}
EOF

cat > "$HOME/dsh-runtime/pnpm-workspace.yaml" <<'EOF'
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  '@google/genai': true
  koffi: true
  node-pty: true
  protobufjs: true
EOF

export PATH="$HOME/.local/pnpm10/node_modules/.bin:$HOME/.local/bin:$PATH"
export npm_config_nodedir="$HOME/.local/node"

install -m 0644 \
  agents/dsh/pnpm-lock.yaml \
  "$HOME/dsh-runtime/pnpm-lock.yaml"

pnpm --dir "$HOME/dsh-runtime" install \
  --registry=https://registry.npmjs.org \
  --frozen-lockfile
pnpm --dir "$HOME/dsh-runtime" rebuild
```

注意：`pnpm-workspace.yaml` 中的 `allowBuilds` 不能省略。否则 pnpm 可能跳过 `node-pty` 构建，DSH 的 Shell 与终端能力会失败。

当前仓库包含 `agents/dsh/pnpm-lock.yaml`，手动部署和一键部署都必须复制该文件并使用 `--frozen-lockfile`。只有在维护者明确移除 lockfile 的兼容场景下，才使用 `--frozen-lockfile=false`，并在首次安装成功后将生成的 lockfile 提交回仓库。

如果设备上已有旧版 DSH 运行目录，且其 `package.json` 名称为 `dsh-runtime` 并声明了 `@deepseek-ai/dsh`，一键部署会复用该目录并按当前固定版本收敛。检测到无关 Node.js 项目时会停止部署，避免覆盖用户文件。

检查 RISC-V 原生模块：

```bash
find "$HOME/dsh-runtime/node_modules" \
  -path '*/build/Release/pty.node' -type f -print
```

至少应找到一个 `pty.node`。

### 3.4 安装 K3 HTTP(S) 兼容层

固定基线通过 Node 的 `--import` 加载项目脚本 `agents/dsh/dsh-fetch-https-compat.mjs`：

```bash
install -m 0644 \
  agents/dsh/dsh-fetch-https-compat.mjs \
  "$HOME/dsh-fetch-https-compat.mjs"
```

该脚本不是 DSH 上游组件。它只对 URL host 为 `127.0.0.1:8080` 的本地模型 API 和 `api.deepseek.com` 的 DeepSeek 官方 API 请求使用启用了宽松响应头解析的 Node 核心客户端，以兼容 K3 环境中被严格解析器拒绝的响应头；其他云端或外部 provider 请求继续使用原生 `fetch`。兼容层支持 string、URL 和 Request 输入，兼容请求的 body 仅支持 string、Buffer 和 TypedArray。

注意：兼容层会影响该 DSH 进程发往上述两个精确 host 的请求，但不会接管其他云端 provider。升级 Node.js 或 DSH 后，应在临时端口验证是否仍需要它，不能未经验证直接删除。

### 3.5 安装验证

```bash
DSH_BIN="$HOME/dsh-runtime/node_modules/.bin/dsh"
DSH_JS="$HOME/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js"

"$DSH_BIN" --version
"$HOME/.local/bin/node" --expose-internals "$DSH_JS" web --help
```

DSH 版本必须是 `0.1.0-rc.8`，Web 命令帮助必须正常显示。

## 4. 启动与访问

### 4.1 systemd 服务配置

正式运行只使用 systemd 用户服务。DSH 主 unit 安装到 `$HOME/.config/systemd/user/agent-dsh.service`，旧名称 dsh-web.service 作为兼容别名；项目源文件位于 `agents/dsh/systemd/agent-dsh.service`。关键配置如下：

```ini
[Unit]
Description=DeepSeek Harness Agent service
After=network-online.target llama-server.service
Wants=network-online.target llama-server.service

[Service]
Type=simple
WorkingDirectory=%h/dsh-runtime
Environment=PATH=%h/.local/bin:%h/.local/node/bin:/usr/local/bin:/usr/bin:/bin
Environment=DSH_LOCAL_API_KEY=local
EnvironmentFile=-%h/.config/k3-agent-server/agents/dsh/agent.env
ExecStartPre=/usr/bin/test -x %h/.local/bin/node
ExecStartPre=/usr/bin/test -f %h/dsh-fetch-https-compat.mjs
ExecStartPre=/usr/bin/test -f %h/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js
ExecStart=/usr/bin/env node --import %h/dsh-fetch-https-compat.mjs --expose-internals %h/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 3080 --no-open
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
Alias=dsh-web.service
```

`Wants` 会在启动 DSH 时尝试启动本地模型，但不会把 DSH 强制绑定到本地模型；只使用云端提供方时，DSH 仍可以独立运行。

模型服务和 DSH 都已完成手动安装后，安装整套 unit 并启用：

```bash
bash scripts/install-systemd-user-services.sh
sudo loginctl enable-linger "$USER"
bash scripts/start.sh
```

### 4.2 启动验证

```bash
systemctl --user status agent-dsh.service
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/
```

HTTP 状态应为 `200`。页面能打开只证明 Web 服务可用，模型请求还必须按模型接入文档单独验证。

### 4.3 从访问设备打开 Web UI

在实际访问服务的设备执行：

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:3080:127.0.0.1:3080 <K3_USER>@<K3_IP>
```

保持该命令运行，然后在访问设备浏览器打开 <http://127.0.0.1:3080>。

## 5. 工作区与基础配置

### 5.1 建立工作区

在 K3 服务设备为当前用户建立专用目录：

```bash
mkdir -p "$HOME/k3-workspace"
test -r "$HOME/k3-workspace" && test -w "$HOME/k3-workspace"
```

在 DSH Web UI 中选择该目录作为工作区。不要把整个主目录或系统目录直接作为可写工作区。

### 5.2 权限原则

- DSH 服务以当前普通用户运行；
- 只授予任务所需的工作区和工具权限；
- 不使用 `chmod -R 777`；
- 云端 API Key 通过 DSH 凭据界面保存，不写入仓库或 systemd unit；
- `DSH_LOCAL_API_KEY=local` 只是无鉴权本地模型接口的占位值。

## 6. 运维与故障排查

### 6.1 下次运行

服务已 `enable` 且用户已 `enable-linger` 时，K3 开机后会自动启动。日常只需：

```bash
bash scripts/status.sh
```

如果服务未运行：

```bash
bash scripts/start.sh
```

### 6.2 日志和重启

```bash
journalctl --user -u agent-dsh.service -n 100 --no-pager
journalctl --user -u agent-dsh.service -f
systemctl --user restart agent-dsh.service
```

### 6.3 常见问题

| 现象 | 检查 |
|---|---|
| `node` 不存在 | 检查 `$HOME/.local/bin/node` 软链接 |
| DSH 版本不对 | 检查 `$HOME/dsh-runtime/package.json` 和 `pnpm-lock.yaml` |
| `pty.node` 不存在 | 检查 `allowBuilds`、编译工具和 `pnpm rebuild` 输出 |
| unit 启动失败 | 查看 `journalctl --user -u agent-dsh.service` |
| 3080 被占用 | 用 `ss -lntp` 找到实际监听进程 |
| 页面打开但模型失败 | 先检查 8080 API，再检查提供方配置和 DSH journal |
| HTTP 解析错误 | 确认 unit 已加载兼容层，且项目脚本已复制到 `$HOME` |

### 6.4 升级原则

不要在 `$HOME/dsh-runtime` 中直接升级到上游最新版本。先复制或新建候选运行目录，在 3090 等未分配临时端口完成以下检查：

1. CLI 版本和 `web --help`；
2. `node-pty` 原生模块；
3. Web 页面和工作区创建；
4. 本地模型与实际最小对话请求；
5. 兼容层是否仍需要；
6. systemd unit 的命令行参数。

全部通过后再切换正式 unit，并保留 rc.8 运行目录用于回滚。完整日常操作见[运维手册](../operations-manual.md)。
