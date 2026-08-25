#!/usr/bin/env bash
set -euo pipefail

command -v systemctl >/dev/null || {
  echo "找不到 systemctl；请在 K3 Linux 服务设备上执行。" >&2
  exit 1
}

failed=0

if systemctl --user stop dsh-web.service >/dev/null 2>&1; then
  echo "dsh-web.service 已停止。"
else
  echo "注意：dsh-web.service 停止失败或 unit 不存在。" >&2
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
