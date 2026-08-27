#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_UNIT_SOURCE="$PROJECT_DIR/model/systemd/llama-server.service"
DSH_UNIT_SOURCE="$PROJECT_DIR/agents/dsh/systemd/agent-dsh.service"
DSH_ENV_SOURCE="$PROJECT_DIR/agents/dsh/agent.env.example"
UNIT_TARGET_DIR="$HOME/.config/systemd/user"
AGENT_CONFIG_DIR="$HOME/.config/k3-agent-server/agents/dsh"
AGENT_CONFIG_TARGET="$AGENT_CONFIG_DIR/agent.env"

usage() {
  cat <<'EOF'
用法：bash scripts/install-systemd-user-services.sh

安装 llama-server.service 和 agent-dsh.service，保留 dsh-web.service
兼容别名，并创建 DSH 用户私有的 agent.env 配置。
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
elif (( $# > 0 )); then
  usage >&2
  exit 2
fi

command -v systemctl >/dev/null || {
  echo "找不到 systemctl；请在 K3 Linux 服务设备上执行。" >&2
  exit 1
}

systemctl --user show-environment >/dev/null 2>&1 || {
  echo "当前用户的 systemd --user 管理器不可用。请先建立登录会话后重试。" >&2
  exit 1
}

[[ -f "$MODEL_UNIT_SOURCE" ]] || {
  echo "找不到 llama-server.service。" >&2
  exit 1
}
[[ -f "$DSH_UNIT_SOURCE" ]] || {
  echo "找不到 agent-dsh.service。" >&2
  exit 1
}
[[ -f "$DSH_ENV_SOURCE" ]] || {
  echo "找不到 DSH agent.env 模板。" >&2
  exit 1
}

mkdir -p "$UNIT_TARGET_DIR"
systemctl --user disable dsh-web.service agent-dsh.service >/dev/null 2>&1 || true
install -m 0644 "$MODEL_UNIT_SOURCE" "$UNIT_TARGET_DIR/llama-server.service"
rm -f "$UNIT_TARGET_DIR/dsh-web.service"
install -m 0644 "$DSH_UNIT_SOURCE" "$UNIT_TARGET_DIR/agent-dsh.service"
mkdir -p "$AGENT_CONFIG_DIR"
if [[ ! -f "$AGENT_CONFIG_TARGET" ]]; then
  install -m 0600 "$DSH_ENV_SOURCE" "$AGENT_CONFIG_TARGET"
else
  chmod 0600 "$AGENT_CONFIG_TARGET"
fi

systemctl --user daemon-reload
systemctl --user enable llama-server.service agent-dsh.service
if [[ ! -L "$UNIT_TARGET_DIR/dsh-web.service" ]] || \
   [[ "$(basename "$(readlink "$UNIT_TARGET_DIR/dsh-web.service")")" != "agent-dsh.service" ]]; then
  echo "dsh-web.service 兼容别名安装失败。" >&2
  exit 1
fi

cat <<EOF
systemd 用户服务已安装：
  $UNIT_TARGET_DIR/llama-server.service
  $UNIT_TARGET_DIR/agent-dsh.service
  dsh-web.service -> agent-dsh.service（兼容旧名称）

启动：bash $PROJECT_DIR/scripts/start.sh
状态：bash $PROJECT_DIR/scripts/status.sh
日志：journalctl --user -u llama-server.service -u agent-dsh.service -f
EOF
