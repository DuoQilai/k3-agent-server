# 基础环境

## 1. 适用环境

本项目面向运行 Bianbu Linux 的 SpacemiT K3 Pico-ITX。正式部署使用：

- `riscv64` 用户空间；
- `apt` 软件包管理；
- systemd 和 systemd 用户服务；
- 能执行 `sudo` 的普通用户；
- 能访问软件源、Node.js RISC-V 构建站、npm registry 和模型镜像的网络。

不要以 root 用户运行 `scripts/deploy.sh`。DSH 数据、模型和 systemd 用户服务都应属于实际使用该服务的普通用户。

## 2. 环境检查

在 K3 服务设备执行：

```bash
uname -s
uname -m
cat /etc/os-release
id
command -v sudo apt systemctl loginctl curl
df -h "$HOME"
free -h
```

继续部署前应满足：

- `uname -s` 返回 `Linux`；
- `uname -m` 返回 `riscv64`；
- `apt`、`systemctl` 和 `loginctl` 可用；
- 当前用户可以使用 `sudo`；
- 用户主目录有足够空间保存 Node.js、DSH 依赖和约 1 GB 的模型文件。

## 3. 网络检查

```bash
curl -I --max-time 15 https://unofficial-builds.nodejs.org/
curl -I --max-time 15 https://registry.npmjs.org/@deepseek-ai%2Fdsh
curl -I --max-time 15 \
  https://archive.spacemit.com/spacemit-ai/model_zoo/llm/deepseek-r1-distill-qwen-1.5b-q4_0.gguf
```

如果环境通过代理访问网络，在运行部署脚本前设置该网络实际使用的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。`NO_PROXY` 至少应包含 `127.0.0.1,localhost`，避免本地 8080/3080 请求绕到代理。

## 4. 端口检查

```bash
ss -lntp | grep -E ':(3080|8080)\b' || true
```

首次部署时两个端口应未被其他服务占用。如果已有监听进程，先确认归属，不要直接结束所有 Node.js 或模型进程。

## 5. systemd 用户服务

检查当前用户管理器：

```bash
systemctl --user show-environment >/dev/null
```

一键部署会执行：

```bash
sudo loginctl enable-linger "$USER"
```

`enable-linger` 允许当前用户的 systemd 管理器在未登录时继续存在，因此用户服务可以随系统启动。检查状态：

```bash
loginctl show-user "$USER" -p Linger
```

预期显示 `Linger=yes`。

## 6. 基础软件

`scripts/deploy.sh` 会安装：

```text
build-essential
python3
curl
xz-utils
ca-certificates
llama.cpp-tools-spacemit（旧软件源回退到 llama-server）
```

Node.js、pnpm 和 DSH 使用项目固定版本安装到当前用户主目录，不替换系统自带的 Node.js。
