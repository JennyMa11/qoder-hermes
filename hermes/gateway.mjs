// gateway.ts
import { createServer as createServer2 } from "node:http";

// ../core/shim.ts
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { randomBytes as randomBytes2 } from "node:crypto";

// ../core/cosy.ts
import { createHash, createCipheriv, createDecipheriv, privateDecrypt, publicEncrypt } from "node:crypto";
import { randomBytes, randomUUID } from "node:crypto";
var CUSTOM_ALPHABET = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
var STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var CUSTOM_PAD = "$";
var s2c = /* @__PURE__ */ new Map();
var c2s = /* @__PURE__ */ new Map();
for (let i = 0; i < 64; i += 1) {
  s2c.set(STD_ALPHABET[i], CUSTOM_ALPHABET[i]);
  c2s.set(CUSTOM_ALPHABET[i], STD_ALPHABET[i]);
}
s2c.set("=", CUSTOM_PAD);
c2s.set(CUSTOM_PAD, "=");
function cosyEncode(plaintext) {
  const std = Buffer.from(plaintext).toString("base64");
  const n = std.length;
  const a = Math.floor(n / 3);
  const rearranged = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a);
  let out = "";
  for (const ch of rearranged) {
    const mapped = s2c.get(ch);
    if (mapped === void 0) throw new Error(`cosy encode: char out of alphabet: ${ch}`);
    out += mapped;
  }
  return out;
}
function currentRfc1123Date() {
  return (/* @__PURE__ */ new Date()).toUTCString();
}
function md5Hex(input) {
  return createHash("md5").update(input, "utf8").digest("hex");
}
function sha512Base64Url(input) {
  return createHash("sha512").update(input, "utf8").digest("base64url");
}
var COSY_APPCODE = "cosy";
var COSY_SECRET_B64 = "d2FyLCB3YXIgbmV2ZXIgY2hhbmdlcw==";
function signLegacy(date) {
  return md5Hex(`${COSY_APPCODE}&${COSY_SECRET_B64}&${date}`);
}
var SERVER_PUBKEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
var COSY_VERSION = "0.1.43";
function aesCbcEncrypt(plain, key) {
  const iv = key;
  const blockSize = 16;
  const padLen = blockSize - plain.length % blockSize;
  const padded = new Uint8Array(plain.length + padLen);
  padded.set(plain);
  padded.fill(padLen, plain.length);
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  const out = Buffer.concat([cipher.update(padded), cipher.final()]);
  return new Uint8Array(out);
}
function rsaEncrypt(plain) {
  const { publicKey } = requirePublicKey();
  const out = publicEncrypt({ key: publicKey, padding: 1 }, Buffer.from(plain));
  return new Uint8Array(out);
}
var cachedPublicKey;
function requirePublicKey() {
  if (cachedPublicKey === void 0) {
    cachedPublicKey = { publicKey: SERVER_PUBKEY_PEM };
  }
  return cachedPublicKey;
}
function newCosySession(identity, machineId, machineToken, machineType) {
  const tempKey = new Uint8Array(Buffer.from(randomBytes(16).toString("hex").slice(0, 16), "utf8"));
  const cosyKeyBytes = rsaEncrypt(tempKey);
  const cosyKey = Buffer.from(cosyKeyBytes).toString("base64");
  const payload = JSON.stringify(identityPayload(identity));
  const info = Buffer.from(aesCbcEncrypt(new Uint8Array(Buffer.from(payload, "utf8")), tempKey)).toString("base64");
  return { tempKey, cosyKey, info, identity, machineId, machineToken, machineType };
}
function identityPayload(identity) {
  return {
    name: identity.name,
    aid: identity.aid,
    uid: identity.uid,
    yx_uid: identity.yx_uid,
    organization_id: identity.organization_id,
    organization_name: identity.organization_name,
    user_type: identity.user_type,
    security_oauth_token: identity.security_oauth_token,
    refresh_token: identity.refresh_token
  };
}
function buildPayloadB64(info) {
  const payload = {
    cosyVersion: COSY_VERSION,
    ideVersion: "",
    info,
    requestId: randomUUID(),
    version: "v1"
  };
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a < b ? -1 : 1));
  return Buffer.from(JSON.stringify(sorted)).toString("base64");
}
function signRequest(payloadB64, cosyKey, cosyDate, body, pathSig) {
  return md5Hex(`${payloadB64}
${cosyKey}
${cosyDate}
${body}
${pathSig}`);
}
function composeBearer(payloadB64, sig) {
  return `Bearer COSY.${payloadB64}.${sig}`;
}
function pathSigFrom(fullUrl) {
  let path;
  try {
    path = new URL(fullUrl).pathname;
  } catch {
    path = fullUrl;
  }
  return path.startsWith("/algo") ? path.slice("/algo".length) : path;
}
function saltedSeed(seed, installSalt) {
  return installSalt ? `${seed}|salt:${installSalt}` : seed;
}
function deriveId(seed, salt, installSalt) {
  return md5Hex(`${salt}:${saltedSeed(seed, installSalt)}`);
}
function deriveFingerprint(uid, credential, installSalt) {
  const seed = uid !== "" ? uid : `cred:${credential}`;
  return {
    machineId: deriveId(seed, "machine", installSalt),
    machineType: deriveId(seed, "machinetype", installSalt).slice(0, 18),
    machineToken: sha512Base64Url(`machinetoken:${saltedSeed(seed, installSalt)}`).slice(0, 43)
  };
}

// ../core/messages.ts
function createChatBodyTemplate() {
  return {
    request_id: "",
    request_set_id: "",
    chat_record_id: "",
    stream: true,
    chat_task: "FREE_INPUT",
    chat_context: {
      extra: {
        modelConfig: { is_reasoning: false, key: "lite" },
        originalContent: { type: "text", text: "" }
      },
      text: { type: "text", text: "" }
    },
    session_id: "",
    source: 1,
    version: "3",
    aliyun_user_type: "personal_standard",
    session_type: "qodercli",
    agent_id: "agent_common",
    task_id: "common",
    model_config: {
      key: "lite",
      is_vl: false,
      is_reasoning: false,
      source: "system"
    },
    messages: [],
    business: {
      id: "",
      name: "hi",
      begin_at: 0
    }
  };
}
function blankResponseMeta() {
  return {
    id: "",
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      completion_tokens_details: { reasoning_tokens: 0 },
      prompt_tokens_details: { cached_tokens: 0 }
    }
  };
}
function structuredMessage(role, text2) {
  return {
    role,
    content: text2,
    response_meta: blankResponseMeta(),
    reasoning_content_signature: ""
  };
}
function userMessage(text2, images = []) {
  const parts = [];
  for (const url of images) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  if (text2.trim()) {
    parts.push({ type: "text", text: text2 });
  }
  if (parts.length === 0) {
    parts.push({ type: "text", text: "" });
  }
  return {
    role: "user",
    content: "",
    contents: parts,
    response_meta: blankResponseMeta(),
    reasoning_content_signature: ""
  };
}
function toolMessage(message, text2) {
  const out = structuredMessage("tool", text2);
  if (typeof message.name === "string") out.name = message.name;
  if (typeof message.tool_call_id === "string") out.tool_call_id = message.tool_call_id;
  return out;
}
function assistantToolCallMessage(text2, toolCalls) {
  const out = structuredMessage("assistant", text2);
  out.tool_calls = toolCalls;
  return out;
}
function normalizeMessageText(message) {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
      } else if (part && typeof part === "object") {
        const t = part.text;
        if (typeof t === "string") parts.push(t);
        else if (typeof part.value === "string") parts.push(part.value);
      }
    }
    return parts.join("");
  }
  return "";
}
function extractMessageImages(message) {
  if (message.role !== "user") return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];
  const urls = [];
  for (const part of content) {
    const iu = part.image_url;
    if (iu && typeof iu.url === "string") urls.push(iu.url);
  }
  return urls;
}
var TOOL_CALLS_TEXT_RE = /Tool calls:\s*(\[[\s\S]*?\])/;
function parseToolCallsText(text2) {
  if (!text2) return void 0;
  const m = TOOL_CALLS_TEXT_RE.exec(text2);
  if (!m?.[1]) return void 0;
  try {
    const parsed = JSON.parse(m[1]);
    if (Array.isArray(parsed) && parsed.every((item) => item && typeof item === "object")) {
      return normalizeToolCalls(parsed);
    }
  } catch {
    return void 0;
  }
  return void 0;
}
function normalizeToolCalls(raw) {
  return raw.map((tc) => {
    if (tc && typeof tc === "object" && !("function" in tc)) {
      const r = tc;
      if (r.id && r.name && r.input) {
        return { id: r.id, type: "function", function: { name: r.name, arguments: JSON.stringify(r.input) } };
      }
    }
    return tc;
  });
}
function hasResolvedToolResponse(messages, assistantIndex) {
  const message = messages[assistantIndex];
  if (message === void 0 || message.role !== "assistant") return false;
  const tc = message.tool_calls;
  if (!(Array.isArray(tc) && tc.length > 0) && !parseToolCallsText(normalizeMessageText(message))) return false;
  for (let i = assistantIndex + 1; i < messages.length; i += 1) {
    const next = messages[i];
    if (next?.role === "tool") return true;
    if (next !== void 0 && (next.role === "assistant" || next.role === "user" || next.role === "system")) return false;
  }
  return false;
}
function renderToolCalls(toolCalls) {
  return `Tool calls:
${JSON.stringify(toolCalls)}`;
}
function renderToolResult(message, text2) {
  const name = typeof message.name === "string" ? message.name : "";
  const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id : "";
  let out = "Tool result";
  if (name) out += ` (${name})`;
  if (toolCallId) out += ` [${toolCallId}]`;
  if (text2.trim()) out += `:
${text2}`;
  return out;
}
function convertIncomingMessage(message, toolsEnabled, allowStructuredToolCalls) {
  const role = typeof message.role === "string" ? message.role : "user";
  const text2 = normalizeMessageText(message);
  let structuredToolCalls;
  if (toolsEnabled && allowStructuredToolCalls) {
    const tc = Array.isArray(message.tool_calls) && message.tool_calls.length > 0 ? message.tool_calls : parseToolCallsText(text2);
    if (tc) structuredToolCalls = tc;
  }
  if (role === "assistant" && structuredToolCalls) {
    return assistantToolCallMessage(text2, structuredToolCalls);
  }
  if (role === "tool") {
    if (toolsEnabled) return toolMessage(message, text2);
    return structuredMessage("user", renderToolResult(message, text2));
  }
  let finalText = text2;
  if (role === "assistant" && !toolsEnabled && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    finalText = [text2, renderToolCalls(message.tool_calls)].filter(Boolean).join("\n\n");
  }
  const images = role === "user" ? extractMessageImages(message) : [];
  if (!finalText.trim() && images.length === 0) return null;
  if (role === "user") {
    const cleaned = images.length > 0 ? finalText.split("\n\n").filter((s) => !s.trim().startsWith("[image] ")).join("\n\n") : finalText;
    return userMessage(cleaned, images);
  }
  return structuredMessage(role, finalText);
}
function buildQoderMessages(incoming, prompt, toolsEnabled) {
  const rebuilt = [];
  if (incoming.length > 0) {
    for (let i = 0; i < incoming.length; i += 1) {
      const allowStructured = toolsEnabled && hasResolvedToolResponse(incoming, i);
      const converted = convertIncomingMessage(incoming[i], toolsEnabled, allowStructured);
      if (converted !== null) rebuilt.push(converted);
    }
  }
  if (rebuilt.length === 0 && prompt.trim()) {
    rebuilt.push(userMessage(prompt));
  }
  return rebuilt;
}
function extractLatestUserPrompt(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user") {
      const text2 = normalizeMessageText(m);
      if (text2.trim()) return text2;
    }
  }
  return "";
}
function deepClone(value) {
  return structuredClone(value);
}
function applyModelKey(body, key, userType, isVl) {
  body.model_config.key = key;
  body.model_config.is_vl = isVl;
  body.chat_context.extra.modelConfig.key = key;
  body.aliyun_user_type = userType;
}

// ../core/device-risk.ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
var run = promisify(execFile);
var MAX_OUTPUT_BYTES = 1024 * 1024;
var COMPONENT_TIMEOUT_MS = 25e3;
var RISK_PROCESS_OPTIONS = {
  timeout: COMPONENT_TIMEOUT_MS,
  maxBuffer: MAX_OUTPUT_BYTES,
  windowsHide: true
};
var RISK_TTL_MS = 50 * 60 * 1e3;
var UMID_CANDIDATES = {
  cn: [
    "/Applications/Qoder CN.app/Contents/Resources/umid/runtime-info",
    "/Applications/Qoder.app/Contents/Resources/umid/runtime-info"
  ],
  global: [
    "/Applications/Qoder.app/Contents/Resources/umid/runtime-info",
    "/Applications/Qoder CN.app/Contents/Resources/umid/runtime-info"
  ]
};
function windowsUmidPath(installDir) {
  const trimmed = installDir.replace(/[\\/]+$/u, "");
  const separator = trimmed.includes("\\") ? "\\" : "/";
  return [trimmed, "resources", "umid", "runtime-info.exe"].join(separator);
}
function windowsUmidCandidates(region) {
  const local = process.env.LOCALAPPDATA;
  if (!local) return [];
  const pathOf = (app) => windowsUmidPath(join(local, "Programs", app));
  return region === "cn" ? [pathOf("Qoder CN"), pathOf("Qoder")] : [pathOf("Qoder"), pathOf("Qoder CN")];
}
var UMID_PATH_ENV = "QODER_UMID_PATH";
var cache = {};
function findDeviceRiskComponent(region) {
  const custom = process.env[UMID_PATH_ENV];
  if (typeof custom === "string" && custom !== "" && existsSync(custom)) return custom;
  for (const candidate of [...UMID_CANDIDATES[region], ...windowsUmidCandidates(region)]) {
    if (existsSync(candidate)) return candidate;
  }
  return void 0;
}
var WINDOWS_UNINSTALL_ROOTS = [
  String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`
];
var WINDOWS_DISPLAY_NAME_REGIONS = [
  [/^Qoder\s*CN\b/iu, "cn"],
  [/^Qoder\b/iu, "global"]
];
var REG_VALUE_LINE = /^\s+(.+?)\s+REG_SZ\s+(.*)$/u;
var REG_QUERY_OPTIONS = {
  timeout: 1e4,
  maxBuffer: MAX_OUTPUT_BYTES,
  windowsHide: true
};
function windowsInstallDirOf(value) {
  const text2 = value.trim();
  if (text2 === "") return void 0;
  const quoted = /^"(?<path>[^"]+)"/u.exec(text2)?.groups?.path;
  const executable = /^.+?\.exe\b/iu.exec(text2)?.[0];
  const file = (quoted ?? executable ?? text2).trim();
  const cut = Math.max(file.lastIndexOf("\\"), file.lastIndexOf("/"));
  if (cut <= 0) return void 0;
  const dir = file.slice(0, cut);
  return /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(dir) ? dir : void 0;
}
function parseWindowsUninstallDirs(output, region) {
  const dirs = [];
  let displayName = "";
  let uninstallString = "";
  let displayIcon = "";
  const settle = () => {
    const matched = WINDOWS_DISPLAY_NAME_REGIONS.find(([pattern]) => pattern.test(displayName));
    if (matched?.[1] === region) {
      const dir = windowsInstallDirOf(uninstallString) ?? windowsInstallDirOf(displayIcon);
      if (dir !== void 0 && !dirs.includes(dir)) dirs.push(dir);
    }
    displayName = "";
    uninstallString = "";
    displayIcon = "";
  };
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("HKEY_")) {
      settle();
      continue;
    }
    const value = REG_VALUE_LINE.exec(line);
    if (value === null) continue;
    const name = value[1].trim().toLowerCase();
    if (name === "displayname") displayName = value[2].trim();
    else if (name === "uninstallstring") uninstallString = value[2].trim();
    else if (name === "displayicon") displayIcon = value[2].trim();
  }
  settle();
  return dirs;
}
function windowsRegExe() {
  const root = process.env.SystemRoot;
  return root === void 0 || root === "" ? "reg.exe" : join(root, "System32", "reg.exe");
}
async function findInWindowsUninstallRegistry(region) {
  for (const root of WINDOWS_UNINSTALL_ROOTS) {
    let stdout;
    try {
      const result = await run(windowsRegExe(), ["query", root, "/s", "/f", "Qoder", "/t", "REG_SZ"], REG_QUERY_OPTIONS);
      stdout = result.stdout;
    } catch {
      continue;
    }
    for (const dir of parseWindowsUninstallDirs(stdout, region)) {
      const candidate = windowsUmidPath(dir);
      if (existsSync(candidate)) return candidate;
    }
  }
  return void 0;
}
async function resolveDeviceRiskComponent(region, probeRegistry = findInWindowsUninstallRegistry) {
  const found = findDeviceRiskComponent(region);
  if (found !== void 0) return found;
  if (process.platform !== "win32") return void 0;
  return probeRegistry(region);
}
async function readDeviceRisk(region, nowMs = Date.now()) {
  const hit = cache[region];
  if (hit !== void 0 && nowMs - hit.atMs < RISK_TTL_MS) return hit.risk;
  const component = await resolveDeviceRiskComponent(region);
  if (component === void 0) {
    throw new Error(
      `\u672A\u627E\u5230 Qoder \u8BBE\u5907\u98CE\u63A7\u7EC4\u4EF6\uFF08umid/runtime-info\uFF09\u3002\u56FD\u9645\u7248\u7B7E\u5230\u9700\u8981\u5B83\uFF1A\u8BF7\u5B89\u88C5 Qoder \u5BA2\u6237\u7AEF\uFF0C\u6216\u7528 ${UMID_PATH_ENV} \u6307\u5B9A\u7EC4\u4EF6\u8DEF\u5F84`
    );
  }
  let stdout;
  try {
    const result = await run(component, [], RISK_PROCESS_OPTIONS);
    stdout = result.stdout;
  } catch (error) {
    throw new Error(`\u8BBE\u5907\u98CE\u63A7\u7EC4\u4EF6\u6267\u884C\u5931\u8D25: ${String(error?.message ?? error)}`);
  }
  const firstLine = stdout.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? "";
  let parsed;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    throw new Error(`\u8BBE\u5907\u98CE\u63A7\u7EC4\u4EF6\u8F93\u51FA\u4E0D\u662F JSON: ${firstLine.slice(0, 120)}`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("\u8BBE\u5907\u98CE\u63A7\u7EC4\u4EF6\u8F93\u51FA\u4E0D\u662F\u5BF9\u8C61");
  }
  const record = parsed;
  const pick = (key) => {
    const value = record[key];
    if (typeof value !== "string" || value.trim() === "" || value.length > 4096) {
      throw new Error(`\u8BBE\u5907\u98CE\u63A7\u7EC4\u4EF6\u8F93\u51FA\u7F3A\u5C11 ${key}`);
    }
    return value.trim();
  };
  const risk = {
    machineToken: pick("machineToken"),
    machineCode: pick("machineCode"),
    machineType: pick("machineType")
  };
  cache[region] = { risk, atMs: nowMs };
  return risk;
}

// ../core/status-paths.ts
var QODER_GITHUB_URL = "https://github.com/dingminhua/dsh-connect-qoder";
var QODER_PAT_DOC_URL = `${QODER_GITHUB_URL}/blob/main/docs/PAT.md`;
var QODER_WEB_REGIONS = ["cn", "global"];
var TRANSFER_DOMAINS = ["qoder.com.cn", "qoder.sh"];
function knownQoderRegionOfDomain(domain) {
  if (domain === "qoder.com.cn") return "cn";
  if (domain === "qoder.sh") return "global";
  return void 0;
}
var QODER_REGION_TRANSFER_DOMAIN = (() => {
  const table = {};
  for (const region of QODER_WEB_REGIONS) table[region] = "";
  for (const domain of TRANSFER_DOMAINS) {
    const region = knownQoderRegionOfDomain(domain);
    if (region === void 0) throw new Error(`transfer domain is not a known Qoder region: ${domain}`);
    table[region] = domain;
  }
  for (const region of QODER_WEB_REGIONS) {
    if (table[region] === "") throw new Error(`region has no transfer domain: ${region}`);
  }
  return table;
})();
var QODER_UPSTREAM_DOMAIN = {
  cn: "gateway.qoder.com.cn",
  global: "api1.qoder.sh"
};
var QODER_SETTINGS_NS = "dsh-connect-qoder";
var QODER_SETTINGS_NAMESPACE_CANDIDATES = [
  QODER_SETTINGS_NS,
  `include:${QODER_SETTINGS_NS}`,
  "qoder"
];

// ../core/native-modality.ts
var ROUTER_MODEL_IDS = /* @__PURE__ */ new Set(["auto"]);
function isRouterModelId(modelId) {
  return ROUTER_MODEL_IDS.has(normalizeModelId(modelId));
}
function normalizeModelId(modelId) {
  return modelId.trim().toLowerCase();
}

// ../core/upstream.ts
var CHAT_PATH = "/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";
var CAMPAIGNS_PATH = "/sash/api/v1/me/campaigns";
var SASH_TOKEN_PATH = "/api/v1/jobToken/exchange";
var CAMPAIGNS_QUERY = "?forceRefresh=true";
var SASH_CLIENT_TYPE = "10";
var SASH_USER_AGENT = "Qoder";
var COSY_CLIENT_TYPE = "10";
var COSY_VERSION_HEADER = "1.1.69";
var MODELS_PATH = "/algo/api/v2/model/list?Encode=1";
var JOB_TOKEN_PATH = "/algo/api/v3/user/jobToken?Encode=1";
var QODER_REGIONS = {
  cn: {
    // 主机名只有一处事实（`status-paths.ts` 的 `QODER_UPSTREAM_DOMAIN`），卡片
    // 的「诊断」栏读的也是它——这样「面板上写的域名」与「请求真正打到的域名」
    // 不可能各说一套。
    gateway: `https://${QODER_UPSTREAM_DOMAIN.cn}`,
    openapi: "https://openapi.qoder.com.cn",
    chatPath: CHAT_PATH,
    modelsPath: MODELS_PATH,
    jobTokenPath: JOB_TOKEN_PATH,
    campaignsPath: CAMPAIGNS_PATH,
    requiresDeviceRisk: false
  },
  global: {
    gateway: `https://${QODER_UPSTREAM_DOMAIN.global}`,
    openapi: "https://openapi.qoder.sh",
    chatPath: CHAT_PATH,
    modelsPath: "/algo/api/v2/model/list?Encode=1",
    jobTokenPath: "/algo/api/v3/user/jobToken?Encode=1",
    campaignsPath: CAMPAIGNS_PATH,
    requiresDeviceRisk: true
  }
};
var QoderUpstreamError = class extends Error {
  kind;
  status;
  code;
  /**
   * 上游**自己申报**的「请等这么久再试」，毫秒（issue #24）。
   *
   * 来自 `10605 / RESOURCE_LIMIT` 信封里的 `retryAfterSeconds`（实测形状：
   * `{"isQueued":false,"queueCount":0,"retryAfterSeconds":5,"serviceAvailable":true}`），
   * 或 HTTP `Retry-After` 头。取不到就是 `undefined` —— 「上游没说」与「上游说
   * 等 0 秒」是两件事，抽取层不替它下结论。
   *
   * 这个值的去向有两处，都必须有：①写进给宿主的失败文案（否则用户只看到
   * 「上游报了个 4xx」，看不到「上游只要求等 5 秒」）；②非流式失败响应上的
   * `Retry-After` 头。宿主在 pi-ai 那条路由上**只从文案分类**，不读头，所以
   * ①是唯一能让「申报值」影响等待的一条。
   */
  retryAfterMs;
  /**
   * 上游说「我在排队」的证据（issue #26）。
   *
   * 与 {@link retryAfterMs} 分开是因为它们是**两件事**：`retryAfterMs` 说
   * 「等多久再来」，`queue` 说「你现在排在第几位、服务本身是好的」。前者决定
   * 冷却多长，后者决定**怎么跟用户说** —— 把排队说成「连不上上游」是错的
   * （用户实拍：账号完全正常，六个模型同时可用）。
   */
  queue;
  constructor(kind, message, status = 0, code, retryAfterMs, queue) {
    super(message);
    this.name = "QoderUpstreamError";
    this.kind = kind;
    this.status = status;
    this.code = code;
    if (retryAfterMs !== void 0 && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      this.retryAfterMs = retryAfterMs;
    }
    if (queue !== void 0) {
      this.queue = queue;
    }
  }
};
function isQoderUpstreamError(error) {
  return error instanceof QoderUpstreamError;
}
var DEFAULT_HEADERS = {
  "cosy-data-policy": "agree",
  "content-type": "application/json",
  "cosy-clienttype": COSY_CLIENT_TYPE,
  "login-version": "v2",
  "user-agent": "Go-http-client/2.0",
  "cosy-scene": "assistant",
  "cosy-business-product": "ide",
  "cosy-business-type": "agent"
};
var QoderUpstreamClient = class {
  region;
  /** 本实例所属区域（`region` 是它的配置表；这里保留区域名本身）。 */
  regionKey;
  logger;
  installSalt;
  fetchImpl;
  /**
   * 按凭证键控的会话缓存。
   *
   * 一个区域实例会同时服务多个账号（账号池批量探测、按账号查额度），
   * 不同 PAT 的 cosy 会话互不相通，所以会话必须按凭证分开缓存——用单个
   * 字段会互相覆盖（上一个账号的会话被下一个冲掉）。键是 PAT 本身：
   * 会话不可再交换，必须绑定到它交换来的那份凭证。
   */
  holders = /* @__PURE__ */ new Map();
  /** 最近使用的主会话（默认解析路径复用它）。 */
  currentKey;
  constructor(region, options = {}) {
    this.region = QODER_REGIONS[region];
    this.regionKey = region;
    this.logger = options.logger ?? (() => {
    });
    this.installSalt = options.installSalt;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }
  log(message) {
    this.logger(`dsh-connect-qoder: ${message}`);
  }
  /** 某一凭证的会话是否已过期（或即将过期）。 */
  isSessionValid(credential, nowMs = Date.now()) {
    const holder = this.holders.get(credential);
    if (holder === void 0) return false;
    const remaining = holder.expireAtMs - nowMs;
    return remaining > 5 * 6e4;
  }
  /** 最近使用的凭证，沿用直觉意义上「当前账号」的引用。 */
  currentCredential() {
    return this.holders.has(this.currentKey ?? "") ? this.currentKey : void 0;
  }
  /**
   * 用 PAT（`pt-...` 或任意凭证）或 refresh token（`drt-...`）交换 jobToken。
   * 设备指纹以凭证为种子派生（无 uid 可用前），保证稳定。
   */
  async exchangeJobToken(credential) {
    const fingerprint = deriveFingerprint("", credential, this.installSalt);
    const body = jobTokenBody(credential);
    const date = currentRfc1123Date();
    const sig = signLegacy(date);
    const headers = {
      "cosy-machinetoken": fingerprint.machineToken,
      "cosy-machinetype": fingerprint.machineType,
      "login-version": "v2",
      appcode: "cosy",
      accept: "application/json",
      "accept-encoding": "identity",
      "cosy-version": COSY_VERSION_HEADER,
      "cosy-clienttype": COSY_CLIENT_TYPE,
      date,
      signature: sig,
      "content-type": "application/json",
      "cosy-machineid": fingerprint.machineId,
      "user-agent": "Go-http-client/2.0"
    };
    const url = `${this.region.gateway}${this.region.jobTokenPath}`;
    const resp = await this.fetchImpl(url, { method: "POST", headers, body });
    const text2 = await resp.text();
    if (resp.status !== 200) {
      throw new QoderUpstreamError(classifyFailure(resp.status, text2), `jobToken \u4EA4\u6362\u5931\u8D25: HTTP ${resp.status} ${truncate(text2, 200)}`, resp.status, deepestBusinessCode(text2));
    }
    let data;
    try {
      data = JSON.parse(text2);
    } catch {
      throw new QoderUpstreamError("unknown", `jobToken \u54CD\u5E94\u4E0D\u662F JSON: ${truncate(text2, 200)}`, resp.status);
    }
    const jobToken = {
      id: String(data.id ?? ""),
      name: String(data.name ?? ""),
      expireTime: Number(data.expireTime ?? 0),
      securityOauthToken: String(data.securityOauthToken ?? ""),
      refreshToken: String(data.refreshToken ?? ""),
      userType: String(data.userType ?? "personal_standard")
    };
    if (!jobToken.id && !jobToken.securityOauthToken) {
      throw new QoderUpstreamError("auth", `jobToken \u4EA4\u6362\u54CD\u5E94\u7F3A\u5C11\u8EAB\u4EFD\u5B57\u6BB5: ${truncate(text2, 200)}`, resp.status);
    }
    const identity = { name: jobToken.name, aid: jobToken.id, uid: jobToken.id, yx_uid: "", organization_id: "", organization_name: "", user_type: jobToken.userType, security_oauth_token: jobToken.securityOauthToken, refresh_token: jobToken.refreshToken };
    const session = newCosySession(identity, fingerprint.machineId, fingerprint.machineToken, fingerprint.machineType);
    const holder = {
      session,
      fingerprint,
      jobToken,
      expireAtMs: jobToken.expireTime > 0 ? jobToken.expireTime : 0
    };
    await this.refreshSashToken(credential, holder);
    this.holders.set(credential, holder);
    this.currentKey = credential;
    this.log(`jobToken \u5DF2\u4EA4\u6362: ${jobToken.name} (${jobToken.id})`);
    return jobToken;
  }
  /**
   * 换一枚 sash 面专用的令牌（`POST /api/v1/jobToken/exchange`）。
   *
   * **不抛**：这一族换不到时 sash 那一支会回落到旧令牌（国内版本来就够用），
   * 而整条交换失败只该让「积分读不到」，不该让 chat / 对话跟着挂 —— 那是完全
   * 不同的两条链路。
   *
   * body 键是 `personal_token`：实测 `personal_access_token`（eghrhegpe 那个 fork
   * 用的拼写）在当前上游回 **400 BadRequest**，两个区域都是。
   */
  async refreshSashToken(credential, holder) {
    const url = `${this.region.openapi}${SASH_TOKEN_PATH}`;
    try {
      const resp = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ personal_token: credential })
      });
      const text2 = await resp.text();
      if (resp.status !== 200) {
        this.log(`sash \u4EE4\u724C\u4EA4\u6362\u5931\u8D25\uFF08HTTP ${resp.status}\uFF09\uFF0Csash \u9762\u5C06\u56DE\u843D\u5230\u65E7\u4EE4\u724C: ${truncate(text2, 120)}`);
        return;
      }
      const data = parseJson(text2);
      const raw = data === void 0 ? {} : data;
      const token = typeof raw["token"] === "string" && raw["token"] !== "" ? raw["token"] : typeof raw["job_token"] === "string" && raw["job_token"] !== "" ? raw["job_token"] : typeof raw["jobToken"] === "string" && raw["jobToken"] !== "" ? raw["jobToken"] : "";
      if (token === "") {
        this.log(`sash \u4EE4\u724C\u4EA4\u6362\u54CD\u5E94\u91CC\u6CA1\u6709 token \u5B57\u6BB5: ${truncate(text2, 120)}`);
        return;
      }
      holder.sashToken = token;
      const expiry = typeof raw["expires_at"] === "string" ? Date.parse(raw["expires_at"]) : Number.NaN;
      holder.sashExpireAtMs = Number.isFinite(expiry) ? expiry : 0;
      this.log(`sash \u4EE4\u724C\u5DF2\u4EA4\u6362\uFF08\u6709\u6548\u671F\u81F3 ${holder.sashExpireAtMs > 0 ? new Date(holder.sashExpireAtMs).toISOString() : "\u672A\u77E5"}\uFF09`);
    } catch (error) {
      this.log(`sash \u4EE4\u724C\u4EA4\u6362\u5F02\u5E38\uFF0Csash \u9762\u5C06\u56DE\u843D\u5230\u65E7\u4EE4\u724C: ${String(error?.message ?? error).slice(0, 120)}`);
    }
  }
  /**
   * 取该会话用于 **sash 面** 的 Authorization 值。
   *
   * 新令牌优先（国际版必需）；没有就回落到旧的 `securityOauthToken`（国内版
   * 两个面都认它，而且它是 chat 在用的那一个 —— 回落不会破坏任何东西）。
   *
   * 返回 `''` 表示两族都没有：那一支必须报「读不到」，绝不能带上一个空 bearer
   * 去换一个 401 回来（那样分不清是没令牌还是令牌被拒）。
   */
  sashBearerOf(holder) {
    if (typeof holder.sashToken === "string" && holder.sashToken !== "") return holder.sashToken;
    return holder.jobToken.securityOauthToken;
  }
  /**
   * 确保存在未过期会话。credential 提供 PAT 或 refreshToken（`drt-` 前缀）。
   * 已有有效会话时直接复用（不重复交换）。
   */
  async ensureSession(credential) {
    if (this.isSessionValid(credential)) {
      return this.holders.get(credential);
    }
    await this.exchangeJobToken(credential);
    return this.holders.get(credential);
  }
  /**
   * 拉取模型目录。响应形状（服务端 snake_case）：
   * `{"chat":[{key, display_name, enable, is_vl, is_default, ...}], ...}`
   */
  async fetchModels(credential, signal) {
    const holder = await this.ensureSession(credential);
    const url = `${this.region.gateway}${this.region.modelsPath}`;
    const data = await this.bearerGet(holder, url, signal);
    const chat = Array.isArray(data.chat) ? data.chat : [];
    return chat.map((entry) => {
      if (!entry || typeof entry !== "object") return void 0;
      const raw = entry;
      const key = typeof raw.key === "string" ? raw.key : "";
      const displayName = typeof raw.display_name === "string" ? raw.display_name : "";
      if (!key || !displayName) return void 0;
      return {
        key,
        display_name: displayName,
        enable: raw.enable !== false,
        is_default: raw.is_default === true,
        is_vl: raw.is_vl === true,
        is_reasoning: raw.is_reasoning === true,
        is_free: raw.is_free === true,
        price_factor: typeof raw.price_factor === "number" ? raw.price_factor : void 0,
        max_input_tokens: typeof raw.max_input_tokens === "number" ? raw.max_input_tokens : void 0,
        max_output_tokens: typeof raw.max_output_tokens === "number" ? raw.max_output_tokens : void 0,
        thinking_config: typeof raw.thinking_config === "object" ? raw.thinking_config : void 0,
        context_config: typeof raw.context_config === "object" ? raw.context_config : void 0,
        raw
      };
    }).filter((m) => m !== void 0).filter((model) => !isRouterModelId(model.key));
  }
  /**
   * 聊天 SSE 流。onDelta 逐行回调；返回 null 表示正常结束。
   * 令牌：`credential` 只在会话续期时使用。
   */
  async chatStream(credential, modelKey, messages, options) {
    const holder = await this.ensureSession(credential);
    const template = deepClone(createChatBodyTemplate());
    applyModelKey(template, modelKey, options.userType ?? holder.jobToken.userType, options.isVl ?? false);
    if (options.isReasoning) {
      template.model_config.is_reasoning = true;
      template.chat_context.extra.modelConfig.is_reasoning = true;
    }
    if (options.reasoningEffort !== void 0 && options.reasoningEffort !== "") {
      template.reasoningEffort = options.reasoningEffort;
      const params = template.parameters ?? {};
      template.parameters = { ...params, reasoning_effort: options.reasoningEffort };
    }
    const prompt = extractLatestUserPrompt(messages);
    const built = buildQoderMessages(messages, prompt, Array.isArray(options.tools) && options.tools.length > 0);
    template.messages = built;
    if (options.tools !== void 0) {
      template.tools = options.tools;
    }
    template.request_id = randomId();
    template.chat_record_id = template.request_id;
    template.request_set_id = randomId();
    template.session_id = options.sessionId !== void 0 && options.sessionId !== "" ? options.sessionId : randomId();
    template.business.id = randomId();
    template.business.name = prompt.slice(0, 30) || "hi";
    template.business.begin_at = Date.now();
    const body = JSON.stringify(template);
    const url = `${this.region.gateway}${this.region.chatPath}`;
    const pathSig = pathSigFrom(url);
    const encoded = cosyEncode(new TextEncoder().encode(body));
    const date = String(Math.floor(Date.now() / 1e3));
    const payloadB64 = buildPayloadB64(holder.session.info);
    const sig = signRequest(payloadB64, holder.session.cosyKey, date, encoded, pathSig);
    const bearer = composeBearer(payloadB64, sig);
    const headers = {
      ...DEFAULT_HEADERS,
      "cosy-machinetype": holder.session.machineType,
      "cosy-date": date,
      "cosy-user": holder.session.identity.uid,
      "cosy-key": holder.session.cosyKey,
      "cache-control": "no-cache",
      accept: "text/event-stream",
      authorization: bearer,
      "cosy-version": COSY_VERSION_HEADER,
      "cosy-machineid": holder.session.machineId,
      "cosy-machinetoken": holder.session.machineToken,
      "x-model-key": modelKey,
      "x-model-source": "system"
    };
    const resp = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: encoded,
      ...options.signal === void 0 ? {} : { signal: options.signal }
    });
    if (resp.status !== 200) {
      const errText = await resp.text();
      throw new QoderUpstreamError(
        classifyFailure(resp.status, errText),
        `\u804A\u5929\u8BF7\u6C42\u5931\u8D25: HTTP ${resp.status} ${truncate(errText, 300)}`,
        resp.status,
        deepestBusinessCode(errText),
        // 上游申报的重试间隔（issue #24）：`10605 / RESOURCE_LIMIT` 就走这条
        // 路径进来，以前读到即丢，用户只看到「上游报了个 4xx」。
        retryAfterMsOf(errText) ?? retryAfterMsOfHeader(resp.headers.get("retry-after")),
        // issue #26：排队证据（`isQueued`）与重试间隔在同一个信封里，一并带出。
        queueOf(errText)
      );
    }
    if (!resp.body) {
      throw new QoderUpstreamError("transient", "\u804A\u5929\u54CD\u5E94\u6CA1\u6709 body");
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "" || !trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice("data:".length).trim();
          if (payload === "[DONE]") continue;
          const delta = parseStreamDelta(payload);
          if (delta !== void 0) options.onDelta(delta);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  /**
   * 查询用量（只读）。`GET {openapi}/sash/api/v2/me/usage`。
   *
   * **认证用的是 jobToken 里的 `securityOauthToken`（`jt-…`），不是 PAT，
   * 也不是 COSY 签名 bearer。** 三者实测（2026-10，CN）：
   *
   * | 凭据 | 结果 |
   * | --- | --- |
   * | 裸 PAT `pt-…` | 401 `TOKEN_EXPIRE / token is not active` |
   * | COSY 签名 bearer（chat/models 用的那套） | 401 `TOKEN_INVALID / invalid token` |
   * | `jt-…`（jobToken 交换产出） | **200，返回完整 qoderUsage** |
   *
   * 前两种之所以失败，是因为 `sash` 是**浏览器会话面**的接口：它既不收 PAT，
   * 也不认 cosy 协议头（缺 Authorization 时它回
   * `UNAUTHORIZED / missing cookie header`，可见它本来是给 cookie 会话用的）。
   * 这解释了「令牌明明是好的、聊天也正常，积分却永远拿不到」——以前用错凭据。
   */
  async fetchUsage(credential, signal) {
    const url = `${this.region.openapi}/sash/api/v2/me/usage`;
    try {
      const holder = await this.ensureSession(credential);
      const data = await this.jobTokenGet(holder, url, signal);
      return parseUsage(data);
    } catch (error) {
      if (error instanceof QoderUpstreamError && (error.status === 401 || error.status === 403)) {
        const direct = await this.fetchUsageDirect(url, credential, signal);
        if (direct !== void 0) return direct;
        throw error;
      }
      return void 0;
    }
  }
  /**
   * `sash` 系列接口的取数：带 `Authorization: Bearer <jobToken.securityOauthToken>`。
   *
   * 与 {@link bearerGet} 的区别只有一个——**认证凭据不同**：`sash` 要的是
   * jobToken 交换产出的 `jt-…`，不是 COSY 签名 bearer（实测后者回
   * `TOKEN_INVALID / invalid token`），也不是裸 PAT（回 `TOKEN_EXPIRE`）。
   * 也正因为如此，这里**不**带那套 cosy-* 协议头：它们属于 cosy 协议面。
   * 但**设备风控三件套属于 sash 面**，按 `requiresDeviceRisk` 附加 —— 见下。
   */
  async jobTokenGet(holder, url, signal) {
    const oauthToken = this.sashBearerOf(holder);
    if (oauthToken === "") {
      throw new QoderUpstreamError("auth", "\u4E24\u6B21\u4EE4\u724C\u4EA4\u6362\u90FD\u6CA1\u6709\u62FF\u5230\u53EF\u7528\u4EE4\u724C\uFF0C\u65E0\u6CD5\u67E5\u8BE2\u7528\u91CF", 401);
    }
    const resp = await this.fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${oauthToken}`,
        ...await this.deviceRiskHeaders()
      },
      ...signal === void 0 ? {} : { signal }
    });
    const text2 = await resp.text();
    if (resp.status !== 200) {
      throw new QoderUpstreamError(classifyFailure(resp.status, text2), `\u8BF7\u6C42\u5931\u8D25: HTTP ${resp.status} ${truncate(text2, 200)}`, resp.status, deepestBusinessCode(text2));
    }
    try {
      return JSON.parse(text2);
    } catch {
      throw new QoderUpstreamError("unknown", `\u54CD\u5E94\u4E0D\u662F JSON: ${truncate(text2, 200)}`, resp.status);
    }
  }
  /**
   * 活动列表（`GET /sash/api/v1/me/campaigns?forceRefresh=true`）。
   *
   * 协议来自社区参考实现（L0NE-6/Qoder-Daily），已在本机 CN 账号实测通过：
   * `GET {openapi}/sash/api/v1/me/campaigns?forceRefresh=true`，认证用与用量
   * 查询同一套 `jt-` 令牌（`jobToken.securityOauthToken`）。
   *
   * 注意路径里**没有**「签到」二字——它叫 campaigns（活动/权益）。这也是我早期
   * 把 `checkinSupported` 写死成 false 的原因：照着 checkin / signin / reward
   * 猜路径一律 404（实测猜了 13 个），于是误判成「Qoder 没有签到」。
   *
   * 旧语义（签到挑用的那一小片）保留在这里：它就是 `fetchCampaignFeed` 的
   * `campaigns` 投影，免得签到路径与卡片展示路径各写一份解析、日后漂移。
   */
  async fetchCampaigns(credential, signal) {
    return (await this.fetchCampaignFeed(credential, signal)).campaigns;
  }
  /**
   * 完整活动面（含 `VIEW_DETAILS` banner 与顶层字段），给卡片「活动」区用。
   *
   * 实测（CN，2026-10-25）返回的整份形状：
   * `{ uid, showCampaign, claimable, campaignUrl, campaigns:[{ campaignId, campaignKey,
   *   actionType, startAt, endAt, claimStatus, benefit:{...},
   *   placements:[{ type, campaignUrl, content:{ zh:{title,description,detailUrl},
   *   en:{...} } }] }] }`。标题 / 描述 / 「查看详情」链接都在 `placements[*].content`
   * 里，按语言各一份；上游只下发它有的语言，所以这里原样收拢，不做翻译。
   *
   * 解析对字段缺席是**宽容**的：活动形状常按节日变（1024 集结、首月翻倍这类只在
   * 当期下发），缺字段就少渲染一点，绝不替上游编标题或链接。
   */
  async fetchCampaignFeed(credential, signal) {
    const holder = await this.ensureSession(credential);
    const url = `${this.region.openapi}${this.region.campaignsPath}${CAMPAIGNS_QUERY}`;
    const data = await this.sashRequest("GET", holder, url, void 0, signal);
    const rows = Array.isArray(data.campaigns) ? data.campaigns : Array.isArray(data.data?.campaigns) ? data.data.campaigns : [];
    return {
      campaigns: rows.map((entry) => projectCampaignEntry(entry)).filter((c) => c !== void 0),
      ...typeof data.campaignUrl === "string" && data.campaignUrl !== "" ? { campaignUrl: data.campaignUrl } : {},
      ...typeof data.showCampaign === "boolean" ? { showCampaign: data.showCampaign } : {},
      ...typeof data.claimable === "boolean" ? { claimable: data.claimable } : {}
    };
  }
  /**
   * 签到：领取今天那一份每日 Credits。
   *
   * 一次调用自足——先拉活动列表找出可领的那条，再领取。三种结果分得很清：
   *   - `claimed`：领到了（带回数额与有效期）；
   *   - `already-claimed`：今天已经领过（`CLAIMED` / 409 / `ALREADY_CLAIMED` /
   *     `replayed`），**不是错误**——重复调用是幂等的；
   *   - `unavailable`：今天上游没下发活动（未开窗 / 已领到活动行消失 / 企业号
   *     不支持该活动），带上说明。
   */
  async claimDailyCredits(credential, signal) {
    const campaigns = await this.fetchCampaigns(credential, signal);
    const daily = campaigns.find((c) => c.actionType === "CLAIM_BENEFIT");
    const claimable = campaigns.find((c) => c.actionType === "CLAIM_BENEFIT" && c.claimStatus === "CLAIMABLE");
    const nextRefreshAtMs = daily?.endAt === void 0 ? void 0 : daily.endAt * 1e3;
    if (claimable === void 0) {
      const claimed = daily?.claimStatus === "CLAIMED";
      return claimed ? { status: "already-claimed", ...nextRefreshAtMs === void 0 ? {} : { nextRefreshAtMs } } : { status: "unavailable", message: "\u4E0A\u6E38\u4ECA\u65E5\u6CA1\u6709\u4E0B\u53D1\u53EF\u9886\u53D6\u7684\u7B7E\u5230\u6D3B\u52A8" };
    }
    const holder = await this.ensureSession(credential);
    const url = `${this.region.openapi}${this.region.campaignsPath}/${encodeURIComponent(claimable.campaignId)}/claim`;
    try {
      const data = await this.sashRequest("POST", holder, url, {}, signal);
      if (String(data.status ?? "") === "CLAIMED") {
        return {
          status: "claimed",
          ...claimable.amount === void 0 ? {} : { amount: claimable.amount },
          ...claimable.validityDays === void 0 ? {} : { validityDays: claimable.validityDays },
          ...nextRefreshAtMs === void 0 ? {} : { nextRefreshAtMs }
        };
      }
      return { status: "unavailable", message: `\u7B7E\u5230\u672A\u5B8C\u6210\uFF08\u4E0A\u6E38\u72B6\u6001 ${String(data.status ?? "\u672A\u77E5")}\uFF09` };
    } catch (error) {
      if (error instanceof QoderUpstreamError && error.status === 409) {
        return { status: "already-claimed", ...nextRefreshAtMs === void 0 ? {} : { nextRefreshAtMs } };
      }
      throw error;
    }
  }
  /**
   * `sash` 接口的通用请求（活动列表 / 领取共用）。
   *
   * 认证与用量查询同一套：`Authorization: Bearer <jobToken.securityOauthToken>`。
   * 但那两个接口需要 `cosy-clienttype: 10` 与 `user-agent: Qoder`——参考实现
   * 如此，缺了会被拒；而夹带 cosy 协议头（chat/models 那套）反而不认。
   *
   * 这里的 `10` 与 cosy 面的 {@link COSY_CLIENT_TYPE} **恰好同值但不同源**：
   * 这条是 sash 面自己的客户端标识（`SASH_CLIENT_TYPE`，逐条手写请求头），
   * 改 cosy 面的协议版本不该顺手动它，反之亦然。两个数字各自独立被测。sash 面
   * 也**不**发 `cosy-version`：它本来就不带那套协议头。
   *
   * **国际版额外需要设备风控头**（`Cosy-MachineToken/Code/Type`，见 device-risk.ts）：
   * 签到活动只下发给带这些头的请求，缺了就拿不到活动列表。国内版不需要，所以按
   * region 条件附加 —— 不要无条件发，多余的头在另一侧是噪音。
   */
  async sashRequest(method, holder, url, body, signal) {
    const oauthToken = this.sashBearerOf(holder);
    if (oauthToken === "") {
      throw new QoderUpstreamError("auth", "\u4E24\u6B21\u4EE4\u724C\u4EA4\u6362\u90FD\u6CA1\u6709\u62FF\u5230\u53EF\u7528\u4EE4\u724C\uFF0C\u65E0\u6CD5\u8BBF\u95EE\u7B7E\u5230\u63A5\u53E3", 401);
    }
    const resp = await this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${oauthToken}`,
        "cosy-clienttype": SASH_CLIENT_TYPE,
        accept: "application/json",
        "accept-language": "zh-CN",
        "user-agent": SASH_USER_AGENT,
        ...await this.deviceRiskHeaders(),
        ...method === "POST" ? { "content-type": "application/json", origin: this.region.openapi } : {}
      },
      ...method === "POST" ? { body: JSON.stringify(body ?? {}) } : {},
      ...signal === void 0 ? {} : { signal }
    });
    const text2 = await resp.text();
    if (resp.status !== 200 && resp.status !== 201) {
      throw new QoderUpstreamError(classifyFailure(resp.status, text2), `\u8BF7\u6C42\u5931\u8D25: HTTP ${resp.status} ${truncate(text2, 200)}`, resp.status, deepestBusinessCode(text2));
    }
    try {
      return JSON.parse(text2);
    } catch {
      throw new QoderUpstreamError("unknown", `\u54CD\u5E94\u4E0D\u662F JSON: ${truncate(text2, 200)}`, resp.status);
    }
  }
  /**
   * 本区域签到需要的设备风控头。
   *
   * 国内版返回空对象（不需要，发了反而是噪音）；国际版读取本机 UMID 组件的
   * 三件套。读取失败**不**静默降级成「无头请求」——那样只会拿到一个空的活动
   * 列表，用户看到「今天没有活动」而真实原因是取不到设备身份。所以这里让错误
   * 抛出去，由调用方带着原因回报。
   */
  async deviceRiskHeaders() {
    if (!this.region.requiresDeviceRisk) return {};
    const risk = await readDeviceRisk(this.regionKey);
    return {
      "cosy-machinetoken": risk.machineToken,
      "cosy-machinecode": risk.machineCode,
      "cosy-machinetype": risk.machineType
    };
  }
  /**
   * 直连回退：`Bearer <PAT>` 打同一个端点。返回 undefined 表示这条回退路径
   * 也没给出 200（端点不接受直连 PAT，或网络失败）——由调用方决定是否把原始
   * 的凭据被拒错误抛出去。
   */
  async fetchUsageDirect(url, credential, signal) {
    try {
      const resp = await this.fetchImpl(url, {
        headers: {
          authorization: `Bearer ${credential}`,
          accept: "application/json",
          "cosy-clienttype": "10",
          "user-agent": "Qoder",
          ...await this.deviceRiskHeaders()
        },
        ...signal === void 0 ? {} : { signal }
      });
      if (resp.status === 200) {
        const data = await resp.json();
        return parseUsage(data);
      }
      if (resp.status === 401 || resp.status === 403) {
        return void 0;
      }
    } catch {
    }
    return void 0;
  }
  async bearerGet(holder, url, signal) {
    const pathSig = pathSigFrom(url);
    const payloadB64 = buildPayloadB64(holder.session.info);
    const date = String(Math.floor(Date.now() / 1e3));
    const sig = signRequest(payloadB64, holder.session.cosyKey, date, "", pathSig);
    const bearer = composeBearer(payloadB64, sig);
    const headers = {
      ...DEFAULT_HEADERS,
      "cosy-machinetype": holder.session.machineType,
      "cosy-date": date,
      "cosy-user": holder.session.identity.uid,
      "cosy-key": holder.session.cosyKey,
      accept: "application/json",
      authorization: bearer,
      "cosy-version": COSY_VERSION_HEADER,
      "cosy-machineid": holder.session.machineId,
      "cosy-machinetoken": holder.session.machineToken
    };
    const resp = await this.fetchImpl(url, {
      headers,
      ...signal === void 0 ? {} : { signal }
    });
    const text2 = await resp.text();
    if (resp.status !== 200) {
      throw new QoderUpstreamError(classifyFailure(resp.status, text2), `\u8BF7\u6C42\u5931\u8D25: HTTP ${resp.status} ${truncate(text2, 200)}`, resp.status, deepestBusinessCode(text2));
    }
    try {
      return JSON.parse(text2);
    } catch {
      throw new QoderUpstreamError("unknown", `\u54CD\u5E94\u4E0D\u662F JSON: ${truncate(text2, 200)}`, resp.status);
    }
  }
};
function projectCampaignEntry(entry) {
  if (!entry || typeof entry !== "object") return void 0;
  const raw = entry;
  const campaignId = typeof raw.campaignId === "string" ? raw.campaignId : "";
  if (campaignId === "") return void 0;
  const benefit = typeof raw.benefit === "object" && raw.benefit !== null ? raw.benefit : {};
  const validity = typeof benefit.validity === "object" && benefit.validity !== null ? benefit.validity : {};
  const placements = Array.isArray(raw.placements) ? raw.placements : [];
  let campaignUrl = "";
  const content = {};
  for (const p of placements) {
    if (!p || typeof p !== "object") continue;
    const slot = p;
    if (campaignUrl === "" && typeof slot.campaignUrl === "string") campaignUrl = slot.campaignUrl;
    const slotContent = slot.content;
    if (!slotContent || typeof slotContent !== "object") continue;
    for (const [lang, text2] of Object.entries(slotContent)) {
      if (!text2 || typeof text2 !== "object") continue;
      const t = text2;
      const row = {
        ...typeof t.title === "string" ? { title: t.title } : {},
        ...typeof t.description === "string" ? { description: t.description } : {},
        ...typeof t.detailUrl === "string" ? { detailUrl: t.detailUrl } : {},
        ...typeof t.buttonText === "string" ? { buttonText: t.buttonText } : {}
      };
      const prior = content[lang];
      if (prior === void 0 || Object.keys(prior).length === 0 && Object.keys(row).length > 0) {
        content[lang] = row;
      }
    }
  }
  return {
    campaignId,
    actionType: typeof raw.actionType === "string" ? raw.actionType : "",
    claimStatus: typeof raw.claimStatus === "string" ? raw.claimStatus : "",
    ...typeof raw.campaignKey === "string" && raw.campaignKey !== "" ? { campaignKey: raw.campaignKey } : {},
    ...campaignUrl !== "" ? { campaignUrl } : {},
    ...typeof benefit.amount === "number" ? { amount: benefit.amount } : {},
    // `mode` 缺席时按相对天数处理：这是上游至今给过的唯一口径，也是 activity
    // 文案「领取后 30 天有效」的说法。但**显式的**其它 mode 一律不采用天数 ——
    // 见 `QoderCampaign.validityDays` 的注释。
    ...typeof validity.days === "number" && (validity.mode === void 0 || validity.mode === "RELATIVE_DAYS") ? { validityDays: validity.days } : {},
    // 活动窗：秒 → 毫秒之外的**原值也留着**，倒计时由 UI 按 region 的时区算。
    // 这里保留秒，因为 `endAt` 与 `startAt` 同源同单位，混着传才容易错。
    ...typeof raw.startAt === "number" ? { startAt: raw.startAt } : {},
    ...typeof raw.endAt === "number" ? { endAt: raw.endAt } : {},
    ...Object.keys(content).length > 0 ? { content } : {}
  };
}
function jobTokenBody(credential) {
  const isRefresh = credential.startsWith("drt-");
  const inner = {
    personalToken: isRefresh ? "" : credential,
    securityOauthToken: "",
    refreshToken: isRefresh ? credential : "",
    needRefresh: isRefresh,
    authInfo: {}
  };
  const outer = { payload: JSON.stringify(inner), encodeVersion: "1" };
  const plain = JSON.stringify(outer);
  return cosyEncode(new TextEncoder().encode(plain));
}
function randomId() {
  return crypto.randomUUID();
}
function parseStreamDelta(dataPayload) {
  let wrapper;
  try {
    wrapper = JSON.parse(dataPayload);
  } catch {
    return void 0;
  }
  const scv = wrapper.statusCodeValue;
  if (scv !== void 0 && scv !== null && Number(scv) !== 200) {
    const detail = typeof wrapper.body === "string" ? wrapper.body : dataPayload.slice(0, 400);
    throw new QoderUpstreamError(
      classifyFailure(Number(scv), detail),
      `\u4E0A\u6E38\u4FE1\u5C01\u9519\u8BEF: HTTP ${scv} ${truncate(detail, 300)}`,
      Number(scv),
      deepestBusinessCode(detail),
      // issue #24 的现场就是这条：`code 10605 / subCode RESOURCE_LIMIT` 的信封
      // 里带着 `retryAfterSeconds`，此前读到即丢。
      retryAfterMsOf(detail),
      // issue #26：同一个信封里还带着 `isQueued` —— 上游明说「在排队、服务
      // 可用、30 秒后再来」。此前这条被整段丢掉，池子把它报成「连不上上游」。
      queueOf(detail)
    );
  }
  const innerStr = wrapper.body;
  if (typeof innerStr !== "string" || innerStr === "") return void 0;
  let inner;
  try {
    inner = JSON.parse(innerStr);
  } catch {
    return void 0;
  }
  if (inner === null || typeof inner !== "object") return void 0;
  if (typeof inner.code === "string" && inner.code !== "" && inner.code !== "0") {
    const detail = typeof inner.message === "string" ? inner.message : JSON.stringify(inner.message ?? "");
    throw new QoderUpstreamError(
      classifyBusinessCode(inner.code),
      `\u4E0A\u6E38\u4E1A\u52A1\u9519\u8BEF code=${inner.code}: ${String(inner.message ?? "")}`,
      0,
      inner.code,
      // issue #26：业务码帧里同样可能带着排队信封（`isQueued` + 等待秒数）。
      retryAfterMsOf(detail),
      queueOf(detail)
    );
  }
  const usageIn = readTokens(inner.usage, "prompt_tokens");
  const usageOut = readTokens(inner.usage, "completion_tokens");
  const usageCached = readCachedTokens(inner.usage);
  const tokens = usageCached === void 0 ? { inputTokens: usageIn, outputTokens: usageOut } : { inputTokens: usageIn, outputTokens: usageOut, cachedTokens: usageCached };
  const choices = Array.isArray(inner.choices) ? inner.choices : [];
  for (const ch of choices) {
    const delta = ch.delta;
    if (!delta) continue;
    const role = typeof delta.role === "string" ? delta.role : "";
    const content = typeof delta.content === "string" ? delta.content : "";
    const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
    const toolCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0 ? delta.tool_calls : void 0;
    if (role !== "" || content !== "" || reasoning !== "" || toolCalls !== void 0) {
      return { role, content, reasoningContent: reasoning, toolCalls, ...tokens };
    }
  }
  if (usageIn > 0 || usageOut > 0) {
    return { role: "", content: "", reasoningContent: "", toolCalls: void 0, ...tokens };
  }
  return void 0;
}
function readTokens(usage, key) {
  if (!usage || typeof usage !== "object") return 0;
  const v = usage[key];
  return typeof v === "number" ? v : 0;
}
function readCachedTokens(usage) {
  if (!usage || typeof usage !== "object") return void 0;
  const record = usage;
  const details = record["prompt_tokens_details"];
  const fromDetails = details !== null && typeof details === "object" && !Array.isArray(details) ? readCount(details["cached_tokens"]) : void 0;
  if (fromDetails !== void 0) return fromDetails;
  const fromHit = readCount(record["prompt_cache_hit_tokens"]);
  if (fromHit !== void 0) return fromHit;
  return readCount(record["cached_tokens"]);
}
function readCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function parseUsage(data) {
  const qoderUsage = data.qoderUsage;
  const source = qoderUsage ?? data;
  const userQuota = readBucket(source.userQuota);
  const addOn = source.addOnQuota;
  const org = source.orgResourcePackage;
  const out = {
    userType: typeof source.userType === "string" ? source.userType : void 0,
    expiresAt: typeof source.expiresAt === "number" ? source.expiresAt : void 0,
    upgradeUrl: typeof source.upgradeUrl === "string" ? source.upgradeUrl : void 0,
    isQuotaExceeded: source.isQuotaExceeded === true
  };
  if (userQuota) out.userQuota = userQuota;
  if (addOn) {
    out.addOnQuota = {
      ...readBucket(addOn),
      detailUrl: typeof addOn.detailUrl === "string" ? addOn.detailUrl : void 0
    };
  }
  if (org) {
    out.orgResourcePackage = {
      used: num(org.used),
      cap: num(org.cap),
      remaining: num(org.remaining),
      percentage: num(org.percentage),
      available: org.available === true
    };
  }
  const dedicated = readDedicatedPackages(source.dedicatedResourcePackages);
  if (dedicated.length > 0) out.dedicatedResourcePackages = dedicated;
  return out;
}
function readDedicatedPackages(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item;
    if (raw["available"] === false) continue;
    const status = typeof raw["status"] === "string" ? raw["status"] : void 0;
    if (status !== void 0 && status !== DEDICATED_ACTIVE_STATUS) continue;
    const title = readI18nLabel(raw["displayLabels"], "title");
    const description = readI18nLabel(raw["displayLabels"], "description");
    out.push({
      // id 缺席时用下标位置兜底会让 React key 在同一次报文内相对稳定；但上游
      // 实测恒有 id，所以这里退化成 name 或空串都只是防御，不额外编造。
      id: typeof raw["id"] === "string" && raw["id"] !== "" ? raw["id"] : typeof raw["name"] === "string" ? raw["name"] : "",
      ...title === void 0 ? {} : { title },
      ...description === void 0 ? {} : { description },
      // 负数不是上游可能给出的余额（实测恒 >= 0）；真出现时按 0 读 —— 一个
      // 「剩余 -5」出现在读数里只会让读者以为是插件算错了。非有限数照旧当成
      // 「没报」（`num` 只放行 `typeof number`，NaN 会落进来，这里挡掉）。
      ...!isFiniteNumber(num(raw["remaining"])) ? {} : { remaining: Math.max(num(raw["remaining"]), 0) },
      ...!isFiniteNumber(num(raw["total"])) ? {} : { total: num(raw["total"]) },
      ...!isFiniteNumber(num(raw["expiresAt"])) ? {} : { expiresAtMs: num(raw["expiresAt"]) },
      ...status === void 0 ? {} : { status }
    });
  }
  return out;
}
var DEDICATED_ACTIVE_STATUS = "QUOTA_DETAIL_STATUS_ACTIVE";
function isFiniteNumber(value) {
  return value !== void 0 && Number.isFinite(value);
}
function readI18nLabel(labels, dimension) {
  if (!Array.isArray(labels)) return void 0;
  for (const entry of labels) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry;
    if (row["dimension"] !== dimension) continue;
    const i18n = row["valueI18n"];
    const zh = i18n !== null && typeof i18n === "object" && !Array.isArray(i18n) ? textOf(i18n["zh-CN"]) ?? textOf(i18n["zh"]) : void 0;
    const en = i18n !== null && typeof i18n === "object" && !Array.isArray(i18n) ? textOf(i18n["en-US"]) ?? textOf(i18n["en"]) : void 0;
    const plain = textOf(row["value"]);
    if (zh === void 0 && en === void 0 && plain === void 0) return void 0;
    return {
      ...zh === void 0 && plain === void 0 ? {} : { zh: zh ?? plain },
      ...en === void 0 && plain === void 0 ? {} : { en: en ?? plain }
    };
  }
  return void 0;
}
function textOf(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed === "" ? void 0 : trimmed;
}
function readBucket(value) {
  if (!value || typeof value !== "object") return void 0;
  const v = value;
  return {
    total: num(v.total),
    used: num(v.used),
    remaining: num(v.remaining),
    percentage: num(v.percentage)
  };
}
function num(v) {
  return typeof v === "number" ? v : void 0;
}
function classifyHttpStatus(status, detail) {
  if (isContentPolicy(detail)) return "content-policy";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limited";
  if (status === 400) return "invalid-request";
  if (status === 418 || status >= 500) return "transient";
  return "unknown";
}
var MAX_CODE_NESTING = 6;
var MAX_RETRY_AFTER_MS = 36e5;
function retryAfterMsOfHeader(value, nowMs = Date.now()) {
  if (typeof value !== "string" || value.trim() === "") return void 0;
  const text2 = value.trim();
  if (/^\d+$/u.test(text2)) {
    const seconds = Number(text2);
    const ms2 = Math.round(seconds * 1e3);
    return ms2 > 0 && ms2 <= MAX_RETRY_AFTER_MS ? ms2 : void 0;
  }
  const at = Date.parse(text2);
  if (!Number.isFinite(at)) return void 0;
  const ms = at - nowMs;
  return ms > 0 && ms <= MAX_RETRY_AFTER_MS ? ms : void 0;
}
function retryAfterMsOf(detail) {
  for (const record of envelopeRecords(detail)) {
    const seconds = record.retryAfterSeconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
      const ms = Math.round(seconds * 1e3);
      return ms <= MAX_RETRY_AFTER_MS ? ms : void 0;
    }
  }
  return void 0;
}
function envelopeRecords(detail) {
  const records = [];
  let text2 = typeof detail === "string" ? detail.trim() : "";
  for (let depth = 0; depth < MAX_CODE_NESTING; depth += 1) {
    let record;
    if (typeof text2 === "string") {
      if (!text2.startsWith("{")) break;
      const parsed = parseJson(text2);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) break;
      record = parsed;
    } else if (typeof text2 === "object" && text2 !== null && !Array.isArray(text2)) {
      record = text2;
    } else {
      break;
    }
    records.push(record);
    const message = record.message;
    if (typeof message === "string") {
      text2 = message.trim();
    } else if (typeof message === "object" && message !== null && !Array.isArray(message)) {
      text2 = message;
    } else {
      break;
    }
  }
  return records;
}
function queueOf(detail) {
  for (const record of envelopeRecords(detail)) {
    const isQueued = record.isQueued;
    if (typeof isQueued !== "boolean") continue;
    const count = record.queueCount;
    const queueType = record.queueType;
    const seconds = record.retryAfterSeconds;
    const serviceAvailable = record.serviceAvailable;
    return {
      isQueued,
      ...typeof count === "number" && Number.isFinite(count) && count >= 0 ? { queueCount: count } : {},
      ...typeof queueType === "string" && queueType !== "" ? { queueType } : {},
      ...typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: seconds } : {},
      ...typeof serviceAvailable === "boolean" ? { serviceAvailable } : {}
    };
  }
  return void 0;
}
function upstreamUnavailableOf(queue) {
  if (queue === void 0) return false;
  if (queue.isQueued !== true) return false;
  return queue.serviceAvailable === false;
}
function deepestBusinessCode(detail) {
  let fallback;
  for (const record of envelopeRecords(detail)) {
    const raw = record.code;
    let code;
    if (typeof raw === "string" && raw !== "") code = raw;
    else if (typeof raw === "number" && Number.isInteger(raw)) code = String(raw);
    if (code !== void 0) {
      if (classifyBusinessCode(code) !== "unknown") return code;
      if (fallback === void 0) fallback = code;
    }
  }
  return fallback;
}
function classifyFailure(status, detail) {
  const code = deepestBusinessCode(detail);
  if (code !== void 0) {
    const byCode = classifyBusinessCode(code);
    if (byCode !== "unknown") return byCode;
  }
  return classifyHttpStatus(status, detail);
}
function classifyBusinessCode(code) {
  if (code === "105") return "auth";
  if (QUOTA_CODES.has(code)) return "quota-exhausted";
  if (code === "406") return "content-policy";
  if (REQUEST_CODES.has(code)) return "invalid-request";
  if (TRANSIENT_CODES.has(code)) return "transient";
  return "unknown";
}
var QUOTA_CODES = /* @__PURE__ */ new Set([
  "110",
  // 达到当日用量限制（本轮实测到的那一个）
  "112",
  // 额度不足，message 带 pricingUrl 指向充值页（issue #44）——模型级额度
  // 112 与 110/144 同族：额度不足、会恢复、换 PAT 无效。此前不在码表里 →
  // 403 回落 auth → credentialOutcomeOf 降级 unavailable → 文案「连不上上游」
  // + 整号冷却（issue #44 现场 6 个号同时如此）。维护者定性「模型额度用完，
  // 换模型即可」，归配额族后走 out-of-credit 冷却、到期自愈。
  "113",
  // 用量配额耗尽
  "115",
  // 达到免费用户配额
  "116",
  // 团队管理员 Credits 耗尽
  "117",
  // 团队成员 Credits 耗尽
  "118",
  // 个人 Credits 耗尽
  "119",
  // 所选模型的免费额度已用完
  "122",
  // Billing Group 的 Credits 达到上限
  "144",
  // 专属积分包余额不足（issue #45）—— message 带 modelKey，是按模型的额度
  // 144 与 110 同族（都是「额度不足」），只是粒度不同：110 是账号级当日次数，
  // 144 是某个专属包用完。此前 144 不在码表里 → 403 回落 auth → 宿主侧
  // 401 invalid_api_key + 账号被 credential-rejected 永久排除（充值也不自愈）。
  // 归到配额族后：shim 映射 429 quota_exceeded，池记录 out-of-credit 走冷却期、
  // 到期自动回池。探针记录了 modelId 时，exclusionOf 还会只排除那一个模型。
  "147",
  // 付费资源包余额不足（issue #48）—— 与 144 message 一字不差，只差
  // modelKey（qfmodel）与 subCode（MODEL_PAID_CONFIRM_REQUIRED）。官方码表
  // （docs.qoder.com/zh/cli/sdk/errors）当天抓文本 147 仍是 0 命中，又一个没写进
  // 文档的新码。漏码 → 403 回落 auth → 宿主 401 invalid_api_key「API 密钥无效」，
  // 用户被叫去换 PAT，而真正该做的是充值/换模型 —— 处置方式完全相反。
  // 与 144 同型：归配额族后走 out-of-credit 冷却、到期自愈，按 modelId 粒度排除。
  "402",
  "6004"
]);
var REQUEST_CODES = /* @__PURE__ */ new Set(["416", "430", "80411", "80412"]);
var TRANSIENT_CODES = /* @__PURE__ */ new Set(["500", "10408", "10500", "10605"]);
var CONTENT_POLICY_MARKERS = [
  "DataInspectionFailed",
  "inappropriate content",
  "input text data may contain",
  "ContentFilter",
  "SensitiveContent"
];
function isContentPolicy(detail) {
  return CONTENT_POLICY_MARKERS.some((marker) => detail.includes(marker));
}
function parseJson(text2) {
  try {
    return JSON.parse(text2);
  } catch {
    return void 0;
  }
}
function truncate(text2, max) {
  return text2.length <= max ? text2 : `${text2.slice(0, max)}\u2026`;
}

// ../core/failover-notice.ts
function shouldAnnounceFailover(input) {
  if (!input.switched) return false;
  if (input.kind === void 0) return false;
  if (input.fromAccountId === "") return false;
  return input.fromAccountId !== input.toAccountId;
}

// ../core/shim.ts
var CONTENT_TYPE_JSON = "application/json";
var REQUEST_BODY_LIMIT = 64 * 1024 * 1024;
var FAILOVER_ACCOUNT_GAP_MS = 2e3;
var QUEUE_WAIT_MAX_MS = 6e4;
function originIsLoopback(origin) {
  if (origin === void 0 || origin.trim() === "") return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
var KIND_HOST_CODE = {
  "rate-limited": "quota_exceeded"
};
function hostErrorCode(kind) {
  return KIND_HOST_CODE[kind] ?? ERROR_MAP[kind].code;
}
function hostMessageText(kind, message) {
  if (kind === "auth") return message;
  return message.replace(SANITIZE_BARE_STATUS, "4xx");
}
var SANITIZE_BARE_STATUS = /(?<![\w.])(?:401|403)(?!\d)(?!\.\d)/gu;
function sanitizeForHost(text2) {
  return text2.replace(SANITIZE_BARE_STATUS, "4xx");
}
function hostFailureMessage(kind, status, message, suffix = "") {
  if (kind === "auth") return message;
  return sanitizeForHost(`qoder upstream ${kind} (http ${status}): ${hostMessageText(kind, message)}${suffix}`);
}
function retryAfterNote(retryAfterMs) {
  if (retryAfterMs === void 0 || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return "";
  const seconds = retryAfterMs / 1e3;
  const shown = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return ` [upstream retry-after ${shown}s]`;
}
function hostFailureMessageOf(error, suffix = "") {
  return hostFailureMessage(error.kind, error.status, error.message, `${suffix}${retryAfterNote(error.retryAfterMs)}`);
}
var ERROR_MAP = {
  network: { status: 502, code: "connection_error" },
  auth: { status: 401, code: "invalid_api_key" },
  "rate-limited": { status: 429, code: "rate_limit_exceeded" },
  "invalid-request": { status: 400, code: "invalid_request_error" },
  "content-policy": { status: 400, code: "content_policy_rejected" },
  "quota-exhausted": { status: 429, code: "quota_exceeded" },
  transient: { status: 502, code: "upstream_error" },
  unknown: { status: 500, code: "upstream_error" }
};
function isFailoverEligible(kind) {
  return kind === "auth" || kind === "rate-limited" || kind === "quota-exhausted" || kind === "network" || kind === "transient";
}
function sleepAbortable(ms, signal) {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
function newCompletionDraft() {
  return { role: "", content: "", reasoning: "", notice: void 0, toolCalls: /* @__PURE__ */ new Map() };
}
function accumulateDelta(draft, delta) {
  if (delta.role !== "") draft.role = delta.role;
  draft.content += delta.content;
  draft.reasoning += delta.reasoningContent;
  if (delta.toolCalls === void 0) return;
  delta.toolCalls.forEach((raw, position) => {
    if (raw === null || typeof raw !== "object") return;
    const record = raw;
    const index = typeof record.index === "number" ? record.index : position;
    const fn = record.function ?? {};
    const current = draft.toolCalls.get(index) ?? { id: "", type: "function", name: "", arguments: "" };
    if (typeof record.id === "string" && record.id !== "") current.id = record.id;
    if (typeof record.type === "string" && record.type !== "") current.type = record.type;
    if (typeof fn.name === "string" && fn.name !== "" && current.name === "") current.name = fn.name;
    if (typeof fn.arguments === "string" && fn.arguments !== "") current.arguments += fn.arguments;
    draft.toolCalls.set(index, current);
  });
}
function buildCompletion(draft, meta) {
  const calls = [...draft.toolCalls.entries()].sort(([left], [right]) => left - right).map(([index, call]) => ({
    index,
    id: call.id || `call_${index}`,
    type: call.type || "function",
    function: { name: call.name, arguments: call.arguments }
  }));
  const notice = draft.notice === void 0 ? "" : `

> [qoder-cn] ${draft.notice}

`;
  const text2 = notice + draft.content;
  const message = {
    role: draft.role || "assistant",
    // 有工具调用而正文为空时按 OpenAI 语义给 null：空串会被读成「模型说了空话」。
    content: text2 === "" && calls.length > 0 ? null : text2
  };
  if (draft.reasoning !== "") message.reasoning_content = draft.reasoning;
  if (calls.length > 0) message.tool_calls = calls;
  const body = {
    id: meta.id,
    object: "chat.completion",
    created: meta.created,
    model: meta.model,
    choices: [{
      index: 0,
      message,
      finish_reason: calls.length > 0 ? "tool_calls" : "stop"
    }]
  };
  if (meta.inputTokens > 0 || meta.outputTokens > 0) {
    body.usage = {
      prompt_tokens: meta.inputTokens,
      completion_tokens: meta.outputTokens,
      total_tokens: meta.inputTokens + meta.outputTokens,
      // 与流式路径同一口径：`cached_tokens` 是 `prompt_tokens` 的子集。
      ...meta.cachedTokens === void 0 ? {} : { prompt_tokens_details: { cached_tokens: meta.cachedTokens } }
    };
  }
  return body;
}
function createQoderShim(options) {
  const { upstream } = options;
  const logger = options.logger ?? (() => {
  });
  const secret = randomBytes2(32).toString("base64url");
  const secretBuf = Buffer.from(secret);
  let baseUrlValue = "";
  let portValue = 0;
  let closeFn = async () => {
  };
  const ready = new Promise((resolveReady, rejectReady) => {
    const server = createServer((req, res) => {
      void handleRequest(req, res).catch((error) => {
        const upstream2 = isQoderUpstreamError(error);
        const status = upstream2 ? ERROR_MAP[error.kind].status : 500;
        const code = upstream2 ? hostErrorCode(error.kind) : "internal_error";
        const raw = String(error.message ?? "internal error");
        writeJson(res, status, {
          error: {
            message: upstream2 ? hostFailureMessageOf({ ...error, message: raw }) : raw,
            code,
            type: "qoder_error"
          }
        }, upstream2 ? error.retryAfterMs : void 0);
      });
    });
    server.on("error", (error) => {
      rejectReady(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrlValue = `http://127.0.0.1:${addr.port}`;
      portValue = addr.port;
      resolveReady();
    });
    closeFn = () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
  async function handleRequest(req, res) {
    if (!checkHost(req)) {
      writeJson(res, 403, { error: { message: "bad host", code: "host_not_allowed" } });
      return;
    }
    if (!originIsLoopback(req.headers.origin)) {
      writeJson(res, 403, { error: { message: "Origin must be a loopback origin", code: "origin_not_allowed" } });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/healthz/")) {
      if (!checkReadOnlyAuthorization(req, secretBuf)) {
        writeJson(res, 401, { error: { message: "invalid api key", code: "invalid_api_key" } });
        return;
      }
      writeJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      if (!checkReadOnlyAuthorization(req, secretBuf)) {
        writeJson(res, 401, { error: { message: "invalid api key", code: "invalid_api_key" } });
        return;
      }
      await handleModels(res);
      return;
    }
    if (!checkAuthorization(req, secretBuf)) {
      writeJson(res, 401, { error: { message: "invalid api key", code: "invalid_api_key" } });
      return;
    }
    if (!checkContentType(req)) {
      writeJson(res, 415, { error: { message: "unsupported media type", code: "invalid_request_error" } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      await handleChat(req, res);
      return;
    }
    writeJson(res, 404, { error: { message: "not found", code: "invalid_request_error" } });
  }
  function checkHost(req) {
    const host = req.headers.host ?? "";
    return /^127\.0\.0\.1:\d+$/.test(host);
  }
  function checkAuthorization(req, expected) {
    const header = req.headers.authorization;
    if (typeof header !== "string") return false;
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) return false;
    const actual = Buffer.from(match[1] ?? "");
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
  function checkReadOnlyAuthorization(req, expected) {
    if (checkAuthorization(req, expected)) return true;
    const header = req.headers.authorization;
    const match = typeof header === "string" ? /^Bearer (.+)$/.exec(header) : null;
    if (!match) return false;
    const credential = options.credential();
    if (!credential) return false;
    const actual = Buffer.from(match[1] ?? "");
    const wanted = Buffer.from(credential);
    if (actual.length !== wanted.length) return false;
    return timingSafeEqual(actual, wanted);
  }
  function checkContentType(req) {
    if (req.method === "GET") return true;
    const ct = req.headers["content-type"] ?? "";
    return ct.startsWith(CONTENT_TYPE_JSON);
  }
  function resolveFallbackCredential() {
    const pat = options.credential();
    if (!pat) {
      throw new QoderUpstreamError("auth", "\u672A\u914D\u7F6E Qoder PAT\uFF1A\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u586B\u5199\uFF0C\u6216\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF", 401);
    }
    return pat;
  }
  async function handleModels(res) {
    if (options.refreshModels !== void 0) await options.refreshModels();
    const ids = listModelIds();
    const models = ids.map((id) => ({
      id,
      object: "model",
      owned_by: "qoder",
      ...options.modelLimitsOf?.(id) ?? {}
    }));
    writeJson(res, 200, { object: "list", data: models });
  }
  function listModelIds() {
    return [...options.listModelIds?.() ?? []];
  }
  async function handleChat(req, res) {
    let raw;
    try {
      raw = await readBody(req, options.requestBodyLimit ?? REQUEST_BODY_LIMIT);
    } catch (error) {
      if (error.message === "request body too large") {
        writeJson(res, 413, { error: { message: "request body too large", code: "invalid_request_error" } });
        return;
      }
      throw error;
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      writeJson(res, 400, { error: { message: "invalid JSON body", code: "invalid_request_error" } });
      return;
    }
    const model = typeof body.model === "string" ? body.model : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const stream = body.stream === true;
    const sessionId = ["session_id", "x-session-affinity", "x-client-request-id"].map((name) => req.headers[name]).find((value) => typeof value === "string" && value !== "");
    if (messages.length === 0) {
      writeJson(res, 400, { error: { message: "messages is required", code: "invalid_request_error" } });
      return;
    }
    const key = options.modelKeyOf ? options.modelKeyOf(model) ?? model : model;
    const supportsImages = options.supportsImagesOf ? options.supportsImagesOf(model) : false;
    const savedEffort = options.reasoningEffortOf ? options.reasoningEffortOf(model) : void 0;
    const hasImages = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p?.type === "image_url"));
    if (hasImages && !supportsImages) {
      writeJson(res, 400, {
        error: {
          message: hostMessageText("invalid-request", `\u6A21\u578B ${model} \u4E0D\u652F\u6301\u56FE\u50CF\u8F93\u5165`),
          code: "invalid_request_error"
        }
      });
      return;
    }
    if (!stream) {
      logger(`shim: non-streaming request for ${model}; aggregating upstream SSE locally`);
    }
    const toolChoice = body.tool_choice;
    const tools = toolChoice === "none" || !Array.isArray(body.tools) ? void 0 : body.tools;
    const requestedOff = body.reasoning_effort === "off";
    const requestedEffort = typeof body.reasoning_effort === "string" && body.reasoning_effort !== "" ? body.reasoning_effort : void 0;
    const effort = savedEffort ?? requestedEffort;
    const isReasoning = effort !== void 0 && !requestedOff ? true : isReasoningRequested(body);
    const reasoningEffort = requestedOff ? void 0 : effort;
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    if (res.destroyed) controller.abort();
    let serving;
    try {
      serving = await (options.resolveServing ? options.resolveServing() : Promise.resolve(void 0));
      if (serving === void 0) {
        serving = { accountId: "default", accountName: "", pat: resolveFallbackCredential() };
      }
    } catch (error) {
      const upstream2 = isQoderUpstreamError(error);
      const mapped = upstream2 ? ERROR_MAP[error.kind] : { status: 500, code: "upstream_error" };
      const raw2 = String(error.message ?? "internal error");
      writeJson(res, mapped.status, {
        error: {
          message: upstream2 ? hostFailureMessageOf({ ...error, message: raw2 }) : raw2,
          code: mapped.code,
          type: "qoder_error"
        }
      }, upstream2 ? error.retryAfterMs : void 0);
      return;
    }
    const requestId = `chatcmpl-${randomBytes2(12).toString("hex")}`;
    const created = Math.floor(Date.now() / 1e3);
    const tried = [];
    const gapMs = options.failoverGapMs ?? FAILOVER_ACCOUNT_GAP_MS;
    const queueWaitMaxMs = options.queueWaitMaxMs ?? QUEUE_WAIT_MAX_MS;
    let queueWaited = false;
    let notice;
    let wroteBytes = false;
    for (; ; ) {
      let wroteAny = false;
      let hasToolCalls = false;
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedTokens;
      const draft = stream ? void 0 : newCompletionDraft();
      let sawDelta = false;
      try {
        await upstream.chatStream(serving.pat, key, messages, {
          ...tools === void 0 ? {} : { tools },
          isReasoning,
          ...reasoningEffort === void 0 ? {} : { reasoningEffort },
          ...sessionId === void 0 ? {} : { sessionId },
          isVl: supportsImages,
          signal: controller.signal,
          onDelta: (delta) => {
            if (draft !== void 0) {
              if (!sawDelta) {
                sawDelta = true;
                if (notice !== void 0 && !wroteBytes) draft.notice = notice;
              }
              if (delta.inputTokens > 0) inputTokens = delta.inputTokens;
              if (delta.outputTokens > 0) outputTokens = delta.outputTokens;
              if (delta.cachedTokens !== void 0) cachedTokens = delta.cachedTokens;
              accumulateDelta(draft, delta);
              return;
            }
            if (!wroteAny) {
              res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                // 反向代理（若有）不得缓冲 SSE。
                "X-Accel-Buffering": "no"
              });
              if (notice !== void 0 && !wroteBytes) {
                writeNoticeChunk(res, requestId, created, model, notice);
              }
              notice = void 0;
              wroteAny = true;
              wroteBytes = true;
            }
            if (delta.inputTokens > 0) inputTokens = delta.inputTokens;
            if (delta.outputTokens > 0) outputTokens = delta.outputTokens;
            if (delta.cachedTokens !== void 0) cachedTokens = delta.cachedTokens;
            if (delta.toolCalls !== void 0) hasToolCalls = true;
            writeDeltaChunk(res, requestId, created, model, delta);
          }
        });
        if (draft !== void 0) {
          if (res.destroyed) return;
          writeJson(res, 200, buildCompletion(draft, {
            id: requestId,
            created,
            model,
            inputTokens,
            outputTokens,
            cachedTokens
          }));
          return;
        }
        if (res.destroyed) return;
        const done = makeChunk(requestId, created, model);
        done.choices[0].finish_reason = hasToolCalls ? "tool_calls" : "stop";
        if (inputTokens > 0 || outputTokens > 0) {
          done.usage = {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
            // 缓存命中数透传给宿主（issue #4）。宿主 `parseChunkUsage` 读的正是
            // `prompt_tokens_details.cached_tokens`，缺了它就按 0 显示 ——
            // 于是 GUI 的「缓存命中」恒为 0%，而那个 0% 是不可信的读数。
            //
            // **不要把 `cachedTokens` 加进 `prompt_tokens` / `total_tokens`**：
            // 实测上游 `cached_tokens` 是 `prompt_tokens` 的子集（2032 / 2038），
            // 相加会把缓存前缀算两遍。宿主自己会做减法，两边各按「子集」理解。
            ...cachedTokens === void 0 ? {} : { prompt_tokens_details: { cached_tokens: cachedTokens } }
          };
        }
        res.write(`data: ${JSON.stringify(done)}

`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      } catch (error) {
        if (wroteAny) {
          writeErrorChunk(res, requestId, created, model, error);
          return;
        }
        if (!queueWaited && isQoderUpstreamError(error) && error.queue?.isQueued === true && !upstreamUnavailableOf(error.queue) && queueWaitMaxMs > 0 && error.retryAfterMs !== void 0 && error.retryAfterMs > 0 && error.retryAfterMs <= queueWaitMaxMs) {
          queueWaited = true;
          const waitMs = error.retryAfterMs;
          logger(`shim: upstream queued, waiting ${waitMs}ms before retrying ${key}`);
          await sleepAbortable(waitMs, controller.signal);
          if (controller.signal.aborted) return;
          continue;
        }
        if (isQoderUpstreamError(error) && isFailoverEligible(error.kind) && !controller.signal.aborted) {
          options.onServingFailure?.(serving.accountId, error.kind, error.message, {
            status: error.status,
            code: error.code,
            // issue #26：上游申报的等待时长与排队证据一并递过去。此前两者都
            // 没递，于是真实请求撞到排队时，池子把它记成「连不上上游」。
            ...error.retryAfterMs === void 0 ? {} : { retryAfterMs: error.retryAfterMs },
            ...error.queue === void 0 ? {} : { queue: error.queue }
          });
          tried.push(serving.accountId);
          let next;
          try {
            next = options.failoverAccount ? await options.failoverAccount(tried) : void 0;
          } catch {
            next = void 0;
          }
          if (next !== void 0 && options.isAccountExcluded?.(next.accountId) === true) {
            logger(`shim: failover candidate ${next.accountId} is already excluded; not retrying it`);
            next = void 0;
          }
          if (next !== void 0 && !tried.includes(next.accountId)) {
            logger(`shim failover: ${serving.accountId} \u2192 ${next.accountId} (${error.kind})`);
            const from = serving;
            const to = next;
            if (shouldAnnounceFailover({
              switched: true,
              fromAccountId: from.accountId,
              toAccountId: to.accountId,
              kind: error.kind
            }) && options.hasAnnouncedFailover?.(from, to, error.kind) !== true) {
              notice = options.failoverNotice?.(from, to, error.kind, {
                ...error.queue === void 0 ? {} : { queue: error.queue }
              });
            }
            serving = next;
            await sleepAbortable(gapMs, controller.signal);
            if (controller.signal.aborted) return;
            continue;
          }
        }
        if (isQoderUpstreamError(error)) {
          const note = tried.length > 1 ? ` (after trying ${tried.length} accounts)` : "";
          const mapped = ERROR_MAP[error.kind];
          writeJson(res, mapped.status, {
            error: {
              // 文案交给 `hostFailureMessageOf` 统一拼齐并净化：状态码由它加、也由
              // 它净化，`note` 与上游申报的重试间隔都从它过一遍（S3：拼在净化
              // 之后就会绕过）。
              message: hostFailureMessageOf({ ...error, message: error.message.slice(0, 400) }, note),
              code: hostErrorCode(error.kind),
              type: "qoder_error"
            }
          }, error.retryAfterMs);
          return;
        }
        throw error;
      }
    }
  }
  function isReasoningRequested(body) {
    const effort = typeof body.reasoning_effort === "string" ? body.reasoning_effort : void 0;
    if (effort === "off") return false;
    if (effort !== void 0 && effort !== "") return true;
    const streamOptions = body.stream_options;
    return streamOptions?.include_reasoning === true;
  }
  function writeNoticeChunk(res, id, created, model, notice) {
    const chunk = makeChunk(id, created, model);
    chunk.choices[0].delta.content = `

> [dsh-connect-qoder] ${notice}

`;
    res.write(`data: ${JSON.stringify(chunk)}

`);
  }
  function writeDeltaChunk(res, id, created, model, delta) {
    const chunk = makeChunk(id, created, model);
    const choice = chunk.choices[0];
    if (delta.role !== "") choice.delta.role = delta.role;
    if (delta.content !== "") choice.delta.content = delta.content;
    if (delta.reasoningContent !== "") choice.delta.reasoning_content = delta.reasoningContent;
    if (delta.toolCalls !== void 0) choice.delta.tool_calls = delta.toolCalls;
    res.write(`data: ${JSON.stringify(chunk)}

`);
  }
  function writeErrorChunk(res, id, created, model, error) {
    if (res.destroyed) return;
    const errChunk = makeChunk(id, created, model);
    errChunk.choices[0].finish_reason = "error";
    const upstream2 = isQoderUpstreamError(error);
    const code = upstream2 ? ERROR_MAP[error.kind].code : "upstream_error";
    const raw = String(error.message ?? "internal error");
    errChunk.error = {
      message: upstream2 ? hostFailureMessage(error.kind, error.status, raw) : raw,
      code,
      type: "qoder_error"
    };
    res.write(`data: ${JSON.stringify(errChunk)}

`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
  function makeChunk(id, created, model) {
    return {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: null }]
    };
  }
  function writeJson(res, status, body, retryAfterMs) {
    if (res.writableEnded || res.destroyed) return;
    const text2 = JSON.stringify(body);
    const headers = { "Content-Type": "application/json; charset=utf-8" };
    if (retryAfterMs !== void 0 && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      headers["Retry-After"] = String(Math.ceil(retryAfterMs / 1e3));
    }
    res.writeHead(status, headers);
    res.end(text2);
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let over = false;
      req.on("data", (chunk) => {
        if (over) return;
        size += chunk.length;
        if (size > limit) {
          over = true;
          reject(new Error("request body too large"));
          req.resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (!over) resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", reject);
    });
  }
  return {
    ready,
    get baseUrl() {
      return baseUrlValue;
    },
    get port() {
      return portValue;
    },
    secret,
    close: async () => {
      await closeFn();
    }
  };
}

// ../core/promo.ts
function text(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed === "" ? void 0 : trimmed;
}
function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function label(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
  const raw = value;
  const zh = text(raw["zh"]);
  const en = text(raw["en"]);
  if (zh === void 0 && en === void 0) return void 0;
  return {
    ...zh === void 0 ? {} : { zh },
    ...en === void 0 ? {} : { en }
  };
}
function clockMinute(value, role = "start") {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(value.trim());
  if (match === null) return void 0;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (role === "end" && hour === 24 && minute === 0) return 1440;
  if (hour > 23 || minute > 59) return void 0;
  return hour * 60 + minute;
}
function parsePromoWindow(startRaw, endRaw) {
  const start = text(startRaw);
  const end = text(endRaw);
  if (start === void 0 || end === void 0) return void 0;
  const startMinute = clockMinute(start);
  const endMinute = clockMinute(end, "end");
  if (startMinute === void 0 || endMinute === void 0) return void 0;
  return { start, end, startMinute, endMinute };
}
function parseQoderPromotion(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
  const raw = value;
  const badge = label(raw["badge"]);
  if (badge === void 0) return void 0;
  const description = label(raw["description"]);
  const link = label(raw["link_url"]);
  const timeZone = text(raw["timezone"]);
  const window = parsePromoWindow(raw["window_start"], raw["window_end"]);
  const declared = text(raw["window_start"]) !== void 0 || text(raw["window_end"]) !== void 0;
  const unreadable = window === void 0 && declared;
  const discountFactor = number(raw["discount_factor"]);
  const beforePromotionPriceFactor = number(raw["before_promotion_price_factor"]);
  return {
    active: raw["active"] === true,
    badge,
    ...description === void 0 ? {} : { description },
    ...link === void 0 ? {} : { link },
    ...timeZone === void 0 ? {} : { timeZone },
    ...window === void 0 ? {} : { window },
    ...unreadable ? { windowUnreadable: true } : {},
    ...discountFactor === void 0 ? {} : { discountFactor },
    ...beforePromotionPriceFactor === void 0 ? {} : { beforePromotionPriceFactor }
  };
}

// ../core/catalog.ts
var QODER_FALLBACK_MODELS = [
  // ── cn 与 global 共有的 ──
  {
    key: "qmodel_38max",
    displayName: "Qwen3.8-Max",
    isVl: true,
    isReasoning: true,
    priceFactor: 0.5,
    maxInputTokens: 18e4,
    thinkingEfforts: ["low", "medium", "xhigh"],
    defaultThinkingEffort: "medium",
    canDisableThinking: true
  },
  {
    key: "qfmodel",
    displayName: "Qwen3.8-Flash",
    isVl: true,
    isReasoning: true,
    priceFactor: 0,
    maxInputTokens: 18e4,
    thinkingEfforts: ["low", "medium", "xhigh"],
    defaultThinkingEffort: "medium",
    canDisableThinking: true
  },
  {
    key: "dmodel",
    displayName: "DeepSeek-V4-Pro",
    isVl: true,
    isReasoning: true,
    priceFactor: 0.5,
    maxInputTokens: 18e4,
    thinkingEfforts: ["high", "max"],
    defaultThinkingEffort: "max",
    canDisableThinking: true
  },
  {
    key: "dfmodel",
    displayName: "DeepSeek-Flash",
    isVl: true,
    isReasoning: true,
    priceFactor: 0.1,
    maxInputTokens: 18e4,
    thinkingEfforts: ["low", "high", "max"],
    defaultThinkingEffort: "high",
    canDisableThinking: true
  },
  {
    key: "gmodel",
    displayName: "GLM-5.3",
    isVl: true,
    isReasoning: true,
    priceFactor: 0.8,
    maxInputTokens: 18e4,
    thinkingEfforts: ["low", "high", "max"],
    defaultThinkingEffort: "high",
    canDisableThinking: false
  },
  {
    key: "gfmodel",
    displayName: "GLM-5.3-Flash",
    isVl: true,
    isReasoning: true,
    priceFactor: 0.1,
    maxInputTokens: 18e4,
    thinkingEfforts: ["high", "max"],
    defaultThinkingEffort: "max",
    canDisableThinking: false
  },
  {
    key: "kmodel_latest",
    displayName: "Kimi-K3.1-Pro",
    isVl: true,
    isReasoning: true,
    priceFactor: 1,
    maxInputTokens: 18e4,
    thinkingEfforts: ["low", "high", "max"],
    defaultThinkingEffort: "high",
    canDisableThinking: false
  },
  {
    key: "kmodel",
    displayName: "Kimi-K2.8-Preview",
    isVl: true,
    isReasoning: true,
    priceFactor: 0.8,
    maxInputTokens: 18e4,
    thinkingEfforts: ["low", "high", "max"],
    defaultThinkingEffort: "high",
    canDisableThinking: false
  },
  {
    // MiniMax：上游 `is_reasoning: false` 且**没有** `thinking_config` 字段，
    // 所以它没有档位、也没有 off 档。老兜底表写的 `isReasoning: true` 是上游
    // 早已不承认的旧声明（那时它还是 MiniMax-M2.7）。
    key: "mmodel",
    displayName: "MiniMax-M3.1-Flash",
    isVl: true,
    isReasoning: false,
    priceFactor: 0.1,
    maxInputTokens: 18e4,
    canDisableThinking: false
  },
  {
    key: "fast",
    displayName: "Fast",
    isVl: true,
    isReasoning: false,
    priceFactor: 0.8,
    maxInputTokens: 2e5,
    canDisableThinking: false
  },
  // ── 仅国际版下发（cn 没有这几条）──
  {
    key: "ultimate",
    displayName: "Ultimate",
    isVl: true,
    isReasoning: true,
    priceFactor: 2,
    maxInputTokens: 18e4,
    thinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultThinkingEffort: "high",
    canDisableThinking: false
  },
  {
    key: "efficient",
    displayName: "Efficient",
    isVl: true,
    isReasoning: false,
    priceFactor: 0.3,
    maxInputTokens: 2e5,
    canDisableThinking: false
  },
  {
    key: "smodel",
    displayName: "Sonus",
    isVl: true,
    isReasoning: true,
    priceFactor: 8,
    maxInputTokens: 18e4,
    thinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultThinkingEffort: "high",
    canDisableThinking: false
  },
  {
    key: "cmodel",
    displayName: "Cantus",
    isVl: true,
    isReasoning: true,
    priceFactor: 4,
    maxInputTokens: 18e4,
    thinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultThinkingEffort: "high",
    canDisableThinking: false
  }
];
var QODER_DEFAULT_CONTEXT = 2e5;
function contextTiersOf(raw) {
  const cc = raw.context_config;
  if (!cc) return void 0;
  const counts = Object.values(cc).map((v) => v.token_count).filter(Number.isFinite);
  if (counts.length === 0) return void 0;
  return [...new Set(counts)].sort((a, b) => a - b);
}
var QODER_CONTEXT_TIER_OVERRIDES = /* @__PURE__ */ new Map([
  [4e5, 5e5]
]);
function mapContextTier(value) {
  return QODER_CONTEXT_TIER_OVERRIDES.get(value) ?? value;
}
function mapContextTiers(tiers) {
  return [...new Set(tiers.map(mapContextTier))].sort((a, b) => a - b);
}
var EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];
function thinkingOf(config) {
  const enabled = config?.["enabled"];
  if (enabled === null || enabled === void 0 || typeof enabled !== "object") return {};
  const efforts = enabled["efforts"];
  if (efforts === null || typeof efforts !== "object" || Array.isArray(efforts)) return {};
  const names = Object.keys(efforts);
  if (names.length === 0) return {};
  const sorted = [...names].sort((a, b) => {
    const ia = EFFORT_ORDER.indexOf(a);
    const ib = EFFORT_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const declared = sorted.find((name) => {
    const entry = efforts[name];
    return entry !== null && typeof entry === "object" && entry["is_default"] === true;
  });
  return {
    thinkingEfforts: sorted,
    ...declared === void 0 ? {} : { defaultThinkingEffort: declared }
  };
}
function supportsThinkingOf(raw) {
  if (raw.is_reasoning) return true;
  return thinkingOf(raw.thinking_config).thinkingEfforts !== void 0;
}
function canDisableThinkingOf(raw, supportsThinking) {
  return raw.thinking_config?.disabled !== void 0 || supportsThinking;
}
function parseUpstreamModel(raw) {
  const contextWindow = mapContextTier(pickDefaultContextWindow(raw) ?? raw.max_input_tokens ?? QODER_DEFAULT_CONTEXT);
  const tiers = contextTiersOf(raw);
  const reasoning = thinkingOf(raw.thinking_config);
  const supportsThinking = supportsThinkingOf(raw);
  const promotion = parseQoderPromotion(raw.raw["promotion"]);
  return {
    key: raw.key,
    displayName: raw.display_name,
    priceFactor: raw.price_factor ?? 1,
    contextWindow,
    maxOutputTokens: raw.max_output_tokens ?? 32768,
    supportsImages: raw.is_vl,
    // 两项都按 `thinking_config` 判，不单看 `is_reasoning`（见上两处注释与
    // issue #1）。旧写法 `canDisableThinking: canDisable || raw.is_reasoning === false`
    // 会把**所有**非推理模型都标成可关闭思考，卡片上就是一堆打不开的勾选。
    supportsThinking,
    canDisableThinking: canDisableThinkingOf(raw, supportsThinking),
    ...reasoning,
    isDefault: raw.is_default,
    isFree: raw.is_free === true,
    isNew: false,
    ...tiersField(tiers === void 0 ? void 0 : mapContextTiers(tiers)),
    ...promotion === void 0 ? {} : { promotion }
  };
}
function pickDefaultContextWindow(raw) {
  const cc = raw.context_config;
  if (!cc) return void 0;
  const entries = Object.entries(cc);
  if (entries.length === 0) return void 0;
  const def = entries.find(([, v]) => v.is_default === true);
  if (def) return def[1].token_count;
  return Math.min(...entries.map(([, v]) => v.token_count));
}
function tiersField(tiers) {
  return tiers === void 0 || tiers.length <= 1 ? {} : { contextTiers: tiers };
}
function fallbackModelInfo(m) {
  return {
    key: m.key,
    displayName: m.displayName,
    priceFactor: m.priceFactor ?? 1,
    contextWindow: m.maxInputTokens ?? QODER_DEFAULT_CONTEXT,
    maxOutputTokens: m.maxOutputTokens ?? 32768,
    supportsImages: m.isVl,
    supportsThinking: m.thinkingEfforts !== void 0 || m.isReasoning,
    canDisableThinking: m.canDisableThinking === true,
    ...m.thinkingEfforts === void 0 ? {} : { thinkingEfforts: m.thinkingEfforts },
    ...m.defaultThinkingEffort === void 0 ? {} : { defaultThinkingEffort: m.defaultThinkingEffort },
    isDefault: false,
    isFree: false,
    isNew: false
  };
}
function withoutRouters(models) {
  return models.filter((model) => !isRouterModelId(model.key));
}
var ABSTRACT_MODEL_IDS = /* @__PURE__ */ new Set([
  "fast",
  "ultimate",
  "efficient"
]);
var GLOBAL_ONLY_MODEL_IDS = /* @__PURE__ */ new Set([
  "smodel",
  "cmodel"
]);
function withoutAbstractModels(models, _region) {
  return models.filter((model) => !ABSTRACT_MODEL_IDS.has(model.key.trim().toLowerCase()));
}
function withoutForeignRegionModels(models, region) {
  if (region !== "cn") return [...models];
  return models.filter((model) => !GLOBAL_ONLY_MODEL_IDS.has(model.key.trim().toLowerCase()));
}

// gateway.ts
function usable(models) {
  return withoutForeignRegionModels(
    withoutAbstractModels(withoutRouters(models), "cn"),
    "cn"
  );
}
async function main() {
  const pat = (await new Promise((resolve, reject) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", resolve);
    process.stdin.on("data", () => {
    });
    process.stdin.once("error", reject);
  })).trim();
  if (!pat) throw new Error("Qoder CN requires a PAT on stdin");
  const upstreamOptions = {};
  if (process.env.QODER_CN_TEST_UPSTREAM_URL) {
    const endpoint = new URL(process.env.QODER_CN_TEST_UPSTREAM_URL);
    upstreamOptions.fetch = async (input, init) => {
      const original = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      original.protocol = endpoint.protocol;
      original.host = endpoint.host;
      return fetch(original, init);
    };
  }
  const upstream = new QoderUpstreamClient("cn", upstreamOptions);
  const models = usable(QODER_FALLBACK_MODELS.map(fallbackModelInfo));
  const byKey = new Map(models.map((model) => [model.key, model]));
  const refreshCatalog = async () => {
    const remote = await upstream.fetchModels(pat);
    for (const raw of remote) {
      const info = parseUpstreamModel(raw);
      if (usable([info]).length) byKey.set(info.key, info);
    }
  };
  const shim = await createQoderShim({
    upstream,
    credential: () => pat,
    modelKeyOf: (id) => byKey.get(id)?.key,
    supportsImagesOf: (id) => byKey.get(id)?.supportsImages ?? false,
    listModelIds: () => [...byKey.keys()],
    // 刷新失败不能影响目录的可用性：保留上一份已知目录比空列表诚实。
    refreshModels: () => refreshCatalog().catch(() => {
    }),
    // 上游目录声明的窗口/输出上限原样交给宿主：Hermes 只从 /models 读这两个数，
    // 缺了它就以 256K 硬默认代替（并打告警），压缩阈值也跟着算错。
    modelLimitsOf: (id) => {
      const model = byKey.get(id);
      return model === void 0 ? void 0 : { context_length: model.contextWindow, max_tokens: model.maxOutputTokens };
    }
  });
  const catalog = createServer2((req, res) => {
    const finish = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET" || !["/models", "/v1/models"].includes(req.url ?? "")) {
      finish(404, { error: { message: "not found" } });
      return;
    }
    void (async () => {
      const remote = await upstream.fetchModels(pat);
      for (const raw of remote) {
        const info = parseUpstreamModel(raw);
        if (usable([info]).length) byKey.set(info.key, info);
      }
      finish(200, {
        object: "list",
        data: [...byKey.values()].map((model) => ({
          id: model.key,
          object: "model",
          owned_by: "qoder-cn",
          // 字段名必须是 `context_length`：Hermes 的 model_metadata 只认这个名字
          // （`_CONTEXT_LENGTH_KEYS` 里有它，却没有 `context_window`）。写成后者
          // 等于没写 —— 宿主会以 256K 硬默认代替，并打一条 probe-down 告警。
          context_length: model.contextWindow,
          max_tokens: model.maxOutputTokens
        }))
      });
    })().catch(() => finish(200, {
      object: "list",
      data: [...byKey.values()].map((model) => ({
        id: model.key,
        object: "model",
        owned_by: "qoder-cn",
        context_length: model.contextWindow,
        max_tokens: model.maxOutputTokens
      }))
    }));
  });
  catalog.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    catalog.once("listening", resolve);
    catalog.once("error", reject);
  });
  process.stdout.write(JSON.stringify({
    base_url: `${shim.baseUrl}/v1`,
    api_key: shim.secret,
    models_url: `http://127.0.0.1:${catalog.address().port}/v1/models`
  }) + "\n");
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    catalog.closeAllConnections();
    await Promise.all([
      shim.close(),
      new Promise((resolve) => catalog.close(() => resolve()))
    ]);
  };
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    void close().finally(() => process.exit(0));
  });
  process.stdin.once("end", () => {
    void close().finally(() => process.exit(0));
  });
}
void main().catch((error) => {
  process.stderr.write(`Qoder CN gateway failed: ${String(error?.message ?? error)}
`);
  process.exit(1);
});
