import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const VERIFY_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERIFY_BIN = path.join(VERIFY_DIR, "bin", "verify");
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "k3-verify-test-"));
const jobsDir = path.join(temporaryDir, "jobs");
const reportsDir = path.join(temporaryDir, "reports");
const locksDir = path.join(temporaryDir, "locks");
const remoteDir = path.join(temporaryDir, "remote");
const devicesPath = path.join(temporaryDir, "devices.yaml");
const mockFleet = path.join(temporaryDir, "mock-fleet.mjs");

fs.mkdirSync(jobsDir, { recursive: true });
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

const [command, device, source, destination] = process.argv.slice(2);
const root = process.env.MOCK_FLEET_ROOT;
const remotePath = (name, value) => path.join(root, name, value.replace(/^\\/+/, ""));
if (command === "push") {
  if (process.env.MOCK_FLEET_FAIL_DEVICE === device) process.exit(1);
  const target = remotePath(device, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
} else if (command === "exec") {
  if (process.env.MOCK_FLEET_TIMEOUT === "true") process.exit(124);
  const wait = Number(process.env.MOCK_FLEET_DELAY_MS || 0);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const output = "Hello from " + device + "\\n";
  const target = remotePath(device, "/tmp/verify-output.txt");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output);
  process.stdout.write("[" + device + "] " + output);
} else if (command === "pull") {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(remotePath(device, source), destination);
} else {
  process.exit(2);
}
`);
fs.chmodSync(mockFleet, 0o755);

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
});
