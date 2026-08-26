# K3 Pico-ITX AI Server

本项目把 SpacemiT K3 Pico-ITX 配置为可长期运行的本地 AI 服务器，并提供
fleet 设备中控 MVP。K3 上运行模型服务、多个 Agent 和共享的设备管理能力；
访问设备通过 SSH 隧道使用 Web 服务。

## 1. 系统组成

    访问设备浏览器
          │
          │ SSH 隧道
          ▼
    K3 Pico-ITX / Bianbu Linux
    ├── DSH Agent              127.0.0.1:3080
    ├── llama-server 模型 API  127.0.0.1:8080/v1
    └── fleet CLI / MCP        SSH、scp、stdio

- DSH 负责对话、工作区、文件、Shell 和工具调用；
- llama-server 负责加载 GGUF 模型并提供 OpenAI-compatible API；
- 后续 Agent 从 3081 起分配端口，并共享 8080 模型 API；
- fleet 通过 SSH 管理其他 RISC-V 开发板，当前 MCP 使用 stdio；
- 7080 是后续 Fleet MCP TCP 入口的预留端口，当前不监听。

## 2. 首次部署

项目提供一键部署和手动部署两条正式路径。两条路径使用相同的固定版本、
目录、端口和 systemd unit。

### 2.1 一键部署

在 K3 服务设备上执行：

~~~bash
git clone https://github.com/DuoQilai/k3-agent-server.git
cd k3-agent-server
bash scripts/deploy.sh
~~~

脚本会完成：

1. 安装编译工具和 SpacemiT llama-server；
2. 安装并校验 Node.js v24.19.0 的 linux-riscv64 构建；
3. 安装 pnpm v10.28.0 和 @deepseek-ai/dsh@0.1.0-rc.8；
4. 构建 DSH 所需的 RISC-V 原生模块；
5. 下载并校验 DeepSeek-R1-Distill-Qwen-1.5B Q4_0 GGUF 模型；
6. 安装 agent-dsh.service 和 llama-server.service；
7. 启用 linger，启动并检查两个服务。

执行过程中需要网络、模型磁盘空间和 sudo 权限。不要使用 root 直接运行。

部署完成后检查：

~~~bash
bash scripts/status.sh
~~~

然后阅读 [DSH 模型接入与切换](docs/system-integration/dsh-model-integration.md)，
在 DSH 中添加本地模型提供方。

### 2.2 手动部署

需要逐项控制或定位安装问题时，按以下顺序执行：

1. 阅读[硬件要求](docs/hardware/README.md)和[基础环境](docs/base-environment/README.md)；
2. 按照[模型服务部署](docs/model-service/ds-model-service-deployment.md)运行
   model/install.sh，建立 8080 服务所需文件；
3. 按照[DSH 部署](docs/agent-service/dsh-deployment.md)运行 agents/dsh/install.sh；
4. 运行 scripts/install-systemd-user-services.sh，启用 linger 并执行 scripts/start.sh；
5. 按照[DSH 模型接入与切换](docs/system-integration/dsh-model-integration.md)配置模型。

## 3. 下次访问

服务已经设置为开机自启。K3 重启后，通常不需要重新部署或手工启动。

在 K3 服务设备上检查：

~~~bash
cd k3-agent-server
bash scripts/status.sh
~~~

如果服务没有运行：

~~~bash
bash scripts/start.sh
~~~

在实际访问服务的设备上建立 SSH 隧道：

~~~bash
K3_IP=<K3_IP> K3_USER=<K3_USER> bash scripts/tunnel.sh
~~~

保持终端窗口运行，在浏览器打开 http://127.0.0.1:3080。

没有项目副本时，也可以直接执行：

~~~bash
ssh -N -L 127.0.0.1:3080:127.0.0.1:3080 <K3_USER>@<K3_IP>
~~~

## 4. 日常命令

以下命令在 K3 服务设备的项目根目录执行：

~~~bash
bash scripts/start.sh
bash scripts/status.sh
bash scripts/stop.sh
~~~

DSH 的主 unit 是 agent-dsh.service，dsh-web.service 是兼容旧名称：

~~~bash
journalctl --user -u llama-server.service -u agent-dsh.service -f
~~~

完整操作见[运维手册](docs/operations-manual.md)。

## 5. Fleet 快速开始

在 K3 服务设备创建本地设备清单：

~~~bash
cp fleet/devices.yaml.example fleet/devices.yaml
~~~

填写设备名、地址、用户、SSH 私钥路径、架构、标签和 enabled 状态。真实清单已被
gitignore 忽略，不要将私钥写入仓库。

~~~bash
./fleet/bin/fleet --help
./fleet/bin/fleet ls
./fleet/bin/fleet exec tag:dev -- uname -m
./fleet/bin/fleet logs dev-board-01 /var/log/example.log --tail 100
~~~

Fleet MCP 是 stdio server，默认只注册 fleet_list、fleet_status 和 fleet_logs。
DSH 与 Codex CLI 的配置示例见[fleet MCP 文档](fleet/mcp/README.md)。

## 6. 文档导航

| 文档 | 解决的问题 |
|---|---|
| [项目总览](docs/project-overview.md) | 项目目标、边界和组件职责 |
| [系统架构](docs/system-architecture.md) | 浏览器、SSH、Agent、模型服务和 fleet 的关系 |
| [项目约定](docs/conventions.md) | 目录、端口、unit、Agent 配置和 fleet 安全约定 |
| [硬件要求](docs/hardware/README.md) | K3、内存、存储和网络要求 |
| [基础环境](docs/base-environment/README.md) | Bianbu、工具、权限和 systemd 前置条件 |
| [模型服务部署](docs/model-service/ds-model-service-deployment.md) | 安装 llama-server、下载模型并建立 8080 服务 |
| [DSH 部署](docs/agent-service/dsh-deployment.md) | 安装 DSH、兼容层并建立 3080 服务 |
| [DSH 模型接入与切换](docs/system-integration/dsh-model-integration.md) | 添加本地或云端提供方、选择模型和验证 |
| [应用入口](docs/application/README.md) | 当前 Web UI 入口和应用边界 |
| [运维手册](docs/operations-manual.md) | 下次访问、启停、日志、升级和故障排查 |
| [Fleet MCP](fleet/mcp/README.md) | MCP 工具、审计和 DSH/Codex 配置 |

推荐路径：项目总览 → 系统架构 → 模型服务部署 → DSH 部署 → 模型接入 →
Fleet MCP（需要时）→ 运维手册。

## 7. 固定部署基线

| 组件 | 固定值 |
|---|---|
| 服务设备 | SpacemiT K3 Pico-ITX，riscv64 |
| 操作系统 | Bianbu Linux，apt 和 systemd |
| Node.js | v24.19.0，linux-riscv64 |
| pnpm | v10.28.0 |
| DSH | @deepseek-ai/dsh@0.1.0-rc.8 |
| 模型 | deepseek-r1-distill-qwen-1.5b-q4_0.gguf |
| 模型 API | http://127.0.0.1:8080/v1 |
| DSH Web | http://127.0.0.1:3080 |

DSH 的固定 lockfile 位于 agents/dsh/pnpm-lock.yaml。一键部署找到它时使用
frozen-lockfile；没有时会使用兼容回退流程，并提示首次部署成功后将生成的
pnpm-lock.yaml 提交回仓库。

## 8. 项目目录

    k3-agent-server/
    ├── README.md
    ├── model/
    │   ├── install.sh
    │   └── systemd/llama-server.service
    ├── agents/
    │   ├── dsh/
    │   │   ├── install.sh
    │   │   ├── agent.env.example
    │   │   └── systemd/agent-dsh.service
    │   └── _template/
    ├── fleet/
    │   ├── bin/fleet
    │   ├── devices.yaml.example
    │   └── mcp/
    ├── scripts/
    └── docs/

密码、API Key、SSH 私钥、配对码等敏感信息不得写入仓库。
