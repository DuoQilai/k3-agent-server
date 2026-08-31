# OpenClaw × K3 Pico-ITX 交付物验证与运行验收

本文说明如何在 SpacemiT K3 Pico-ITX、Bianbu Linux 上检查 OpenClaw 的运行前置和
交付物门槛，并在组织已完成受控安装后配置后台服务、执行运行验收，以及建立访问设备
到 K3 的安全访问通道。

平台支持与 K3 Node.js 镜像依据 SpacemiT 文档；OpenClaw 主安装包和 Gateway 命令
固定到维护者的 `v2026.4.12-riscv64.1` 标签。OpenClaw 是可选组件，
由自己的 CLI 管理，不属于仓库 `scripts/start.sh`、`scripts/status.sh` 和
`scripts/stop.sh` 管理的 llama-server/DSH 核心服务。

本文只覆盖配置向导提供的云端模型路径，不把 K3 本地 `llama-server` 接入写成已经
验证的能力。模型提供方的 API Key、Gateway Token 和其他凭据不得写入仓库。

## 1. 验证与运行说明

### 1.1 平台支持

SpacemiT 文档给出的支持范围如下：

| 平台与系统 | 支持状态 |
|---|---|
| K1 Buildroot | 不支持 |
| K1 OpenHarmony | 不支持 |
| K1 Bianbu LXQT/GNOME | 支持 |
| K3 Buildroot | 不支持 |
| K3 OpenHarmony | 不支持 |
| K3 Bianbu LXQT/GNOME | 支持 |

本文只面向 K3 Bianbu Linux，不适用于 K3 Buildroot 或 OpenHarmony。

### 1.2 固定验证基线

| 项目 | 固定值 |
|---|---|
| 平台 | Linux RISC-V 64 |
| Node.js | v22.22.0，维护者在 K3 上的测试版本 |
| OpenClaw Release | `v2026.4.12-riscv64.1` |
| 安装包 | `openclaw-2026.4.12-riscv64.1.tgz` |
| SHA-256 | `cc3e8e5a679432000a988cd49617801d4fab969daa9ec76c990aeb7277851056` |
| Gateway 默认端口 | 18789 |
| 默认用户服务 | `openclaw-gateway.service`，由 OpenClaw CLI 生成 |

安装包的 `engines.node` 为 `>=22.14.0`，维护者文档要求 Node.js 24 或
22.16 以上，并在 K3 上测试了 v22.22.0。本文固定使用 v22.22.0，避免
`nvm install 22` 随时间变化。

OpenClaw 使用 nvm 管理的 Node.js v22.22.0。现有 DSH 继续使用项目固定的
Node.js v24.19.0，两套运行时不要互相覆盖。

> **安全与可复现性边界：** 该 Release 没有提供覆盖全局安装和 postinstall 的完整
> lockfile 或离线依赖包。直接执行 npm 全局安装会解析版本范围，postinstall 还会从
> 外部来源下载文件，因此本仓库不提供或批准该网络安装路径。安装必须保持阻塞，直到
> 维护者提供完整锁定的离线交付物，或组织自行生成并审计覆盖所有传递依赖和
> postinstall 文件的安装包。第 2 至 4 节只验证前置条件和主包；第 5 节之后只适用于
> 已经通过该门槛完成受控安装的环境。

### 1.3 目录说明

| 内容 | 默认或建议位置 |
|---|---|
| 下载的安装包 | `$HOME/Downloads/openclaw-2026.4.12-riscv64.1.tgz` |
| 经批准的 OpenClaw 安装目录 | 以锁定交付物的安装说明为准 |
| OpenClaw 配置、凭据和会话 | `$HOME/.openclaw/` |
| OpenClaw 默认工作区 | `$HOME/.openclaw/workspace/` |

不要把安装包、运行状态、凭据或工作区放入 `k3-agent-server` 仓库。

## 2. 环境准备

### 2.1 检查 K3 系统

在 K3 上执行：

```bash
uname -m
command -v apt-get
```

`uname -m` 应输出 `riscv64`。系统应为受支持的 K3 Bianbu LXQT/GNOME。

### 2.2 安装完整依赖

```bash
sudo apt-get update
sudo apt-get install -y \
  git curl ca-certificates build-essential pkg-config \
  cmake ninja-build python3 python3-pip \
  libopenblas-dev
```

验证安装流程直接使用的命令：

```bash
command -v git curl pkg-config cmake ninja python3 pip3 sha256sum
```

### 2.3 安装 nvm v0.40.3

```bash
export NVM_DIR="$HOME/.nvm"
test ! -e "$NVM_DIR"
git clone --branch v0.40.3 --depth 1 \
  https://github.com/nvm-sh/nvm.git "$NVM_DIR"
test "$(git -C "$NVM_DIR" rev-parse HEAD)" = \
  '977563e97ddc66facf3a8e31c6cff01d236f09bd'
```

以上流程不执行远程安装脚本，并在加载 nvm 代码前核对 `v0.40.3` 标签对应的固定提交。
`test ! -e` 会在已有 `$HOME/.nvm` 时停止，避免覆盖现有安装。

在当前终端加载 nvm：

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
nvm --version
```

版本应为 `0.40.3`。

## 3. 安装 Node.js v22.22.0

使用 K3 Node.js 镜像安装固定版本：

```bash
NVM_NODEJS_ORG_MIRROR=https://archive.spacemit.com/nodejs/k3 \
  nvm install 22.22.0
nvm use 22.22.0
```

验证：

```bash
test "$(node --version)" = "v22.22.0"
npm --version
```

新终端执行 OpenClaw 命令前，先运行：

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22.22.0
```

非交互 SSH 不一定加载 nvm。需要从访问设备运行单条命令时，显式加载它：

```bash
ssh <K3_USER>@<K3_LAN_IP> \
  'export NVM_DIR="$HOME/.nvm" &&
   . "$NVM_DIR/nvm.sh" &&
   nvm use 22.22.0 >/dev/null &&
   test "$(node --version)" = "v22.22.0"'
```

## 4. 校验 OpenClaw 主包和安装门槛

准备下载目录：

```bash
mkdir -p "$HOME/Downloads"
cd "$HOME/Downloads"
```

下载固定安装包：

```bash
openclaw_package="openclaw-2026.4.12-riscv64.1.tgz"
openclaw_url="https://github.com/dengxifeng/openclaw/releases/download/v2026.4.12-riscv64.1/$openclaw_package"

curl -fL --retry 3 -o "$openclaw_package" "$openclaw_url"
```

安装前必须校验 SHA-256：

```bash
printf '%s  %s\n' \
  'cc3e8e5a679432000a988cd49617801d4fab969daa9ec76c990aeb7277851056' \
  "$openclaw_package" | sha256sum -c -
```

校验输出 `OK` 只证明下载的主包与本项目记录一致，可以用于归档和审计；它不证明传递
依赖或 postinstall 下载内容固定，不能作为安装许可。

### 4.1 受控安装的必备条件

继续安装前，交付物必须同时满足：

1. 锁文件固定所有直接和传递依赖的精确版本与完整性摘要；
2. postinstall 使用的文件全部包含在离线包或清单中，并分别提供完整性摘要；
3. 安装过程可以在禁止外连的环境中完成；
4. 独立审核者确认清单、安装日志和最终文件树一致。

本仓库当前没有这样的交付物，因此流程在此停止。不要从主 `.tgz` 直接执行全局 npm
安装，也不要用其他联网安装方式绕过门槛。

获得经批准的锁定交付物后，应在本文记录其版本、SHA-256、依赖清单和受控安装命令，
再执行后续配置与验收。

## 5. 受控安装后的配置和验收

本节只适用于已经通过 4.1 节门槛完成安装的环境。先验证版本和安装位置：

```bash
command -v openclaw
openclaw --version | grep -F '2026.4.12-riscv64.1'
```

`command -v openclaw` 必须返回经批准交付物安装的可执行文件；任一检查失败都应停止。

### 5.1 启动配置向导并安装服务

```bash
openclaw onboard --install-daemon
```

按照向导配置模型和 Gateway。本文不预设模型 ID、API Key 或账号信息。

配置完成后，终端会输出一个带 Gateway Token 的本地地址，格式类似：

```text
http://127.0.0.1:18789/#token=<GATEWAY_TOKEN>
```

`<GATEWAY_TOKEN>` 代表配置向导实际生成的值。它属于凭据，不要复制到本文、Git
提交、聊天记录或公开截图中。

### 5.2 验证 Gateway RPC 和回环监听

```bash
openclaw gateway status --require-rpc
ss -H -ltn 'sport = :18789'
ss -H -ltn 'sport = :18789' | awk '
  $4 != "127.0.0.1:18789" && $4 != "[::1]:18789" { bad=1 }
  END { exit(NR == 0 || bad) }
'
```

三条命令都必须返回 0。最后一条会在没有监听或出现非回环监听时失败；不能只匹配
端口号，因为 `0.0.0.0:18789` 和 `[::]:18789` 也会包含同一端口。

### 5.3 验证 Gateway-backed 模型对话

普通 `openclaw agent` 在 Gateway 请求失败后可能回退到 embedded agent，不能单独
证明 Gateway 链路。使用 Gateway RPC 发送最小请求：

```bash
openclaw_smoke_id="k3-gateway-smoke-$(date -u +%Y%m%dT%H%M%SZ)"
openclaw_smoke_session="agent:main:$openclaw_smoke_id"
openclaw_smoke_params="$(printf \
  '{"message":"Reply with exactly K3_GATEWAY_OK","sessionKey":"%s","deliver":false,"idempotencyKey":"%s"}' \
  "$openclaw_smoke_session" "$openclaw_smoke_id")"

openclaw gateway call agent \
  --expect-final \
  --timeout 180000 \
  --json \
  --params "$openclaw_smoke_params"
```

验收要求：退出码为 0，JSON 中 `status` 为 `ok`、`summary` 为 `completed`，且
`result.payloads` 包含 `K3_GATEWAY_OK`。如果命令报告 `pairing required`，必须完成
当前 CLI 的设备配对后重试；不要使用 `--local` 或 embedded 回退掩盖失败。

固定版本 CLI 默认请求 `operator.admin`、`operator.read`、`operator.write`、
`operator.approvals`、`operator.pairing` 和 `operator.talk.secrets` 六项 scope。批准前
必须用 `openclaw devices list` 核对平台、客户端、角色、scope 和 `repair` 标志；只要
请求来源或权限超出当前授权，就停止验收，不要批准。

再执行一个不会触发模型调用的故意失败用例：

```bash
openclaw_negative_port=1
openclaw_negative_listeners="$(ss -H -ltn "sport = :$openclaw_negative_port")" &&
  test -z "$openclaw_negative_listeners" &&
  ! openclaw gateway health \
    --url "ws://127.0.0.1:$openclaw_negative_port" \
    --token INVALID_TEST_TOKEN \
    --timeout 2000
```

前置检查确认端口 1 没有监听后，健康检查应返回非零状态，因此外层 `!` 应返回 0。

## 6. 后台服务和日常操作

`openclaw onboard --install-daemon` 已安装并启动默认的 systemd 用户服务。完成向导后
直接运行 `openclaw gateway status --require-rpc`，不要紧接着再次执行 `gateway start`。

### 6.1 允许无登录会话运行

```bash
sudo loginctl enable-linger "$USER"
loginctl show-user "$USER" -p Linger
```

预期输出 `Linger=yes`。

### 6.2 后续启停和日志

```bash
openclaw gateway status --require-rpc
openclaw gateway restart
openclaw gateway stop
openclaw gateway start
journalctl --user -u openclaw-gateway.service -n 100 --no-pager
```

对已安装的服务，`openclaw gateway start` 内部同样执行 systemd restart，会短暂中断
当前 Gateway。先检查状态；需要明确重启时直接使用 `gateway restart`。如果以后更换
nvm Node.js 路径，应重新验证或重装 Gateway 服务，避免 unit 继续引用旧路径。

## 7. 局域网设备访问

本项目采用“Gateway 回环监听 + SSH 隧道”。浏览器不直接连接 K3 的 18789 端口。

### 7.1 确认 K3 地址和服务

在 K3 上执行：

```bash
hostname -I
openclaw gateway status --require-rpc
```

### 7.2 建立 SSH 隧道

在实际访问服务的设备上执行：

```bash
ssh -N \
  -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18789:127.0.0.1:18789 \
  <K3_USER>@<K3_LAN_IP>
```

保持该终端运行。`ExitOnForwardFailure=yes` 保证本地端口被占用或转发无法建立时，
SSH 直接失败，而不是留下一个看似正常但没有可用隧道的会话。

### 7.3 浏览器访问

在访问设备的浏览器中打开：

```text
http://127.0.0.1:18789/#token=<GATEWAY_TOKEN>
```

这里使用配置向导生成的 Gateway Token。浏览器中的 `127.0.0.1` 指向访问设备本身，
SSH 会把请求转发到 K3 的 `127.0.0.1:18789`。

如果页面无法打开，依次检查：

1. K3 上 `openclaw gateway status --require-rpc` 是否成功；
2. K3 上 18789 是否只监听回环地址；
3. 访问设备能否通过 SSH 登录 K3；
4. 建立隧道的命令是否仍在运行且没有转发错误；
5. 浏览器地址中的 Token 是否来自当前 Gateway 配置。

## 8. 参考资料

- [SpacemiT：OpenClaw（平台支持与 K3 Node.js 镜像）](https://spacemit.com/community/document/info?lang=zh&nodepath=ai/solutions/aicomputer_solution/openclaw.md)
- [OpenClaw RISC-V64 v2026.4.12-riscv64.1 README](https://github.com/dengxifeng/openclaw/blob/v2026.4.12-riscv64.1/README.md)
- [OpenClaw RISC-V64 v2026.4.12-riscv64.1 Release](https://github.com/dengxifeng/openclaw/releases/tag/v2026.4.12-riscv64.1)
- [固定版本 Gateway CLI 文档](https://github.com/dengxifeng/openclaw/blob/v2026.4.12-riscv64.1/docs/cli/gateway.md)
- [固定版本 Agent CLI 文档](https://github.com/dengxifeng/openclaw/blob/v2026.4.12-riscv64.1/docs/cli/agent.md)
- [OpenClaw：远程访问](https://docs.openclaw.ai/gateway/remote)
