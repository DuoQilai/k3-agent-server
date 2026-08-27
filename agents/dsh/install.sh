#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_VERSION="24.19.0"
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-riscv64.tar.xz"
NODE_BASE_URL="https://unofficial-builds.nodejs.org/download/release/v${NODE_VERSION}"
PNPM_VERSION="10.28.0"
DSH_VERSION="0.1.0-rc.8"
NODE_INSTALL_DIR="$HOME/.local/node-v${NODE_VERSION}-linux-riscv64"
NODE_LINK="$HOME/.local/node"
NODE_BIN="$HOME/.local/bin/node"
PNPM_PREFIX="$HOME/.local/pnpm10"
PNPM_BIN="$PNPM_PREFIX/node_modules/.bin/pnpm"
DSH_RUNTIME_DIR="$HOME/dsh-runtime"
DSH_BIN="$DSH_RUNTIME_DIR/node_modules/.bin/dsh"
LOCKFILE_SOURCE="$PROJECT_DIR/agents/dsh/pnpm-lock.yaml"
COMPAT_SOURCE="$PROJECT_DIR/agents/dsh/dsh-fetch-https-compat.mjs"
COMPAT_TARGET="$HOME/dsh-fetch-https-compat.mjs"
AGENT_CONFIG_SOURCE="$PROJECT_DIR/agents/dsh/agent.env.example"
AGENT_CONFIG_DIR="$HOME/.config/k3-agent-server/agents/dsh"
AGENT_CONFIG_TARGET="$AGENT_CONFIG_DIR/agent.env"

usage() {
  cat <<'EOF'
用法：bash agents/dsh/install.sh

安装固定版本的 Node.js、pnpm 和 DeepSeek Harness，部署 K3 HTTP(S) 兼容层，
并创建 DSH 的本地 agent.env 配置。DSH 服务由顶层 systemd 用户服务启动，
仅监听 127.0.0.1:3080。
EOF
}

fail() {
  echo "DSH：$*" >&2
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

install_node() {
  echo "安装 Node.js v${NODE_VERSION}。"

  if [[ ! -x "$NODE_INSTALL_DIR/bin/node" ]] || \
     [[ "$("$NODE_INSTALL_DIR/bin/node" --version 2>/dev/null || true)" != "v${NODE_VERSION}" ]]; then
    local temp_dir archive checksum_file expected actual
    temp_dir="$(mktemp -d)"
    archive="$temp_dir/$NODE_ARCHIVE"
    checksum_file="$temp_dir/SHASUMS256.txt"
    trap 'rm -rf "${temp_dir:-}"' EXIT

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

  [[ "$("$NODE_BIN" --version)" == "v${NODE_VERSION}" ]] || fail "Node.js 版本验证失败。"
  [[ "$("$NODE_BIN" -p 'process.arch')" == "riscv64" ]] || fail "Node.js 架构验证失败。"
}

install_pnpm() {
  echo "安装 pnpm v${PNPM_VERSION}。"
  export PATH="$HOME/.local/bin:$PATH"
  "$HOME/.local/bin/npm" install \
    --prefix "$PNPM_PREFIX" \
    --registry=https://registry.npmjs.org \
    --save-exact "pnpm@${PNPM_VERSION}"

  [[ -x "$PNPM_BIN" ]] || fail "pnpm 安装失败。"
  [[ "$("$PNPM_BIN" --version)" == "$PNPM_VERSION" ]] || fail "pnpm 版本验证失败。"
}

install_dsh() {
  echo "安装 DSH v${DSH_VERSION}。"
  mkdir -p "$DSH_RUNTIME_DIR"

  if [[ -f "$DSH_RUNTIME_DIR/package.json" ]]; then
    if ! grep -q '"name"[[:space:]]*:[[:space:]]*"k3-dsh-runtime"' "$DSH_RUNTIME_DIR/package.json" && \
       ! (grep -q '"name"[[:space:]]*:[[:space:]]*"dsh-runtime"' "$DSH_RUNTIME_DIR/package.json" && \
          grep -q '"@deepseek-ai/dsh"[[:space:]]*:' "$DSH_RUNTIME_DIR/package.json"); then
      fail "$DSH_RUNTIME_DIR 已包含其他 Node.js 项目；部署已停止以避免覆盖。"
    fi
    if grep -q '"name"[[:space:]]*:[[:space:]]*"dsh-runtime"' "$DSH_RUNTIME_DIR/package.json"; then
      echo "检测到旧 DSH runtime，将按当前固定版本收敛。"
    fi
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
# Managed by k3-agent-server.
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
  [[ "$("$DSH_BIN" --version)" == "$DSH_VERSION" ]] || fail "DSH 版本不是 $DSH_VERSION。"

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
  echo "安装 K3 HTTP(S) 兼容层。"
  [[ -f "$COMPAT_SOURCE" ]] || fail "找不到兼容层：$COMPAT_SOURCE"
  install -m 0644 "$COMPAT_SOURCE" "$COMPAT_TARGET"
}

install_agent_config() {
  echo "安装 DSH agent.env 配置。"
  [[ -f "$AGENT_CONFIG_SOURCE" ]] || fail "找不到 DSH 配置模板：$AGENT_CONFIG_SOURCE"
  mkdir -p "$AGENT_CONFIG_DIR"
  if [[ ! -f "$AGENT_CONFIG_TARGET" ]]; then
    install -m 0600 "$AGENT_CONFIG_SOURCE" "$AGENT_CONFIG_TARGET"
  else
    chmod 0600 "$AGENT_CONFIG_TARGET"
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
install_node
install_pnpm
install_dsh
install_compat_layer
install_agent_config

echo "DSH 安装完成。"
