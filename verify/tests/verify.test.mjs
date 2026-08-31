import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const VERIFY_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERIFY_BIN = path.join(VERIFY_DIR, "bin", "verify");
const FLEET_BIN = path.join(path.dirname(VERIFY_DIR), "fleet", "bin", "fleet");
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "k3-verify-test-"));
const jobsDir = path.join(temporaryDir, "jobs");
const reportsDir = path.join(temporaryDir, "reports");
const locksDir = path.join(temporaryDir, "locks");
const remoteDir = path.join(temporaryDir, "remote");
const devicesPath = path.join(temporaryDir, "devices.yaml");
const mockFleet = path.join(temporaryDir, "mock-fleet.mjs");
const fakeSshDir = path.join(temporaryDir, "bin");
const fakeSsh = path.join(fakeSshDir, "ssh");
const fleetDevicesPath = path.join(temporaryDir, "fleet-devices.yaml");
const fleetKey = path.join(temporaryDir, "test-key");

fs.mkdirSync(jobsDir, { recursive: true });
fs.mkdirSync(fakeSshDir, { recursive: true });
fs.writeFileSync(fleetKey, "test key placeholder\n");
fs.writeFileSync(devicesPath, [
  "devices:",
  "  - name: dev-1",
  "    host: 192.0.2.1",
  "    user: test",
  "    ssh_key: /tmp/test-key",
  "    arch: riscv64",
  "    tags: [dev]",
  "    enabled: true",
  "  - name: dev-2",
  "    host: 192.0.2.2",
  "    user: test",
  "    ssh_key: /tmp/test-key",
  "    arch: riscv64",
  "    tags: [dev]",
  "    enabled: true",
  "",
].join("\n"));
fs.writeFileSync(mockFleet, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [command, device, ...args] = process.argv.slice(2);
const root = process.env.MOCK_FLEET_ROOT;
const remotePath = (name, value) => path.join(root, name, value.replace(/^\\/+/, ""));
const json = (value) => process.stdout.write(JSON.stringify({
  schema_version: 1,
  device,
  exit_code: Object.hasOwn(value, "exit_code") ? value.exit_code : 0,
  process_exit_code: Object.hasOwn(value, "process_exit_code") ? value.process_exit_code : 0,
  timed_out: value.timed_out ?? false,
  transport_error: value.transport_error ?? false,
  signal: null,
  error: value.error ?? null,
  stdout: value.stdout ?? "",
  stderr: value.stderr ?? "",
}) + "\\n");
if (command === "push") {
  const [source, destination] = args;
  if (process.env.MOCK_FLEET_FAIL_DEVICE === device) process.exit(1);
  const target = remotePath(device, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
} else if (command === "exec") {
  const active = path.join(root, "active-" + device);
  try {
    fs.mkdirSync(active);
  } catch {
    fs.writeFileSync(path.join(root, "violation"), "concurrent device execution\\n");
    json({ exit_code: 3, stdout: "", stderr: "concurrent device execution\\n" });
    process.exit(1);
  }
  const wait = Number(process.env.MOCK_FLEET_DELAY_MS || 0);
  try {
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (process.env.MOCK_FLEET_TRANSPORT_ERROR === "true") {
      json({ exit_code: null, process_exit_code: 1, transport_error: true, stdout: "forced exit\\n", error: "connection refused" });
      process.exitCode = 1;
    } else if (process.env.MOCK_FLEET_TIMEOUT === "true") {
      json({ exit_code: null, timed_out: true, process_exit_code: 1 });
      process.exitCode = 1;
    } else {
      const artifact = remotePath(device, "/tmp/shared.bin");
      const output = fs.existsSync(artifact)
        ? "artifact:" + fs.readFileSync(artifact, "utf8") + "\\n"
        : "Hello from " + device + "\\n";
      const target = remotePath(device, "/tmp/verify-output.txt");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, output);
      const forcedExit = process.env.MOCK_FLEET_EXIT_CODE;
      json({ stdout: forcedExit ? "forced exit\\n" : output, exit_code: forcedExit ? Number(forcedExit) : 0, process_exit_code: forcedExit ? 1 : 0 });
      if (forcedExit) process.exitCode = 1;
    }
  } finally {
    fs.rmSync(active, { recursive: true, force: true });
  }
} else if (command === "pull") {
  const [source, destination] = args;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(remotePath(device, source), destination);
} else {
  process.exit(2);
}
`);
fs.chmodSync(mockFleet, 0o755);

fs.writeFileSync(fleetDevicesPath, [
  "devices:",
  "  - name: dev-1",
  "    host: 192.0.2.1",
  "    user: test",
  "    ssh_key: " + fleetKey,
  "    arch: riscv64",
  "    tags: [dev]",
  "    enabled: true",
  "",
].join("\n"));
fs.writeFileSync(fakeSsh, `#!/usr/bin/env bash
set -eu
case "\${MOCK_SSH_MODE:-exit7}" in
  exit7)
    printf 'remote output\\n__FLEET_REMOTE_EXIT__7\\n'
    ;;
  failure)
    printf 'ssh: connection refused\\n' >&2
    exit 255
    ;;
  timeout)
    sleep 2
    ;;
  execute)
    eval "\${!#}"
    ;;
esac
`);
fs.chmodSync(fakeSsh, 0o755);

after(() => fs.rmSync(temporaryDir, { recursive: true, force: true }));

function writeJob(name, target, regex) {
  fs.writeFileSync(path.join(jobsDir, name + ".yaml"), [
    "target: " + target,
    "build: test -f verify/examples/hello.c",
    "artifacts:",
    "  verify/examples/hello.c: /tmp/hello.c",
    "run:",
    "  command: ignored-by-mock",
    "  timeout: 5",
    "collect:",
    "  /tmp/verify-output.txt: output.txt",
    "assert:",
    "  exit_code: 0",
    "  output_regex: '" + regex + "'",
    "",
  ].join("\n"));
}

function environment(extra = {}) {
  return {
    ...process.env,
    VERIFY_JOBS_DIR: jobsDir,
    VERIFY_REPORTS_DIR: reportsDir,
    VERIFY_DEVICES_PATH: devicesPath,
    VERIFY_FLEET_BIN: mockFleet,
    VERIFY_LOCK_DIR: locksDir,
    MOCK_FLEET_ROOT: remoteDir,
    ...extra,
  };
}

function runVerify(name, extra = {}) {
  return spawnSync(VERIFY_BIN, ["run", name], { encoding: "utf8", env: environment(extra) });
}

function runVerifyAsync(name, extra = {}) {
  const child = spawn(VERIFY_BIN, ["run", name], { env: environment(extra) });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function waitForStdout(child, needle, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("等待输出超时：" + needle)), timeoutMs);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(needle)) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve(output);
      }
    };
    child.stdout.on("data", onData);
  });
}

function writeArtifactJob(name, marker) {
  fs.writeFileSync(path.join(jobsDir, name + ".yaml"), [
    "target: dev-1",
    "build: mkdir -p verify/build && printf '" + marker + "' > verify/build/shared.bin",
    "artifacts:",
    "  verify/build/shared.bin: /tmp/shared.bin",
    "run:",
    "  command: cat /tmp/shared.bin",
    "  timeout: 5",
    "collect:",
    "  /tmp/verify-output.txt: output.txt",
    "assert:",
    "  exit_code: 0",
    "  output_regex: '^artifact:" + marker + "$'",
    "",
  ].join("\n"));
}

function writeExitJob(name, expectedExit, regex = "^forced exit$") {
  fs.writeFileSync(path.join(jobsDir, name + ".yaml"), [
    "target: dev-1",
    "build: test -f verify/examples/hello.c",
    "artifacts:",
    "  verify/examples/hello.c: /tmp/hello.c",
    "run:",
    "  command: ignored-by-mock",
    "  timeout: 5",
    "collect:",
    "  /tmp/verify-output.txt: output.txt",
    "assert:",
    "  exit_code: " + expectedExit,
    "  output_regex: '" + regex + "'",
    "",
  ].join("\n"));
}

function runFleet(mode) {
  return spawnSync(FLEET_BIN, [
    "exec", "dev-1", "--json", "--timeout", "1", "--", "printf", "ignored",
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      FLEET_DEVICES_PATH: fleetDevicesPath,
      PATH: fakeSshDir + ":" + process.env.PATH,
      MOCK_SSH_MODE: mode,
    },
  });
}

function readOnlyReport(name) {
  const matches = fs.readdirSync(reportsDir).filter((entry) => entry.startsWith(name + "-"));
  assert.equal(matches.length, 1);
  return JSON.parse(fs.readFileSync(path.join(reportsDir, matches[0], "result.json"), "utf8"));
}

test("多设备任务逐台成功并收集报告", () => {
  writeJob("success", "tag:dev", "^Hello from dev-[12]$");
  const run = runVerify("success");
  assert.equal(run.status, 0, run.stderr);
  const report = readOnlyReport("success");
  assert.equal(report.success, true);
  assert.deepEqual(report.summary, { total: 2, passed: 2, failed: 0 });
  for (const device of report.devices) {
    assert.equal(device.success, true);
    assert.equal(device.assert.success, true);
  }
});

test("改坏输出断言时返回非零并标记 assert", () => {
  writeJob("bad-assert", "tag:dev", "^never-matches$");
  const run = runVerify("bad-assert");
  assert.equal(run.status, 1);
  const report = readOnlyReport("bad-assert");
  assert.equal(report.success, false);
  assert.ok(report.devices.every((device) => device.failed_step === "assert"));
});

test("单台 push 失败不阻断其余设备", () => {
  writeJob("partial-failure", "tag:dev", "^Hello from dev-[12]$");
  const run = runVerify("partial-failure", { MOCK_FLEET_FAIL_DEVICE: "dev-1" });
  assert.equal(run.status, 1);
  const report = readOnlyReport("partial-failure");
  assert.equal(report.devices[0].failed_step, "push");
  assert.equal(report.devices[1].success, true);
  assert.deepEqual(report.summary, { total: 2, passed: 1, failed: 1 });
});

test("设备命令超时时标记 run 失败", () => {
  writeJob("timeout", "dev-1", "^Hello from dev-1$");
  const run = runVerify("timeout", { MOCK_FLEET_TIMEOUT: "true" });
  assert.equal(run.status, 1);
  const report = readOnlyReport("timeout");
  assert.equal(report.devices[0].failed_step, "run");
  assert.equal(report.devices[0].run.timed_out, true);
});

test("同一设备的并发任务等待文件锁", async () => {
  writeJob("lock", "dev-1", "^Hello from dev-1$");
  const first = runVerifyAsync("lock", { MOCK_FLEET_DELAY_MS: "1500" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const second = runVerifyAsync("lock", { MOCK_FLEET_DELAY_MS: "1500" });
  const runs = await Promise.all([first, second]);
  assert.ok(runs.every((run) => run.code === 0));
  assert.ok(runs.some((run) => run.stdout.includes("设备锁被占用，排队等待")));
  const reports = fs.readdirSync(reportsDir).filter((entry) => entry.startsWith("lock-"));
  assert.equal(reports.length, 2);
  assert.equal(fs.existsSync(path.join(remoteDir, "violation")), false);
});

test("空锁文件不会阻塞任务", () => {
  writeJob("empty-lock", "dev-1", "^Hello from dev-1$");
  fs.mkdirSync(locksDir, { recursive: true });
  fs.writeFileSync(path.join(locksDir, "device-dev-1.lock"), "");
  const run = runVerify("empty-lock");
  assert.equal(run.status, 0, run.stderr);
});

test("进程异常退出后内核锁自动释放", async () => {
  writeJob("after-crash", "dev-1", "^Hello from dev-1$");
  const holder = spawn(process.execPath, [
    "--input-type=module", "-e",
    `import { acquireDeviceLock } from ${JSON.stringify(path.join(VERIFY_DIR, "bin", "verify"))}; await acquireDeviceLock("dev-1"); console.log("locked"); setInterval(() => {}, 1000);`,
  ], { env: environment(), stdio: ["ignore", "pipe", "pipe"] });
  await waitForStdout(holder, "locked");
  holder.kill("SIGKILL");
  await new Promise((resolve) => holder.once("close", resolve));
  const run = runVerify("after-crash");
  assert.equal(run.status, 0, run.stderr);
});

test("构建产物使用报告快照，避免并发构建覆盖", async () => {
  writeArtifactJob("artifact-a", "A");
  writeArtifactJob("artifact-b", "B");
  const runs = await Promise.all([
    runVerifyAsync("artifact-a", { MOCK_FLEET_DELAY_MS: "300" }),
    runVerifyAsync("artifact-b", { MOCK_FLEET_DELAY_MS: "300" }),
  ]);
  assert.ok(runs.every((run) => run.code === 0), JSON.stringify(runs));
  assert.equal(fs.existsSync(path.join(remoteDir, "violation")), false);
  const reportA = readOnlyReport("artifact-a");
  const reportB = readOnlyReport("artifact-b");
  assert.equal(reportA.devices[0].assert.success, true);
  assert.equal(reportB.devices[0].assert.success, true);
  assert.match(fs.readFileSync(path.join(reportsDir, "artifact-a-1", "devices", "dev-1", "artifacts", "output.txt"), "utf8"), /artifact:A/);
  assert.match(fs.readFileSync(path.join(reportsDir, "artifact-b-1", "devices", "dev-1", "artifacts", "output.txt"), "utf8"), /artifact:B/);
});

test("非法产物路径在构建前拒绝", () => {
  const marker = path.join(VERIFY_DIR, "build", "unsafe-marker");
  fs.rmSync(marker, { force: true });
  fs.writeFileSync(path.join(jobsDir, "unsafe-path.yaml"), [
    "target: dev-1",
    "build: mkdir -p verify/build && touch verify/build/unsafe-marker",
    "artifacts:",
    "  ../outside: /tmp/outside",
    "run:",
    "  command: echo true",
    "  timeout: 5",
    "collect:",
    "  /tmp/verify-output.txt: output.txt",
    "assert:",
    "  exit_code: 0",
    "",
  ].join("\n"));
  const run = runVerify("unsafe-path");
  assert.equal(run.status, 2);
  assert.match(run.stderr, /artifacts 源路径/);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.readdirSync(reportsDir).some((entry) => entry.startsWith("unsafe-path-")), false);
});

test("verify 使用 fleet 返回的远端退出码", () => {
  writeExitJob("remote-exit", 7);
  const run = runVerify("remote-exit", { MOCK_FLEET_EXIT_CODE: "7" });
  assert.equal(run.status, 0, run.stderr);
  const report = readOnlyReport("remote-exit");
  assert.equal(report.devices[0].run.exit_code, 7);
  assert.equal(report.devices[0].run.process_exit_code, 1);
  assert.equal(report.devices[0].success, true);
});

test("transport 错误不会被错误断言为设备退出码", () => {
  writeExitJob("transport-error", 1);
  const run = runVerify("transport-error", { MOCK_FLEET_TRANSPORT_ERROR: "true" });
  assert.equal(run.status, 1);
  const report = readOnlyReport("transport-error");
  assert.equal(report.devices[0].failed_step, "run");
  assert.equal(report.devices[0].run.exit_code, null);
  assert.equal(report.devices[0].run.transport_error, true);
});

test("任务映射保留 __proto__ 键", async () => {
  const { parseJob } = await import("../bin/verify");
  const job = parseJob([
    "target: dev-1",
    "build: echo ok",
    "artifacts:",
    "  __proto__: /tmp/proto",
    "run:",
    "  command: echo true",
    "  timeout: 1",
    "collect:",
    "  /tmp/output: output.txt",
    "assert:",
    "  exit_code: 0",
    "",
  ].join("\n"));
  assert.equal(Object.hasOwn(job.artifacts, "__proto__"), true);
  assert.deepEqual(Object.entries(job.artifacts), [["__proto__", "/tmp/proto"]]);
});

test("fleet JSON 协议保留远端退出码", () => {
  const run = runFleet("exit7");
  assert.equal(run.status, 1);
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.exit_code, 7);
  assert.equal(result.transport_error, false);
  assert.equal(result.stdout, "remote output\n");
});

test("fleet exec 包装命令返回设备端真实成功码", () => {
  const run = runFleet("execute");
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.exit_code, 0, JSON.stringify(run));
  assert.equal(result.transport_error, false);
  assert.equal(result.stdout, "ignored");
});

test("fleet JSON 协议区分传输失败和超时", () => {
  const failure = JSON.parse(runFleet("failure").stdout.trim());
  assert.equal(failure.exit_code, null);
  assert.equal(failure.transport_error, true);
  const timeout = JSON.parse(runFleet("timeout").stdout.trim());
  assert.equal(timeout.exit_code, null);
  assert.equal(timeout.timed_out, true);
  assert.equal(timeout.transport_error, true);
});
