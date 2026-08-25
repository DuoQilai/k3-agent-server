#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="24.19.0"
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-riscv64.tar.xz"
NODE_BASE_URL="https://unofficial-builds.nodejs.org/download/release/v${NODE_VERSION}"
PNPM_VERSION="10.28.0"
DSH_VERSION="0.1.0-rc.8"
MODEL_FILE="deepseek-r1-distill-qwen-1.5b-q4_0.gguf"
MODEL_URL="https://archive.spacemit.com/spacemit-ai/model_zoo/llm/${MODEL_FILE}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_INSTALL_DIR="$HOME/.local/node-v${NODE_VERSION}-linux-riscv64"
NODE_LINK="$HOME/.local/node"
NODE_BIN="$HOME/.local/bin/node"
PNPM_PREFIX="$HOME/.local/pnpm10"
PNPM_BIN="$PNPM_PREFIX/node_modules/.bin/pnpm"
DSH_RUNTIME_DIR="$HOME/dsh-runtime"
DSH_BIN="$DSH_RUNTIME_DIR/node_modules/.bin/dsh"
LOCKFILE_SOURCE="$PROJECT_DIR/scripts/dsh-runtime/pnpm-lock.yaml"
COMPAT_SOURCE="$PROJECT_DIR/scripts/dsh-fetch-https-compat.mjs"
COMPAT_TARGET="$HOME/dsh-fetch-https-compat.mjs"
MODEL_DIR="$HOME/.cache/models/llm"
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"

usage() {
  cat <<'EOF'
Usage: bash scripts/deploy.sh

Install the fixed K3 AI server baseline and start both user services:
  Node.js 24.19.0 (linux-riscv64)
  pnpm 10.28.0
  @deepseek-ai/dsh 0.1.0-rc.8
  SpacemiT llama-server
  DeepSeek-R1-Distill-Qwen-1.5B Q4_0

The script is intended for a SpacemiT K3 device running Bianbu Linux. It uses
sudo for apt and loginctl, downloads about 1 GB of model data, and can be run
again to repair or verify the same fixed deployment.
EOF
}

fail() {
  echo "deploy: $*" >&2
  exit 1
}

run_as_user() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    fail "不要使用 root 执行。请以实际运行 DSH 的普通用户重新运行。"
  fi
}

require_k3_linux() {
  [[ "$(uname -s)" == "Linux" ]] || fail "只能在 K3 的 Linux 服务设备上执行。"
  [[ "$(uname -m)" == "riscv64" ]] || fail "当前架构为 $(uname -m)，需要 riscv64。"
  command -v sudo >/dev/null || fail "找不到 sudo。"
  command -v apt >/dev/null || fail "找不到 apt；本流程面向 Bianbu Linux。"
  command -v systemctl >/dev/null || fail "找不到 systemctl。"
  command -v loginctl >/dev/null || fail "找不到 loginctl。"
}

stop_existing_services() {
  # Reinstalling node_modules while DSH is running can leave the active process
  # on a partially replaced dependency tree. Ignore missing units on first run.
  systemctl --user stop dsh-web.service >/dev/null 2>&1 || true
  systemctl --user stop llama-server.service >/dev/null 2>&1 || true
}

install_base_packages() {
  echo "[1/7] 安装基础软件和 SpacemiT llama-server"
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

install_node() {
  echo "[2/7] 安装 Node.js v${NODE_VERSION}"

  if [[ ! -x "$NODE_INSTALL_DIR/bin/node" ]] || \
     [[ "$("$NODE_INSTALL_DIR/bin/node" --version 2>/dev/null || true)" != "v${NODE_VERSION}" ]]; then
    local temp_dir archive checksum_file expected actual
    temp_dir="$(mktemp -d)"
    archive="$temp_dir/$NODE_ARCHIVE"
    checksum_file="$temp_dir/SHASUMS256.txt"
    trap 'rm -rf "$temp_dir"' EXIT

    curl --fail --location --retry 3 \
      "$NODE_BASE_URL/$NODE_ARCHIVE" -o "$archive"
    curl --fail --location --retry 3 \
      "$NODE_BASE_URL/SHASUMS256.txt" -o "$checksum_file"

    expected="$(awk -v file="$NODE_ARCHIVE" '$2 == file { print $1 }' "$checksum_file")"
    [[ -n "$expected" ]] || fail "校验清单中找不到 $NODE_ARCHIVE。"
    actual="$(sha256sum "$archive" | awk '{ print $1 }')"
    [[ "$actual" == "$expected" ]] || fail "Node.js SHA-256 校验失败。"

    mkdir -p "$HOME/.local"
    tar -xJf "$archive" -C "$HOME/.local"
    trap - EXIT
    rm -rf "$temp_dir"
  fi

  mkdir -p "$HOME/.local/bin"
  ln -sfn "$NODE_INSTALL_DIR" "$NODE_LINK"
  for command_name in node npm npx corepack; do
    ln -sfn "$NODE_LINK/bin/$command_name" "$HOME/.local/bin/$command_name"
  done

  [[ "$($NODE_BIN --version)" == "v${NODE_VERSION}" ]] || fail "Node.js 版本验证失败。"
  [[ "$($NODE_BIN -p 'process.arch')" == "riscv64" ]] || fail "Node.js 架构验证失败。"
}

install_pnpm() {
  echo "[3/7] 安装 pnpm v${PNPM_VERSION}"
  export PATH="$HOME/.local/bin:$PATH"
  "$HOME/.local/bin/npm" install \
    --prefix "$PNPM_PREFIX" \
    --registry=https://registry.npmjs.org \
    --save-exact "pnpm@${PNPM_VERSION}"

  [[ -x "$PNPM_BIN" ]] || fail "pnpm 安装失败。"
  [[ "$($PNPM_BIN --version)" == "$PNPM_VERSION" ]] || fail "pnpm 版本验证失败。"
}

install_dsh() {
  echo "[4/7] 安装 DSH v${DSH_VERSION}"
  mkdir -p "$DSH_RUNTIME_DIR"

  if [[ -f "$DSH_RUNTIME_DIR/package.json" ]] && \
     ! grep -q '"name"[[:space:]]*:[[:space:]]*"k3-dsh-runtime"' "$DSH_RUNTIME_DIR/package.json"; then
    fail "$DSH_RUNTIME_DIR 已包含其他 Node.js 项目；请先备份并移走该目录。"
  fi

  cat > "$DSH_RUNTIME_DIR/package.json" <<EOF
{
  "name": "k3-dsh-runtime",
  "private": true,
  "packageManager": "pnpm@${PNPM_VERSION}",
  "dependencies": {
    "@deepseek-ai/dsh": "${DSH_VERSION}"
  }
}
EOF

  cat > "$DSH_RUNTIME_DIR/pnpm-workspace.yaml" <<'EOF'
# Managed by spacemit-k3-ai-server.
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  '@google/genai': true
  koffi: true
  node-pty: true
  protobufjs: true
EOF

  export PATH="$PNPM_PREFIX/node_modules/.bin:$HOME/.local/bin:$PATH"
  export npm_config_nodedir="$NODE_LINK"
  local -a pnpm_install_args=(
    --registry=https://registry.npmjs.org
    --frozen-lockfile=false
  )
  if [[ -f "$LOCKFILE_SOURCE" ]]; then
    install -m 0644 "$LOCKFILE_SOURCE" "$DSH_RUNTIME_DIR/pnpm-lock.yaml"
    pnpm_install_args=(
      --registry=https://registry.npmjs.org
      --frozen-lockfile
    )
    echo "使用仓库 lockfile：$LOCKFILE_SOURCE"
  fi

  "$PNPM_BIN" --dir "$DSH_RUNTIME_DIR" install "${pnpm_install_args[@]}"
  "$PNPM_BIN" --dir "$DSH_RUNTIME_DIR" rebuild

  [[ -x "$DSH_BIN" ]] || fail "DSH CLI 安装失败。"
  [[ "$($DSH_BIN --version)" == "$DSH_VERSION" ]] || fail "DSH 版本不是 $DSH_VERSION。"

  if ! find "$DSH_RUNTIME_DIR/node_modules" -path '*/build/Release/pty.node' -type f -print -quit | grep -q .; then
    fail "node-pty 原生模块未生成，请检查编译器和 pnpm 构建日志。"
  fi

  "$NODE_BIN" --expose-internals \
    "$DSH_RUNTIME_DIR/node_modules/@deepseek-ai/dsh/lib/bin.js" web --help >/dev/null

  if [[ ! -f "$LOCKFILE_SOURCE" ]]; then
    echo "提示：首次部署成功后建议将生成的 lockfile 提交回仓库：$DSH_RUNTIME_DIR/pnpm-lock.yaml" >&2
  fi
}

install_compat_layer() {
  echo "[5/7] 安装 K3 HTTP(S) 兼容层"
  [[ -f "$COMPAT_SOURCE" ]] || fail "找不到兼容层：$COMPAT_SOURCE"
  install -m 0644 "$COMPAT_SOURCE" "$COMPAT_TARGET"
}

download_model() {
  echo "[6/7] 下载并检查 GGUF 模型"
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

install_services() {
  echo "[7/7] 安装并启动 systemd 用户服务"
  sudo loginctl enable-linger "$USER"
  bash "$PROJECT_DIR/scripts/install-systemd-user-services.sh"
  bash "$PROJECT_DIR/scripts/start.sh"
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
stop_existing_services
install_base_packages
install_node
install_pnpm
install_dsh
install_compat_layer
download_model
install_services

cat <<'EOF'

部署完成。
  模型 API：http://127.0.0.1:8080/v1
  DSH Web：http://127.0.0.1:3080

下次登录后只需执行：
  bash scripts/status.sh

如果服务没有运行：
  bash scripts/start.sh
EOF
