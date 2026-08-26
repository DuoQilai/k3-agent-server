# Agent Template

复制本目录并改成新 Agent 的名称，例如 agents/openclaw/。

- install.sh：安装固定版本的 Agent 和运行时依赖，必须支持 --help。
- agent.env.example：记录该 Agent 的配置模板，不要写入真实密钥。
- README.md：说明安装、启动、访问和配置方式。

新 Agent 使用 agent-<name>.service 命名，端口从 3080 起分配，模型端点通过
自己的 agent.env 指向 http://127.0.0.1:8080/v1。
