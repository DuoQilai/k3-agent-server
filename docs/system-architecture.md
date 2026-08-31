# 系统架构

本文用组件关系和部署栈描述系统，不把项目简化为单一 Agent，也不把 fleet
设备管理混入模型推理或 DSH 运行时。

## 1. 组件关系

    访问设备
    ├── 浏览器
    └── SSH local forwarding
          │ 127.0.0.1:3080 / 127.0.0.1:18789
          ▼
    K3 Pico-ITX / Bianbu Linux
    ├── Agent services
    │   ├── agent-dsh.service
    │   │   └── DSH Web / 127.0.0.1:3080
    │   │       └── dsh-web.service 兼容别名
    │   ├── openclaw-gateway.service（可选）
    │   │   └── OpenClaw Gateway / 127.0.0.1:18789
    │   └── 后续 Agent service（3081 起，预留）
    ├── Model service
    │   └── llama-server.service / 127.0.0.1:8080/v1
    │       └── GGUF model
    └── Fleet control
        ├── fleet CLI
        └── fleet MCP / stdio（7080 仅预留）
              └── SSH / scp → 其他 RISC-V 开发板

DSH、未来新增的 Agent 和其他 OpenAI-compatible 客户端可以共享本地模型 API。
当前 OpenClaw 文档先检查锁定交付物门槛，再覆盖受控安装后的云端模型提供方配置；它
不把本地 `llama-server` 接入列为已验证能力。Agent 不直接加载 GGUF，模型服务也不
负责工作区、文件或工具编排。

## 2. 部署栈

### 2.1 K3 服务设备

- 硬件：SpacemiT K3 Pico-ITX，架构 riscv64；
- 系统：Bianbu Linux、apt、systemd 用户服务；
- 核心运行时：Node.js v24.19.0、pnpm v10.28.0；
- OpenClaw 可选运行时：nvm Node.js v22.22.0；
- 模型服务：model/install.sh 和 model/systemd/llama-server.service；
- DSH Agent：agents/dsh/install.sh 和 agents/dsh/systemd/agent-dsh.service；
- OpenClaw：取得经审计的锁定交付物后，由 OpenClaw CLI 生成并管理用户服务；
- fleet：fleet/bin/fleet 和 fleet/mcp/server.mjs，不需要常驻 fleet systemd unit；
- 顶层入口：scripts/deploy.sh、scripts/start.sh、scripts/stop.sh、scripts/status.sh，
  只管理 llama-server 和 DSH。

### 2.2 访问和被管理设备

- 访问设备只通过 SSH 隧道访问 K3 的回环服务；
- 浏览器访问本地转发后的 3080 或可选 18789，不直接暴露 K3 端口；
- fleet 使用设备清单中的 SSH 密钥访问其他开发板；
- fleet MVP 多设备按顺序执行，不负责调度、并发和 RuyiSDK 流水线。

## 3. 协议和端口

| 端口或传输 | 组件 | 监听地址或方向 | 用途 |
|---|---|---|---|
| 3080 | DSH Web | K3 127.0.0.1 | Web UI 和 Agent 入口 |
| 3081 | 后续 Agent | K3 127.0.0.1，预留 | 后续 Agent Web 入口 |
| 18789 | OpenClaw Gateway | K3 回环地址，可选 | OpenClaw Web 和 Gateway RPC |
| 8080 | llama-server | K3 127.0.0.1 | OpenAI-compatible 模型 API |
| 7080 | Fleet MCP | 预留，当前不监听 | 后续 TCP MCP 入口 |
| stdio | Fleet MCP | Agent 子进程 | 当前 MCP 传输 |
| SSH/scp | Fleet CLI/MCP | K3 → 其他设备 | 命令执行和文件传输 |
| SSH forwarding | 访问设备 → K3 | 访问设备本地回环 | 浏览器访问 DSH/OpenClaw |

当前检查端点：

    curl -fsS http://127.0.0.1:8080/health
    curl -fsS http://127.0.0.1:8080/v1/models
    curl -fsS http://127.0.0.1:3080/
    openclaw gateway status --require-rpc

## 4. 主要数据流

本地模型请求：

    浏览器
    → SSH 隧道
    → DSH Web
    → DSH Agent runtime
    → http://127.0.0.1:8080/v1
    → llama-server
    → GGUF 推理

OpenClaw 云端模型请求：

    浏览器
    → SSH 隧道
    → OpenClaw Gateway
    → 已配置的云端模型提供方
    → 模型响应

远程设备操作：

    DSH 或 Codex CLI
    → fleet MCP stdio 或 fleet CLI
    → SSH/scp
    → 目标 RISC-V 开发板

云端模型请求不经过本地兼容层的 host 分流，继续使用 DSH 进程的原生
fetch。模型接入、凭据和模型切换见系统集成文档。

## 5. 服务生命周期

正式运行使用 systemd 用户服务：

    systemd --user
    ├── llama-server.service
    ├── agent-dsh.service
    │   └── dsh-web.service 兼容别名
    └── openclaw-gateway.service（可选，OpenClaw CLI 管理）

- loginctl enable-linger 让用户服务在无登录会话时继续运行；
- WantedBy=default.target 负责用户服务开机启用；
- 两个核心 unit 使用 Restart=on-failure，在进程异常后自动拉起；
- scripts/start.sh 等待 8080 健康后再启动 DSH；
- OpenClaw 使用 `openclaw gateway` 命令独立管理，不随顶层脚本启停；
- systemd journal 保存服务日志，fleet 写操作另通过 logger 记录审计信息。

## 6. 安全边界

- 3080、8080、可选 18789 和未来 Agent 端口默认只监听 K3 的回环地址；
- 访问 DSH/OpenClaw 使用 SSH 隧道，不直接开放服务端口；
- fleet 只接受 SSH 密钥，不支持密码认证；
- fleet/devices.yaml 只在本地维护，并由 .gitignore 忽略；
- SSH 私钥、云端 API Key、账号密码和配对信息不得写入仓库；
- DSH 的文件和 Shell 工具应限制在专用工作区和必要权限内。
