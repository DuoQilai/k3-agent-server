#!/usr/bin/env bash
set -euo pipefail

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="$3"

  while (( attempts > 0 )); do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      echo "$name 已就绪：$url"
      return 0
    fi
    sleep 1
    (( attempts-- ))
  done

  echo "$name 启动超时。查看日志：journalctl --user -u $name -n 100 --no-pager" >&2
  return 1
}

command -v systemctl >/dev/null || {
  echo "找不到 systemctl；请在 K3 Linux 服务设备上执行。" >&2
  exit 1
}
command -v curl >/dev/null || {
  echo "找不到 curl。" >&2
  exit 1
}

systemctl --user start llama-server.service
wait_for_http "llama-server.service" "http://127.0.0.1:8080/health" 90

systemctl --user start dsh-web.service
wait_for_http "dsh-web.service" "http://127.0.0.1:3080/" 60

echo "K3 AI Server 已启动。"
