# 项目约定

本文记录目录、端口、systemd、Agent 配置和 fleet 的稳定约定。新增组件应先遵守
这些约定，再补充自己的部署文档。

## 1. 目录职责

| 目录 | 职责 |
|---|---|
| model/ | llama-server 安装、模型下载和模型服务 unit |
| agents/dsh/ | DSH 安装、兼容层、agent.env 模板和 DSH unit |
| agents/_template/ | 新 Agent 的安装脚本、配置模板和说明模板 |
| fleet/ | 设备清单、fleet CLI 和 fleet MCP |
| scripts/ | 顶层部署、启停、状态和 systemd 安装编排 |
| docs/ | 当前用户手册、架构和项目约定 |

目录名称使用简洁英文名。职责边界由文档说明，不把职责写入目录名。

## 2. 端口分配

| 端口 | 组件 | 状态 |
|---|---|---|
| 8080 | llama-server 模型 API | 使用中 |
| 3080 | DSH Agent Web | 使用中 |
| 3081 | 后续 Agent Web | 预留 |
| 18789 | OpenClaw Gateway | 可选组件使用中 |
| 7080 | Fleet MCP TCP 入口 | 预留；当前使用 stdio |

K3 上的 HTTP 服务默认只绑定 127.0.0.1。访问设备使用 SSH local forwarding，
不能为了方便把监听地址改为 0.0.0.0。

## 3. systemd 命名

- 模型服务固定使用 llama-server.service；
- 新 Agent 使用 agent-<name>.service；
- DSH 的主 unit 是 agent-dsh.service；
- dsh-web.service 是旧部署兼容别名，已有运维命令可以继续使用；
- OpenClaw 默认使用其 CLI 生成的 openclaw-gateway.service，不由顶层安装脚本复制；
- 新 Agent 的 unit 应放在该 Agent 目录的 systemd/ 下，由顶层安装脚本统一复制。

## 4. Agent 配置

每个 Agent 都应提供 agent.env.example，并在安装时创建用户私有的 agent.env。
真实配置不覆盖、不提交模板，实际配置路径由 Agent 文档说明。

本地模型端点统一使用：

    MODEL_BASE_URL=http://127.0.0.1:8080/v1

DSH 当前安装器将配置模板复制到：

    $HOME/.config/k3-agent-server/agents/dsh/agent.env

配置文件权限为 0600。凭据示例只能使用占位值，真实 API Key 由运行时配置界面或
用户私有配置保存。

## 5. 部署入口

一键部署：

    bash scripts/deploy.sh

手动部署：

    bash model/install.sh
    bash agents/dsh/install.sh
    bash scripts/install-systemd-user-services.sh
    bash scripts/start.sh

顶层脚本必须保持幂等。已有旧版 dsh-web.service 的设备再次执行 deploy.sh 时，
脚本会停止旧 unit、安装 agent-dsh.service 并保留 dsh-web.service 别名，不要求手工
迁移。顶层脚本只管理 llama-server 和 DSH；可选 OpenClaw 使用自己的 CLI 独立运维。

## 6. Fleet 安全约定

- 设备清单使用 fleet/devices.yaml，示例使用 fleet/devices.yaml.example；
- 设备条目必须声明 name、host、user、ssh_key、arch、tags 和 enabled；
- fleet 只使用 SSH 私钥，禁止密码认证；
- StrictHostKeyChecking=accept-new 采用首次连接信任（TOFU）策略，首次记录主机密钥，
  后续主机密钥变化时拒绝连接；
- exec、push、pull 和 logs 必须显式指定设备名或 tag:标签；
- tag 没有匹配启用设备时直接失败，不默认选择全部设备；
- 多设备目标当前串行执行；
- pull 使用多设备 tag 时，分别写入 `<dst>/<设备名>/`，避免相互覆盖；
- MCP 写工具默认不注册，只有 fleet/mcp/config.yaml 明确设置
  write_tools: true 才可用；
- 每次 MCP 写工具调用都使用 logger 写入实际设备、完整命令和目标主机。
