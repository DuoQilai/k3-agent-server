#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：bash agents/_template/install.sh

这是新增 Agent 的目录模板，不直接安装 Agent。复制本目录并修改
install.sh、agent.env.example 和 README.md 后，再接入顶层部署脚本。
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
elif (( $# > 0 )); then
  usage >&2
  exit 2
fi

echo "请复制 agents/_template/ 并填写新的 Agent 安装流程。" >&2
exit 1
