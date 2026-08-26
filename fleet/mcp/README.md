# Fleet MCP Server

本目录提供 stdio MCP server，不监听常驻 TCP 端口。fleet 的设备操作仍然通过系统
ssh 和 scp 命令执行，设备清单中的密钥路径只在本机使用，密钥文件不入仓库。

## 启动

先准备设备清单：

    cp fleet/devices.yaml.example fleet/devices.yaml

然后将 fleet/mcp/server.mjs 配置到支持 MCP 的 Agent。服务进程的当前工作目录不
影响设备清单路径。

## 工具

默认只注册只读工具：

- fleet_list：读取设备清单。
- fleet_status：通过 SSH 探测可达性。
- fleet_logs：读取远端日志文件末尾。

fleet_exec 和 fleet_push 是写工具，默认不注册。需要明确启用时，将
fleet/mcp/config.yaml 改为：

    write_tools: true

每次写工具调用都会使用 logger 写入 journald，包含实际设备、完整命令和目标主机；
如果无法写入审计日志，写操作会被拒绝。

## DSH 配置示例

在 DSH 的 MCP 配置中加入：

    {
      "mcpServers": {
        "k3-fleet": {
          "command": "/home/USER/k3-agent-server/fleet/mcp/server.mjs"
        }
      }
    }

将 USER 和仓库路径替换为 K3 上的实际值，不要把包含真实密钥的配置提交到仓库。

## Codex CLI 配置示例

    [mcp_servers.k3-fleet]
    command = "/home/USER/k3-agent-server/fleet/mcp/server.mjs"

将 USER 和仓库路径替换为实际值。
