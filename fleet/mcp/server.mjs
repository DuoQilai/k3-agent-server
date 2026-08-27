#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  endpoint,
  loadDevices,
  probe,
  resolveTargets,
  run,
  shellQuote,
  sshArguments,
} from "../bin/fleet";

const MCP_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(MCP_DIR, "config.yaml");
const SERVER_NAME = "k3-fleet-mcp";
const SERVER_VERSION = "0.1.0";
const HELP = [
  "用法：node fleet/mcp/server.mjs",
  "",
  "启动 stdio MCP server。默认只注册 fleet_list、fleet_status 和 fleet_logs。",
  "写工具需要在 fleet/mcp/config.yaml 中设置 write_tools: true。",
].join("\n");

const READ_TOOLS = [
  {
    name: "fleet_list",
    description: "列出 fleet 设备清单，不发起 SSH 连接。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fleet_status",
    description: "探测 fleet 设备的 SSH 可达性。",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "设备名或 tag:标签；省略时检查全部启用设备。" } },
      additionalProperties: false,
    },
  },
  {
    name: "fleet_logs",
    description: "读取目标设备上的日志文件末尾内容。",
    inputSchema: {
      type: "object",
      required: ["target", "path"],
      properties: {
        target: { type: "string", description: "设备名或 tag:标签。" },
        path: { type: "string", description: "远端日志文件路径。" },
        tail: { type: "integer", minimum: 1, default: 100 },
      },
      additionalProperties: false,
    },
  },
];

const WRITE_TOOLS = [
  {
    name: "fleet_exec",
    description: "在目标设备执行命令；启用前请确认 fleet/mcp/config.yaml。",
    inputSchema: {
      type: "object",
      required: ["target", "command"],
      properties: {
        target: { type: "string", description: "设备名或 tag:标签。" },
        command: { type: "string", description: "要在远端 shell 执行的完整命令。" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "fleet_push",
    description: "向目标设备上传文件；启用前请确认 fleet/mcp/config.yaml。",
    inputSchema: {
      type: "object",
      required: ["target", "src", "dst"],
      properties: {
        target: { type: "string", description: "设备名或 tag:标签。" },
        src: { type: "string", description: "本地文件。" },
        dst: { type: "string", description: "远端目标路径。" },
      },
      additionalProperties: false,
    },
  },
];

function parseConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { writeTools: false };
  const source = fs.readFileSync(CONFIG_PATH, "utf8");
  const match = /^\s*write_tools:\s*(true|false)\s*(?:#.*)?$/m.exec(source);
  if (!match) throw new Error("config.yaml 必须包含 write_tools: true 或 write_tools: false。");
  return { writeTools: match[1] === "true" };
}

function enabledTools() {
  return parseConfig().writeTools ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
}

function asObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("工具参数必须是对象。");
  }
  return value;
}

function requiredString(args, key) {
  if (typeof args[key] !== "string" || args[key].trim() === "") {
    throw new Error(key + " 不能为空。");
  }
  return args[key];
}

function selectTargets(devices, target, allowAll = false) {
  if (!target && allowAll) return devices.filter((device) => device.enabled);
  return resolveTargets(devices, target);
}

function textResult(value, isError = false) {
  return {
    isError,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function collectResult(device, result) {
  return {
    device: device.name,
    host: device.host,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function auditWrite(action, device, command) {
  const message = JSON.stringify({
    action,
    target: device.name,
    host: device.host,
    command,
  });
  const result = spawnSync("logger", ["-t", SERVER_NAME, message], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error("无法写入 journald 审计日志，已拒绝执行写操作。");
  }
}

function callList() {
  const devices = loadDevices();
  return textResult({
    devices: devices.map((device) => ({
      name: device.name,
      host: device.host,
      user: device.user,
      arch: device.arch,
      tags: device.tags,
      enabled: device.enabled,
    })),
  });
}

function callStatus(rawArguments) {
  const args = asObject(rawArguments);
  const devices = loadDevices();
  const targets = selectTargets(devices, args.target, true);
  const results = targets.map((device) => {
    if (!device.enabled) return { device: device.name, host: device.host, status: "disabled" };
    const result = probe(device);
    return {
      device: device.name,
      host: device.host,
      status: result.code === 0 ? "reachable" : "unreachable",
      stderr: result.stderr,
    };
  });
  return textResult({ devices: results }, results.some((item) => item.status === "unreachable"));
}

function callLogs(rawArguments) {
  const args = asObject(rawArguments);
  const target = requiredString(args, "target");
  const remotePath = requiredString(args, "path");
  const tail = args.tail === undefined ? 100 : args.tail;
  if (!Number.isInteger(tail) || tail < 1) throw new Error("tail 必须是正整数。");
  const targets = selectTargets(loadDevices(), target);
  const command = ["tail", "-n", String(tail), "--", remotePath].map(shellQuote).join(" ");
  const results = targets.map((device) => collectResult(device, run("ssh", [...sshArguments(device), command])));
  return textResult({ results }, results.some((item) => item.code !== 0));
}

function callExec(rawArguments) {
  const args = asObject(rawArguments);
  const target = requiredString(args, "target");
  const command = requiredString(args, "command");
  const targets = selectTargets(loadDevices(), target);
  const results = targets.map((device) => {
    auditWrite("fleet_exec", device, "fleet exec " + shellQuote(target) + " -- " + command);
    return collectResult(device, run("ssh", [...sshArguments(device), command]));
  });
  return textResult({ results }, results.some((item) => item.code !== 0));
}

function callPush(rawArguments) {
  const args = asObject(rawArguments);
  const target = requiredString(args, "target");
  const source = requiredString(args, "src");
  const destination = requiredString(args, "dst");
  const targets = selectTargets(loadDevices(), target);
  const results = targets.map((device) => {
    const remotePath = endpoint(device) + ":" + destination;
    const connectionArgs = sshArguments(device);
    const command = ["fleet", "push", target, source, destination].map(shellQuote).join(" ");
    auditWrite("fleet_push", device, command);
    return collectResult(device, run("scp", [
      ...connectionArgs.slice(0, -1),
      "--",
      source,
      remotePath,
    ]));
  });
  return textResult({ results }, results.some((item) => item.code !== 0));
}

function callTool(name, rawArguments) {
  const tools = enabledTools();
  if (!tools.some((tool) => tool.name === name)) throw new Error("工具未启用或不存在：" + name);
  if (name === "fleet_list") return callList();
  if (name === "fleet_status") return callStatus(rawArguments);
  if (name === "fleet_logs") return callLogs(rawArguments);
  if (name === "fleet_exec") return callExec(rawArguments);
  return callPush(rawArguments);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handleMessage(message) {
  const id = message.id ?? null;
  if (message.method === "notifications/initialized") return;
  if (message.method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    try {
      send({ jsonrpc: "2.0", id, result: { tools: enabledTools() } });
    } catch (error) {
      sendError(id, -32000, error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (message.method === "tools/call") {
    try {
      send({ jsonrpc: "2.0", id, result: callTool(message.params?.name, message.params?.arguments ?? {}) });
    } catch (error) {
      send({ jsonrpc: "2.0", id, result: textResult({ error: error instanceof Error ? error.message : String(error) }, true) });
    }
    return;
  }
  if (message.id !== undefined) sendError(id, -32601, "未知方法：" + message.method);
}

let buffer = "";
if (process.argv.slice(2).includes("--help") || process.argv.slice(2).includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (error) {
      sendError(null, -32700, error instanceof Error ? error.message : String(error));
    }
  }
});
