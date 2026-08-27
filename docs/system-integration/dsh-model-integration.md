# DeepSeek Harness 模型接入与切换

本文负责把已经运行的 DSH 与本地或云端模型提供方连接起来。它不安装 DSH，也不安装模型服务。

```text
DSH
→ 提供方
→ 凭据
→ 模型
→ 默认选择与会话选择
→ 最小请求验证
```

## 1. 模型接入说明

### 1.1 接入前提

在 K3 服务设备执行：

```bash
bash scripts/status.sh
curl -fsS http://127.0.0.1:8080/v1/models
```

然后在访问设备通过 SSH 隧道打开 <http://127.0.0.1:3080>。

### 1.2 配置对象

DSH 中需要区分三个对象：

| 对象 | 作用 | 示例 |
|---|---|---|
| Provider | 定义 API 地址和协议 | `k3-local` |
| Credential | 保存 API Key 或登录凭据 | 本地占位值 `local` |
| Model | 定义实际模型 ID 和能力 | `deepseek-r1-distill-qwen-1.5b-q4_0.gguf` |

同一个提供方可以包含多个模型；同一个 DSH 可以同时配置本地和云端提供方。

## 2. 提供方与凭据

### 2.1 打开模型设置

在 DSH Web UI 中进入：

```text
Settings
→ Models
→ Add a custom provider
```

不同预览版的按钮文字可能略有变化，但应从 Models 页面添加自定义 OpenAI-compatible 提供方。

### 2.2 Provider ID

本地提供方使用：

```text
k3-local
```

Provider ID 使用小写字母和连字符。创建后不要随意修改，因为会话和模型记录可能引用该 ID。

### 2.3 凭据

本地 `llama-server` 默认没有 API Key 校验，但 DSH 的自定义提供方表单可能要求填写凭据。此时填写占位值：

```text
local
```

该值不是云端 API Key。接入云端服务时，应在 DSH 的凭据界面保存真实 API Key；不要把密钥写入仓库、systemd unit、命令历史、截图或日志。

如果提供方支持账号登录，可使用 DSH 当前版本提供的登录入口；如果只支持 API Key，不要把账号密码当作 API Key 填入。

## 3. 添加模型

### 3.1 自动获取模型

本地提供方创建后，优先点击：

```text
Fetch available models
```

该操作对应模型服务的 `GET /v1/models`。在 K3 上可先查看实际响应：

```bash
curl -fsS http://127.0.0.1:8080/v1/models
```

### 3.2 手动添加模型

自动获取失败时，复制 `/v1/models` 返回对象中的 `id`，不要只凭文件名猜测。

当前固定部署的预期模型 ID 是：

```text
deepseek-r1-distill-qwen-1.5b-q4_0.gguf
```

如果接口返回值不同，以实际 `id` 为准。

### 3.3 模型参数

当前本地服务以 `-c 2048` 启动，建议在 DSH 中使用：

| 配置项 | 值 |
|---|---|
| Context window | `2048` |
| Max output tokens | `512` 或更小 |
| Protocol | `openai-completions` |

为模型列表配置 `2048` 以上的上下文窗口不会扩大服务端实际能力。

## 4. 选择与切换模型

### 4.1 选择默认模型

在 DSH 的模型选择器中选择 `k3-local` 下的模型。该选择用于后续新会话的默认模型。

### 4.2 切换当前会话模型

打开会话顶部或输入区域附近的模型选择器，选择目标提供方和模型。切换后建议新建一个短会话再验证，因为已有会话可能继续保留创建时记录的模型。

### 4.3 在本地与云端之间切换

切换模型只改变 DSH 的请求目标，不需要重新安装 DSH：

```text
DSH
├── k3-local / 本地 DeepSeek
├── deepseek-cloud / 云端 DeepSeek
└── other-provider / 其他 OpenAI-compatible 服务
```

每个提供方应分别维护 Base URL、协议、模型 ID 和凭据，不能共用不相关的 API Key。

## 5. 本地模型接入

### 5.1 固定配置

| 字段 | 值 |
|---|---|
| Provider ID | `k3-local` |
| Base URL | `http://127.0.0.1:8080/v1` |
| Protocol | `openai-completions` |
| Credential | `local` |
| Model ID | 以 `/v1/models` 返回值为准 |
| Context window | `2048` |
| Max output tokens | `512` |

这里的 `127.0.0.1` 指 K3 服务设备，因为 DSH 和 `llama-server` 都运行在 K3 上。不要把 Base URL 写成访问设备的 127.0.0.1。

### 5.2 兼容参数

如果 DSH 的模型配置界面提供兼容选项，当前 `llama-server` 建议设置：

```yaml
supportsDeveloperRole: false
maxTokensField: max_tokens
```

- `supportsDeveloperRole: false`：避免向不支持 developer role 的接口发送该角色。
- `maxTokensField: max_tokens`：使用当前 OpenAI-compatible 接口接受的输出长度字段。

如果当前 rc.8 界面没有这些字段，先使用默认值完成最小请求；只有日志明确显示角色或 token 字段不兼容时，再编辑对应提供方配置。不要根据其他 DSH 版本的目录结构盲改文件。

## 6. 云端及其他模型接入

### 6.1 云端提供方

新增云端提供方时，至少确认：

1. 服务商提供的准确 Base URL；
2. DSH 当前版本支持的协议；
3. 账号登录或 API Key 的实际认证方式；
4. 服务端返回的模型 ID；
5. 上下文和最大输出限制。

云端模型不依赖本地 8080，但仍需要 DSH 服务和 K3 外网连接。

### 6.2 其他本地模型

新增 K3 本地 Qwen 或其他 GGUF 时，可以复用 8080 服务，也可以为不同模型建立独立端口。每个端口应对应清晰的 provider ID，避免模型 ID 相同但后端不同。

## 7. 验证与故障排查

### 7.1 最小验证

每次添加或切换模型后：

1. 新建会话；
2. 确认选择器显示目标 provider 和 model；
3. 发送“只回复 OK”；
4. 确认收到正常响应；
5. 再测试文件或工具任务。

HTTP 200 只能证明页面存在，不能证明模型调用成功。

### 7.2 分层检查

```bash
# 模型服务
curl -fsS http://127.0.0.1:8080/v1/models

# DSH 页面
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/

# 服务日志
journalctl --user -u llama-server.service -n 100 --no-pager
journalctl --user -u agent-dsh.service -n 100 --no-pager
```

### 7.3 常见问题

| 现象 | 处理 |
|---|---|
| Fetch available models 为空 | 检查 Base URL 是否包含 `/v1`，再直接请求 `/v1/models` |
| 模型 ID 不存在 | 使用 `/v1/models` 返回的实际 `id` |
| 页面正常但请求失败 | 分别查看模型服务和 DSH journal |
| 400：角色不支持 | 设置 `supportsDeveloperRole: false` |
| token 字段错误 | 设置 `maxTokensField: max_tokens` |
| 上下文超限 | 减少历史、输入和工具描述，或使用更大上下文的服务配置 |
| Node HTTP 解析错误 | 确认 DSH unit 已加载 K3 兼容层 |
| 切换后仍使用旧模型 | 新建会话并再次确认模型选择器 |

服务启停和日志的完整步骤见[运维手册](../operations-manual.md)。
