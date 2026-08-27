#!/usr/bin/env bash
set -euo pipefail

MODEL_FILE="deepseek-r1-distill-qwen-1.5b-q4_0.gguf"
MODEL_URL="https://archive.spacemit.com/spacemit-ai/model_zoo/llm/${MODEL_FILE}"
MODEL_DIR="$HOME/.cache/models/llm"
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"

usage() {
  cat <<'EOF'
用法：bash model/install.sh

安装 SpacemiT llama-server，下载固定的 DeepSeek-R1-Distill-Qwen-1.5B
Q4_0 GGUF 模型，并校验模型文件。模型服务由顶层 systemd 用户服务启动，
仅监听 127.0.0.1:8080。
EOF
}

fail() {
  echo "模型服务：$*" >&2
  exit 1
}

run_as_user() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    fail "不要使用 root 执行。请以实际运行服务的普通用户重新运行。"
  fi
}

require_k3_linux() {
  [[ "$(uname -s)" == "Linux" ]] || fail "只能在 K3 的 Linux 服务设备上执行。"
  [[ "$(uname -m)" == "riscv64" ]] || fail "当前架构为 $(uname -m)，需要 riscv64。"
  command -v sudo >/dev/null || fail "找不到 sudo。"
  command -v apt >/dev/null || fail "找不到 apt；本流程面向 Bianbu Linux。"
}

install_base_packages() {
  echo "安装基础软件和 SpacemiT llama-server。"
  sudo apt update
  sudo apt install -y build-essential python3 curl xz-utils ca-certificates

  if ! command -v llama-server >/dev/null 2>&1; then
    if ! sudo apt install -y llama.cpp-tools-spacemit; then
      echo "注意：当前软件源没有 llama.cpp-tools-spacemit，尝试旧版包名 llama-server。" >&2
      sudo apt install -y llama-server
    fi
  fi

  command -v curl >/dev/null || fail "curl 安装失败。"
  command -v sha256sum >/dev/null || fail "sha256sum 不可用。"
  command -v llama-server >/dev/null || fail "llama-server 安装后仍不可用。"
}

download_model() {
  echo "下载并检查 GGUF 模型。"
  mkdir -p "$MODEL_DIR"

  if [[ ! -s "$MODEL_PATH" ]]; then
    if ! curl --fail --location --retry 3 --continue-at - \
      "$MODEL_URL" -o "$MODEL_PATH.part"; then
      local remote_size local_size
      remote_size="$(curl --fail --silent --show-error --location --head "$MODEL_URL" \
        | awk 'tolower($1) == "content-length:" { gsub("\r", "", $2); size = $2 } END { print size }' || true)"
      local_size=0
      if [[ -f "$MODEL_PATH.part" ]]; then
        local_size="$(wc -c < "$MODEL_PATH.part" | tr -d '[:space:]')"
      fi
      if [[ -s "$MODEL_PATH.part" && -n "$remote_size" && "$local_size" == "$remote_size" ]]; then
        echo "注意：模型断点文件已完整，跳过 416 续传错误并继续安装。"
      else
        fail "模型下载或断点续传失败；请检查网络，必要时删除 $MODEL_PATH.part 后重试。"
      fi
    fi
    mv "$MODEL_PATH.part" "$MODEL_PATH"
  fi

  [[ -s "$MODEL_PATH" ]] || fail "模型文件为空：$MODEL_PATH"
  local actual_hash recorded_hash
  actual_hash="$(sha256sum "$MODEL_PATH" | awk '{ print $1 }')"
  if [[ -f "$MODEL_PATH.sha256" ]]; then
    recorded_hash="$(awk 'NF { print $1; exit }' "$MODEL_PATH.sha256")"
    [[ "$recorded_hash" == "$actual_hash" ]] || \
      fail "模型 SHA-256 校验失败，文件可能损坏；请删除模型文件和校验记录后重新下载。"
  else
    printf '%s  %s\n' "$actual_hash" "$MODEL_PATH" > "$MODEL_PATH.sha256"
  fi
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
elif (( $# > 0 )); then
  usage >&2
  exit 2
fi

run_as_user
require_k3_linux
install_base_packages
download_model

echo "模型服务安装完成。"
