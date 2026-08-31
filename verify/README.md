# RuyiSDK 验证流水线

`verify` 在 K3 服务设备上执行本地构建，再通过 fleet 对目标设备逐台执行
`push → exec → pull → assert`。同一设备由内核文件锁串行保护，一台失败不会阻断标签内
的其他设备。

## 1. K3 准备

RuyiSDK 官方安装文档当前明确提供 Linux `riscv64` 预编译二进制，因此 K3 可以直接
运行 Ruyi 包管理器。`setup-ruyi.sh` 同时安装 `build-essential`，示例优先使用 K3
上的 RISC-V 原生 `cc`，避免在另一架构主机上生成不可运行的产物。

~~~bash
./verify/setup-ruyi.sh
~~~

脚本将实际架构、Ruyi 运行状态、原生编译器和 verify 锁所需的 `python3` 路径记录到：

~~~text
${XDG_STATE_HOME:-$HOME/.local/state}/k3-agent-server/ruyi-host-support.txt
~~~

安装日志写入同目录，不进入仓库。若 Ruyi 二进制实际运行失败，脚本会明确记录
`runtime-failed` 并返回非零；已经安装的系统原生编译器仍可用于设备端编译。若仅软件包
索引同步失败，则记录 `package_index_status=update-failed` 并继续使用原生编译器。网络或
索引失败不等于架构不支持，不能据此下结论。

参考：[RuyiSDK 包管理器安装文档](https://ruyisdk.org/docs/Package-Manager/installation/)。

## 2. 运行示例

先创建 `fleet/devices.yaml`，并确保至少一台启用设备包含 `dev` 标签。示例在 K3 上
静态编译 `verify/examples/hello.c`，上传到目标设备，运行后拉回输出并断言内容。示例会
先检查构建主机确实是 `riscv64`，避免从 macOS/x86_64 误传不可执行产物。

~~~bash
cp fleet/devices.yaml.example fleet/devices.yaml
$EDITOR fleet/devices.yaml
./fleet/bin/fleet ls
./verify/bin/verify run hello
~~~

成功时退出码为 0；任意设备失败时退出码为 1；任务定义或命令用法错误时退出码为 2。

## 3. Job 格式

任务位于 `verify/jobs/<name>.yaml`。当前解析器只接受下面这套受控 YAML 子集：顶层
字段不缩进，映射内容缩进两个空格，不接受制表符、多行字符串或 YAML 锚点。

~~~yaml
target: tag:dev
build: mkdir -p verify/build && cc hello.c -o verify/build/hello
artifacts:
  verify/build/hello: /tmp/hello
run:
  command: chmod +x /tmp/hello && /tmp/hello
  timeout: 30
collect:
  /tmp/output.txt: output.txt
assert:
  exit_code: 0
  output_regex: '^expected output$'
~~~

| 字段 | 含义 |
|---|---|
| `target` | fleet 设备名或 `tag:<标签>` |
| `build` | 在 K3 项目根目录执行的本地 shell 命令 |
| `artifacts` | 仓库内相对路径到设备绝对路径的映射 |
| `run.command` | 设备端由 `sh -c` 执行的命令 |
| `run.timeout` | 每台设备的正整数超时秒数；超时退出码为 124 |
| `collect` | 设备路径到本次报告内相对路径的映射；允许空映射 |
| `assert.exit_code` | 可选，期望的设备端退出码 |
| `assert.output_regex` | 可选，对设备端标准输出进行的 JavaScript 正则匹配 |

`assert` 至少包含一个判据。正则需要使用反斜杠时，优先使用 YAML 单引号。

## 4. 报告与并发

每次运行分配不会覆盖旧结果的序号目录：

~~~text
verify/reports/<job>-<序号>/
├── build.log
├── result.json
└── devices/<设备名>/
    ├── push-1.log
    ├── run.log
    ├── pull-1.log
    ├── assert.log
    └── artifacts/
~~~

`result.json` 记录 build 和每台设备各步骤的起止时间、耗时、退出码、成败、失败步骤及
汇总。`verify/build/` 和 `verify/reports/` 都是本地产物，已由 `.gitignore` 排除。

设备锁位于系统临时目录的 `k3-agent-server-verify-locks/`，由 `python3` 的
`fcntl.flock` 持有。锁被占用时命令会打印排队提示并等待；持锁进程异常退出时由内核
自动释放，不依赖锁文件内容或 PID 清理。构建阶段还使用同目录下的全局构建锁，并将
成功构建的每个 artifact 快照保存到报告的 `build-artifacts/` 后再上传，避免并发任务
覆盖共享的 `verify/build/` 文件。

verify 调用 `fleet exec --json` 获取设备端真实退出码。机器可读结果同时区分设备端退出
码、fleet 进程退出码、超时和 SSH 传输错误，避免把 fleet 的聚合退出码误当成断言输入。

## 5. 本地回归测试

测试使用隔离的临时设备清单和 mock fleet，不接触真实 SSH 配置：

~~~bash
node --test verify/tests/verify.test.mjs
~~~

覆盖多设备成功、错误断言、命令超时、单设备失败后继续执行、同设备并发排队、异常退出
后的锁释放、构建产物快照、非法路径前置校验、`__proto__` 映射，以及 fleet 的远端退出码
与传输错误协议。
