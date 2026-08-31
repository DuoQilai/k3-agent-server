# 项目总览

## 1. 项目目标

本项目把 SpacemiT K3 Pico-ITX 配置为一台可长期运行的本地 AI 服务器：本地模型服务
提供推理 API，DeepSeek Harness 提供 Agent、工作区、工具和 Web UI，访问设备通过
SSH 隧道安全使用服务。

## 2. 当前能力

```text
用户
  ↓
DSH Web UI
  ↓
DSH Agent Runtime
  ↓
本地或云端模型提供方
  ↓
模型响应、文件操作、Shell 和工具调用
```

当前默认流程部署：

- `llama-server` 本地模型 API；
- DeepSeek-R1-Distill-Qwen-1.5B Q4_0；
- DeepSeek Harness Web profile；
- systemd 用户服务、开机自启和崩溃重启；
- 仅回环监听和 SSH 隧道访问。

OpenClaw Gateway 是独立运维的可选 Agent；只有取得经审计的锁定交付物后才能安装。
受控安装后使用 127.0.0.1:18789 和已配置的云端模型提供方；它不属于默认部署，也不由
仓库顶层启停脚本管理。

当前 fleet MVP 提供设备清单、SSH 可达性检查、命令执行、文件传输、日志读取，
以及供 DSH 和 Codex CLI 使用的 stdio MCP server。

## 3. 组件边界

fleet 是共享的设备中控组件，和 DSH、模型服务并列；它不负责模型推理、Agent
会话或多设备调度。

| 组件 | 负责 | 不负责 |
|---|---|---|
| 模型服务 | GGUF 加载、推理、OpenAI-compatible API | 工作区、文件和 Agent 编排 |
| DSH Agent 服务 | 对话、工作区、工具、权限和 Web UI | 加载或执行 GGUF 模型 |
| OpenClaw Gateway（可选） | 独立 Agent、工作区、工具和 Web UI | 仓库核心服务编排；本项目尚未验证其接入本地 GGUF |
| Fleet 中控 | 设备清单、SSH 命令、文件、日志和 MCP | 模型推理、Agent 会话和多设备调度 |
| 系统集成 | 提供方、Base URL、凭据、模型选择和切换 | 安装 DSH 或 `llama-server` |
| systemd | 启停、开机自启、崩溃重启和日志 | 模型配置和 Agent 业务逻辑 |

模型服务与 DSH 是平级组件。默认部署让 DSH 关联本地模型服务，但 DSH 也可以单独接入云端模型。

## 4. 固定版本策略

本项目的核心模型服务和 DSH 以精确版本与 lockfile 保证流程可复现。可选 OpenClaw
目前只固定 Node.js 和主安装包；其传递依赖与 postinstall 文件没有完整锁定，本仓库
不提供安装命令，不能视为可复现的生产部署：

| 组件 | 版本或文件 |
|---|---|
| Node.js | v24.19.0 `linux-riscv64` |
| pnpm | v10.28.0 |
| DSH | `@deepseek-ai/dsh@0.1.0-rc.8` |
| 模型 | `deepseek-r1-distill-qwen-1.5b-q4_0.gguf` |
| OpenClaw（可选） | 主包 `v2026.4.12-riscv64.1`，Node.js v22.22.0；安装保持阻塞 |

固定版本并不等同于上游最新版本。正常部署不自动追踪最新版；升级属于独立运维操作。

## 5. 用户路径

首次使用：

```text
检查硬件与基础环境
→ 选择一键部署或手动部署
→ 确认 8080 与 3080
→ 在 DSH 添加 k3-local 提供方
→ 发送最小对话请求
```

后续使用：

```text
K3 开机
→ systemd 自动启动服务
→ 访问设备建立 SSH 隧道
→ 浏览器访问 DSH
```

## 6. 不在当前范围内的内容

- 公网暴露 3080 或 8080；
- 多用户身份管理、反向代理和 TLS；
- 高可用集群和分布式推理；
- 硬件性能排名、历史测试记录和设备资产清单；
- 自动迁移 DSH 预览版之间的配置。

需要新增这些能力时，应作为独立功能设计，不应混入基础部署流程。
