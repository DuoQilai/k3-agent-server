#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SOURCE_DIR="$PROJECT_DIR/scripts/systemd"
UNIT_TARGET_DIR="$HOME/.config/systemd/user"

command -v systemctl >/dev/null || {
  echo "找不到 systemctl；请在 K3 Linux 服务设备上执行。" >&2
  exit 1
}

systemctl --user show-environment >/dev/null 2>&1 || {
  echo "当前用户的 systemd --user 管理器不可用。请先建立登录会话后重试。" >&2
  exit 1
}

[[ -f "$UNIT_SOURCE_DIR/llama-server.service" ]] || {
  echo "找不到 llama-server.service。" >&2
  exit 1
}
[[ -f "$UNIT_SOURCE_DIR/dsh-web.service" ]] || {
  echo "找不到 dsh-web.service。" >&2
  exit 1
}

mkdir -p "$UNIT_TARGET_DIR"
install -m 0644 "$UNIT_SOURCE_DIR/llama-server.service" "$UNIT_TARGET_DIR/llama-server.service"
install -m 0644 "$UNIT_SOURCE_DIR/dsh-web.service" "$UNIT_TARGET_DIR/dsh-web.service"

systemctl --user daemon-reload
systemctl --user enable llama-server.service dsh-web.service

cat <<EOF
systemd 用户服务已安装：
  $UNIT_TARGET_DIR/llama-server.service
  $UNIT_TARGET_DIR/dsh-web.service

启动：bash $PROJECT_DIR/scripts/start.sh
状态：bash $PROJECT_DIR/scripts/status.sh
日志：journalctl --user -u llama-server.service -u dsh-web.service -f
EOF
