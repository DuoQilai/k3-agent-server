import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const FLEET_DIR = path.dirname(LIB_DIR);
const DEVICES_PATH = path.join(FLEET_DIR, "devices.yaml");
const PROBE_TIMEOUT_MS = 6000;
const MAX_OUTPUT_BUFFER = 10 * 1024 * 1024;
const SSH_OPTIONS = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=5",
  "-o", "ConnectionAttempts=1",
  "-o", "PasswordAuthentication=no",
  "-o", "KbdInteractiveAuthentication=no",
  "-o", "PreferredAuthentications=publickey",
  "-o", "IdentitiesOnly=yes",
  "-o", "StrictHostKeyChecking=accept-new",
];

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = null;
    } else if (quote === "'") {
      if (character === "'") {
        if (line[index + 1] === "'") index += 1;
        else quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function splitInlineList(value) {
  const items = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === null && (character === '"' || character === "'")) quote = character;
    else if (quote !== null && character === quote) quote = null;
    else if (quote === null && character === ",") {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(value.slice(start).trim());
  return items.filter((item) => item.length > 0).map(parseScalar);
}

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInlineList(value.slice(1, -1));
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("无法解析 YAML 字符串：" + value);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function parsePair(text, target) {
  const match = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(text);
  if (!match) throw new Error("无法解析 devices.yaml 行：" + text);
  const key = match[1];
  const value = match[2] ?? "";
  target[key] = parseScalar(value);
  return { key, value };
}

function loadDevices(devicesPath = DEVICES_PATH) {
  if (!fs.existsSync(devicesPath)) {
    throw new Error("找不到设备清单：" + devicesPath + "。请复制 fleet/devices.yaml.example 后填写。");
  }

  const devices = [];
  let inDevices = false;
  let current = null;
  let pendingList = null;
  const source = fs.readFileSync(devicesPath, "utf8");

  for (const [lineNumber, originalLine] of source.split(/\r?\n/).entries()) {
    const line = stripComment(originalLine);
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 0) {
      if (trimmed !== "devices:") {
        throw new Error("第 " + (lineNumber + 1) + " 行应为 devices:。");
      }
      inDevices = true;
      current = null;
      pendingList = null;
      continue;
    }
    if (!inDevices) throw new Error("第 " + (lineNumber + 1) + " 行位于 devices: 之前。");

    if (indent === 2 && trimmed.startsWith("- ")) {
      current = {};
      devices.push(current);
      pendingList = null;
      parsePair(trimmed.slice(2), current);
      continue;
    }

    if (!current) throw new Error("第 " + (lineNumber + 1) + " 行没有设备条目。");
    if (pendingList && indent > pendingList.indent && trimmed.startsWith("- ")) {
      current[pendingList.key].push(parseScalar(trimmed.slice(2)));
      continue;
    }
    if (indent >= 4) {
      const pair = parsePair(trimmed, current);
      pendingList = pair.value === "" ? { key: pair.key, indent } : null;
      if (pair.value === "" && pair.key !== "tags") {
        throw new Error("第 " + (lineNumber + 1) + " 行只支持 tags 使用多行列表。");
      }
      if (pair.value === "" && !Array.isArray(current[pair.key])) current[pair.key] = [];
      continue;
    }
    throw new Error("无法解析 devices.yaml 第 " + (lineNumber + 1) + " 行。");
  }

  if (devices.length === 0) throw new Error("devices.yaml 没有设备条目。");
  validateDevices(devices);
  return devices;
}

function validateDevices(devices) {
  const names = new Set();
  const required = ["name", "host", "user", "ssh_key", "arch", "tags", "enabled"];
  for (const device of devices) {
    for (const key of required) {
      if (!(key in device) || device[key] === null || device[key] === "") {
        throw new Error("设备条目缺少字段：" + key);
      }
    }
    for (const key of ["name", "host", "user", "ssh_key", "arch"]) {
      if (typeof device[key] !== "string") {
        throw new Error("设备字段必须是字符串：" + key);
      }
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(device.name)) {
      throw new Error("设备 name 只能包含字母、数字、点、下划线和连字符：" + device.name);
    }
    if (names.has(device.name)) throw new Error("设备名称重复：" + device.name);
    names.add(device.name);
    if (!Array.isArray(device.tags)) throw new Error("设备 tags 必须是列表：" + device.name);
    if (device.tags.some((tag) => typeof tag !== "string" || tag.length === 0)) {
      throw new Error("设备 tags 只能包含非空字符串：" + device.name);
    }
    if (typeof device.enabled !== "boolean") throw new Error("设备 enabled 必须是 true 或 false：" + device.name);
    for (const key of ["name", "host", "user", "ssh_key", "arch"]) {
      if (/[\s\0]/.test(String(device[key]))) {
        throw new Error("设备字段不能包含空白或控制字符：" + device.name + "." + key);
      }
    }
    if (device.user.startsWith("-")) {
      throw new Error("设备 user 不能以 - 开头：" + device.name);
    }
  }
}

function expandHome(value) {
  if (value === "~" || value.startsWith("~/")) {
    if (!process.env.HOME) throw new Error("HOME 环境变量未设置");
    if (value === "~") return process.env.HOME;
    return path.join(process.env.HOME, value.slice(2));
  }
  return value;
}

function endpoint(device) {
  return device.user + "@" + device.host;
}

function sshArguments(device) {
  const key = expandHome(String(device.ssh_key));
  return ["-i", key, ...SSH_OPTIONS, endpoint(device)];
}

function run(command, args, timeout = undefined) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: MAX_OUTPUT_BUFFER,
  });
  if (result.error) {
    return {
      code: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? result.error.message,
      timedOut: result.error.code === "ETIMEDOUT",
      signal: result.signal ?? null,
      error: result.error.message,
    };
  }
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: false,
    signal: result.signal ?? null,
    error: null,
  };
}

function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

function probe(device) {
  const key = expandHome(String(device.ssh_key));
  if (!fs.existsSync(key)) {
    return { code: 1, stdout: "", stderr: "SSH 密钥不存在：" + key };
  }
  return run("ssh", [...sshArguments(device), "true"], PROBE_TIMEOUT_MS);
}

function resolveTargets(devices, target) {
  if (!target) throw new Error("target 不能为空；不会默认选择全部设备。");
  if (target.startsWith("tag:")) {
    const tag = target.slice(4);
    if (!tag) throw new Error("tag 不能为空；不会默认选择全部设备。");
    const matches = devices.filter((device) => device.enabled && device.tags.includes(tag));
    if (matches.length === 0) throw new Error("没有匹配的启用设备：" + target);
    return matches;
  }

  const match = devices.find((device) => device.enabled && device.name === target);
  if (!match) throw new Error("没有匹配的启用设备：" + target);
  return [match];
}

export {
  DEVICES_PATH,
  endpoint,
  expandHome,
  loadDevices,
  probe,
  resolveTargets,
  run,
  shellQuote,
  sshArguments,
  validateDevices,
};
