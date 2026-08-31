#!/usr/bin/env bash

set -euo pipefail

arch="$(uname -m)"
if [[ "$arch" != "riscv64" ]]; then
  echo "setup-ruyi: 此脚本只用于 K3 riscv64 主机，当前架构：$arch" >&2
  exit 2
fi

state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
state_dir="$state_home/k3-agent-server"
mkdir -p "$state_dir"
log_file="$state_dir/setup-ruyi-$(date -u +%Y%m%dT%H%M%SZ).log"
status_file="$state_dir/ruyi-host-support.txt"
exec > >(tee -a "$log_file") 2>&1

echo "K3 架构：$arch"
echo "安装原生 C 编译环境与 RuyiSDK 包管理器"

missing_tools=()
for tool in cc ar ld curl python3; do
  command -v "$tool" >/dev/null 2>&1 || missing_tools+=("$tool")
done

if [[ "${#missing_tools[@]}" -gt 0 ]]; then
  echo "缺少工具：${missing_tools[*]}"
  sudo_cmd=()
  if [[ "$EUID" -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 || {
      echo "setup-ruyi: 需要 sudo 安装系统包。" >&2
      exit 1
    }
    sudo -v
    sudo_cmd=(sudo)
  fi
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" apt-get install -y build-essential ca-certificates curl python3
else
  echo "原生编译工具已存在，跳过系统包安装。"
fi

export PATH="$HOME/.local/bin:$PATH"
if ! command -v ruyi >/dev/null 2>&1; then
  installer_dir="$(mktemp -d)"
  trap 'rm -rf "$installer_dir"' EXIT
  curl --proto '=https' --tlsv1.2 -fsSL https://ruyisdk.org/install.sh -o "$installer_dir/install-ruyi.sh"
  test -s "$installer_dir/install-ruyi.sh"
  sh "$installer_dir/install-ruyi.sh"
fi

if ! ruyi_version="$(ruyi version 2>&1)"; then
  {
    echo "checked_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "host_arch=$arch"
    echo "ruyi_status=runtime-failed"
    echo "fallback=native-device-compiler"
  } > "$status_file"
  echo "setup-ruyi: riscv64 版 ruyi 无法运行；已保留设备端原生编译环境，详情见 $log_file" >&2
  exit 1
fi

package_index_status="ready"
if ! ruyi update; then
  package_index_status="update-failed"
  echo "setup-ruyi: Ruyi 已可运行，但软件包索引同步失败；本次继续使用设备端原生编译器。" >&2
fi
cc --version | head -n 1
printf '%s\n' "$ruyi_version"

{
  echo "checked_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host_arch=$arch"
  echo "ruyi_status=supported"
  echo "package_index_status=$package_index_status"
  echo "ruyi_binary=$(command -v ruyi)"
  echo "native_compiler=$(command -v cc)"
  echo "verify_python=$(command -v python3)"
} > "$status_file"

echo "RuyiSDK 与设备端原生编译环境已就绪。"
echo "状态：$status_file"
echo "日志：$log_file"
