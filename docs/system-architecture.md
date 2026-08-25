# 系统架构

## 1. 技术层级

```text
应用层
AI 对话、文件处理、代码任务、自动化任务
                         ↑
系统集成层
提供方、凭据、默认模型、模型选择与切换
                         ↑
Agent 服务层                         模型服务层
DSH / 127.0.0.1:3080      ←→       llama-server / 127.0.0.1:8080
工作区、工具、权限                    GGUF、推理、模型 API
                         ↑
基础环境层
Bianbu、网络、存储、Node.js、pnpm、systemd
                         ↑
硬件层
SpacemiT K3 Pico-ITX
```

## 2. 运行拓扑

```text
访问设备
  └── 127.0.0.1:3080
          │ SSH local forwarding
          ▼
K3 服务设备
  ├── dsh-web.service
  │     └── DSH Web / 127.0.0.1:3080
  │             │ OpenAI-compatible request
  │             ▼
  └── llama-server.service
        └── Model API / 127.0.0.1:8080/v1
              └── DeepSeek GGUF
```

## 3. 端口与接口

| 端口 | 服务 | 监听地址 | 用途 |
|---|---|---|---|
| 3080 | DSH Web | `127.0.0.1` | Web UI 和 Agent 入口 |
| 8080 | `llama-server` | `127.0.0.1` | 本地 OpenAI-compatible 模型 API |

关键检查端点：

- `GET http://127.0.0.1:8080/health`
- `GET http://127.0.0.1:8080/v1/models`
- `GET http://127.0.0.1:3080/`

## 4. 服务依赖

两个服务可以独立安装和检查：

- `llama-server.service` 不依赖 DSH；任何 OpenAI-compatible 客户端都可以调用它。
- `dsh-web.service` 可以调用本地模型，也可以调用云端模型。
- 默认 systemd 配置使用 `Wants=llama-server.service`，启动 DSH 时会尝试同时启动本地模型，但本地模型失败不会强制终止 DSH。
- `scripts/start.sh` 面向完整本地 AI 服务器，会先等待模型 API 就绪，再启动 DSH。

## 5. 数据流

一次本地对话请求的路径是：

```text
浏览器
→ SSH 隧道
→ DSH Web
→ DSH 会话与工具编排
→ k3-local 提供方
→ llama-server /v1/chat/completions
→ GGUF 推理
→ DSH
→ 浏览器
```

工作区文件由 DSH 管理；模型文件由 `llama-server` 读取。两者不应放在同一个运行目录中。

## 6. 进程与日志

正式运行只使用 systemd 用户服务：

```text
systemd --user
├── llama-server.service
└── dsh-web.service
```

- `enable-linger` 使用户服务在没有登录会话时也能随系统启动。
- `Restart=on-failure` 在进程异常退出后自动拉起。
- 日志进入 systemd journal，不使用项目自建 PID 文件或 `nohup` 日志。

## 7. 安全边界

- 3080 和 8080 默认只监听 K3 回环地址。
- 远程访问使用 SSH 隧道，不直接开放服务端口。
- 云端 API Key 只存入 DSH 的凭据配置，不写入仓库、unit 文件或日志。
- `DSH_LOCAL_API_KEY=local` 只是本地 OpenAI-compatible 接口的占位值，不是云端密钥。
- DSH 可以执行文件和 Shell 操作，应只授予需要的工作区和系统权限。
