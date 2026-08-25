# K3 Pico-ITX AI Server

本项目是一套面向 SpacemiT K3 Pico-ITX 的用户手册和可复现部署流程。它在 K3 上部署本地模型 API 与 DeepSeek Harness（DSH），使用 systemd 用户服务实现开机自启和崩溃自动拉起。

## 1. 系统组成

```text
访问设备浏览器
      │
      │ SSH 隧道
      ▼
K3 Pico-ITX（Bianbu Linux）
  ├── DSH Agent 服务       127.0.0.1:3080
  └── llama-server 模型服务 127.0.0.1:8080/v1
```

- DSH 负责对话、工作区、文件、Shell 和工具调用。
- `llama-server` 负责加载 GGUF 模型并提供 OpenAI-compatible API。
- 两个端口只监听 K3 的 `127.0.0.1`，访问设备通过 SSH 隧道使用服务。

## 2. 首次部署

本项目提供两种等价的部署方式。两种方式使用相同的固定版本、目录、端口和 systemd unit，最终运行结果一致。

### 2.1 方式一：一键部署

在 K3 服务设备上执行：

```bash
git clone https://github.com/DuoQilai/spacemit-k3-ai-server.git
cd spacemit-k3-ai-server
bash scripts/deploy.sh
```

脚本会完成以下工作：

1. 安装编译工具和 SpacemiT `llama-server`；
2. 安装并校验 Node.js v24.19.0 RISC-V 构建；
3. 安装 pnpm v10.28.0 和 `@deepseek-ai/dsh@0.1.0-rc.8`；
4. 构建 DSH 所需的 RISC-V 原生模块；
5. 下载 `DeepSeek-R1-Distill-Qwen-1.5B Q4_0` GGUF 模型；
6. 安装并启用 systemd 用户服务；
7. 执行 `loginctl enable-linger`，启动并检查两个服务。

执行过程中需要网络、约 1 GB 的模型下载空间和 `sudo` 权限。不要使用 root 直接运行脚本。

部署完成后检查：

```bash
bash scripts/status.sh
```

然后按照 [DSH 模型接入与切换](docs/system-integration/dsh-model-integration.md)在 DSH 中添加本地模型提供方。

### 2.2 方式二：手动部署

需要逐项控制、学习配置或定位安装问题时，按照以下顺序执行：

1. 阅读[硬件要求](docs/hardware/README.md)和[基础环境](docs/base-environment/README.md)，检查架构、资源、网络和 systemd；
2. 按照[模型服务部署](docs/model-service/ds-model-service-deployment.md)安装 `llama-server`、下载模型并验证 8080；
3. 按照[DSH 部署](docs/agent-service/dsh-deployment.md)安装 Node.js、pnpm、DSH 和兼容层；
4. 安装两个 systemd unit，并启动完整服务器；
5. 按照[DSH 模型接入与切换](docs/system-integration/dsh-model-integration.md)添加本地模型。

## 3. 下次访问

服务已经设置为开机自启。K3 重启后，通常不需要重新部署或手工启动。

在 K3 服务设备上检查状态：

```bash
cd spacemit-k3-ai-server
bash scripts/status.sh
```

如果服务没有运行：

```bash
bash scripts/start.sh
```

在实际访问服务的设备上建立 SSH 隧道：

```bash
K3_IP=<K3_IP> K3_USER=<K3_USER> bash scripts/tunnel.sh
```

保持终端窗口运行，在浏览器打开 <http://127.0.0.1:3080>。

没有项目副本时，也可以直接执行：

```bash
ssh -N -L 127.0.0.1:3080:127.0.0.1:3080 <K3_USER>@<K3_IP>
```

## 4. 日常命令

以下命令都在 K3 服务设备的项目根目录执行：

```bash
bash scripts/start.sh    # 启动并等待服务就绪
bash scripts/status.sh   # 检查 systemd 状态和 HTTP 健康状态
bash scripts/stop.sh     # 停止两个服务
```

日志统一由 systemd journal 管理：

```bash
journalctl --user -u llama-server.service -u dsh-web.service -f
```

完整操作见 [运维手册](docs/operations-manual.md)。

## 5. 文档导航

| 文档 | 解决的问题 |
|---|---|
| [项目总览](docs/project-overview.md) | 项目目标、边界、组件和固定版本 |
| [系统架构](docs/system-architecture.md) | 五层结构、端口、依赖和数据流 |
| [硬件要求](docs/hardware/README.md) | K3、内存、存储和网络要求 |
| [基础环境](docs/base-environment/README.md) | Bianbu、工具、权限和 systemd 前置条件 |
| [模型服务部署](docs/model-service/ds-model-service-deployment.md) | 安装 `llama-server`、下载模型并建立 8080 服务 |
| [DSH 部署](docs/agent-service/dsh-deployment.md) | 安装 DSH、兼容层并建立 3080 服务 |
| [DSH 模型接入与切换](docs/system-integration/dsh-model-integration.md) | 添加本地/云端提供方、选择模型和验证 |
| [应用入口](docs/application/README.md) | 当前 Web UI 入口和应用层边界 |
| [运维手册](docs/operations-manual.md) | 下次访问、启动、停止、日志、升级和故障排查 |

推荐阅读顺序：模型服务部署 → DSH 部署 → 模型接入 → 运维手册。

## 6. 固定部署基线

| 组件 | 固定值 |
|---|---|
| 服务设备 | SpacemiT K3 Pico-ITX，`riscv64` |
| 操作系统 | Bianbu Linux，使用 `apt` 和 systemd |
| Node.js | v24.19.0，`linux-riscv64` |
| pnpm | v10.28.0 |
| DSH | `@deepseek-ai/dsh@0.1.0-rc.8` |
| 模型 | `deepseek-r1-distill-qwen-1.5b-q4_0.gguf` |
| 模型 API | `http://127.0.0.1:8080/v1` |
| DSH Web | `http://127.0.0.1:3080` |

`rc.8` 是本项目固定的可复现基线，不表示上游最新版本。升级前必须保留当前运行目录，并在临时端口完成验证。

若仓库存在 `scripts/dsh-runtime/pnpm-lock.yaml`，一键部署会复制该 lockfile 并使用 `--frozen-lockfile` 固定传递依赖；不存在时，首次部署成功后建议将生成的 `pnpm-lock.yaml` 提交回仓库。

## 7. 项目目录

```text
spacemit-k3-ai-server/
├── README.md
├── docs/
│   ├── application/
│   ├── system-integration/
│   ├── agent-service/
│   ├── model-service/
│   ├── base-environment/
│   ├── hardware/
│   ├── project-overview.md
│   ├── system-architecture.md
│   └── operations-manual.md
├── scripts/
│   └── systemd/
└── results/
```

`results/` 保存用户自行产生的本地结果。密码、API Key、配对码等敏感信息不得写入仓库。
