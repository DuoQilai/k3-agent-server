#!/usr/bin/env bash
set -euo pipefail

K3_IP="${K3_IP:-}"
K3_USER="${K3_USER:-}"
LOCAL_PORT="${LOCAL_PORT:-3080}"
REMOTE_PORT="${REMOTE_PORT:-3080}"

if [[ -z "$K3_IP" || -z "$K3_USER" ]]; then
  echo "用法：K3_IP=<服务设备地址> K3_USER=<用户> $0" >&2
  exit 1
fi

exec ssh -4 -N \
  -L "127.0.0.1:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  "${K3_USER}@${K3_IP}"
