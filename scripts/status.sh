#!/usr/bin/env bash
set -u

command -v systemctl >/dev/null || {
  echo "找不到 systemctl；请在 K3 Linux 服务设备上执行。" >&2
  exit 1
}

failed=0

show_service() {
  local unit="$1"
  if systemctl --user is-active --quiet "$unit"; then
    echo "$unit: active"
  else
    echo "$unit: inactive"
    failed=1
  fi
}

check_http() {
  local label="$1"
  local url="$2"
  if curl --fail --silent --show-error --max-time 3 "$url" >/dev/null 2>&1; then
    echo "$label: healthy ($url)"
  else
    echo "$label: unavailable ($url)"
    failed=1
  fi
}

show_service llama-server.service
show_service agent-dsh.service
check_http "Model API" "http://127.0.0.1:8080/v1/models"
check_http "DSH Web UI" "http://127.0.0.1:3080/"

exit "$failed"
