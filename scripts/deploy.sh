#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
用法：bash scripts/deploy.sh

按固定版本安装模型服务和 DSH Agent，安装 systemd 用户服务并启动：
  Node.js 24.19.0 (linux-riscv64)
  pnpm 10.28.0
  @deepseek-ai/dsh 0.1.0-rc.8
  SpacemiT llama-server
  DeepSeek-R1-Distill-Qwen-1.5B Q4_0

脚本面向运行 Bianbu Linux 的 SpacemiT K3，重复执行不会要求手工迁移。
EOF
}

fail() {
  echo "deploy: $*" >&2
  exit 1
}

run_as_user() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    fail "不要使用 root 执行。请以实际运行服务的普通用户重新运行。"
  fi
}

require_host_tools() {
  [[ "$(uname -s)" == "Linux" ]] || fail "只能在 K3 的 Linux 服务设备上执行。"
  [[ "$(uname -m)" == "riscv64" ]] || fail "当前架构为 $(uname -m)，需要 riscv64。"
  command -v bash >/dev/null || fail "找不到 bash。"
  command -v sudo >/dev/null || fail "找不到 sudo。"
  command -v systemctl >/dev/null || fail "找不到 systemctl。"
  command -v loginctl >/dev/null || fail "找不到 loginctl。"
}

check_sudo() {
  sudo -v || fail "sudo 认证失败；部署尚未停止现有服务。"
}

stop_existing_services() {
  # Reinstalling node_modules while DSH is running can leave the active process
  # on a partially replaced dependency tree. Ignore missing units on first run.
  bash "$PROJECT_DIR/scripts/stop.sh" >/dev/null 2>&1 || true
}

install_services() {
  echo "安装 systemd 用户服务。"
  sudo loginctl enable-linger "$USER"
  bash "$PROJECT_DIR/scripts/install-systemd-user-services.sh"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
elif (( $# > 0 )); then
  usage >&2
  exit 2
fi

run_as_user
require_host_tools
check_sudo
stop_existing_services

bash "$PROJECT_DIR/model/install.sh"
bash "$PROJECT_DIR/agents/dsh/install.sh"
install_services
bash "$PROJECT_DIR/scripts/start.sh"

cat <<'EOF'

部署完成。
  模型 API：http://127.0.0.1:8080/v1
  DSH Web：http://127.0.0.1:3080

下次运行：
  bash scripts/status.sh

如果服务没有运行：
  bash scripts/start.sh
EOF
