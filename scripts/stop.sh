#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：bash scripts/stop.sh

尝试停止 agent-dsh.service、兼容旧 unit dsh-web.service 和
llama-server.service，并聚合报告停止结果。
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

failed=0

agent_unit_found=0
agent_load_state="$(systemctl --user show agent-dsh.service -p LoadState --value 2>/dev/null || true)"
if [[ -n "$agent_load_state" && "$agent_load_state" != "not-found" ]]; then
  agent_unit_found=1
  if systemctl --user stop agent-dsh.service >/dev/null 2>&1; then
    echo "agent-dsh.service 已停止。"
  else
    echo "注意：agent-dsh.service 停止失败。" >&2
    failed=1
  fi
fi

legacy_load_state="$(systemctl --user show dsh-web.service -p LoadState --value 2>/dev/null || true)"
legacy_unit_id="$(systemctl --user show dsh-web.service -p Id --value 2>/dev/null || true)"
if [[ -n "$legacy_load_state" && "$legacy_load_state" != "not-found" && \
      "$legacy_unit_id" != "agent-dsh.service" ]]; then
  agent_unit_found=1
  if systemctl --user stop dsh-web.service >/dev/null 2>&1; then
    echo "dsh-web.service 已停止。"
  else
    echo "注意：dsh-web.service 停止失败。" >&2
    failed=1
  fi
fi

if (( ! agent_unit_found )); then
  echo "注意：agent-dsh.service 和 dsh-web.service 均不存在。" >&2
  failed=1
fi

if systemctl --user stop llama-server.service >/dev/null 2>&1; then
  echo "llama-server.service 已停止。"
else
  echo "注意：llama-server.service 停止失败或 unit 不存在。" >&2
  failed=1
fi

if (( failed )); then
  echo "K3 AI Server 停止操作未全部成功。" >&2
  exit 1
fi

echo "K3 AI Server 已停止。"
