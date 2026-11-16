/**
 * MCP 探测：真的连一次服务器，问它「你有多少工具」。
 *
 * 只做握手 + tools/list，不调工具、不做业务；失败也只回报错误文本。
 * 支持两种传输：streamable-http（POST + SSE）和 stdio（子进程 JSON-RPC 行协议）。
 */
import { spawn } from 'node:child_process';

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'dsh-mcp-manager-panel', version: '0.1.0' };

/** DSH 里 headers 允许写 !!js '`Bearer ${process.env.X}`'；这里做最小还原，读不到就跳过该头。 */
function resolveHeaderValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.includes('${')) return trimmed;
  const template = trimmed.startsWith('`') && trimmed.endsWith('`') ? trimmed.slice(1, -1) : trimmed;
  if (template.includes('${') && !/\$\{process\.env\.[A-Za-z_][A-Za-z0-9_]*\}/.test(template)) return null;
  const resolved = template.replace(/\$\{process\.env\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? '');
  return resolved.includes('${') ? null : resolved;
}

function buildHeaders(config) {
  const headers = {};
  const skipped = [];
  if (config && typeof config.headers === 'object' && config.headers !== null) {
    for (const [key, raw] of Object.entries(config.headers)) {
      const value = resolveHeaderValue(raw);
      if (value === null) {
        skipped.push(key);
        continue;
      }
      headers[key] = value;
    }
  }
  return { headers, skipped };
}

function parseSse(text) {
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    try {
      events.push(JSON.parse(payload));
    } catch {
      // 非 JSON 的心跳/注释行忽略
    }
  }
  return events;
}

async function postRpc(url, headers, message, sessionId, signal) {
  const requestHeaders = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...headers,
  };
  if (sessionId) requestHeaders['mcp-session-id'] = sessionId;
  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(message),
    signal,
  });
  const session = response.headers.get('mcp-session-id') ?? sessionId;
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `：${text.slice(0, 200)}` : ''}`);
  }
  if (message.id === undefined) return { session, result: null };
  if (contentType.includes('text/event-stream')) {
    const events = parseSse(text);
    const matched = events.find((event) => event?.id === message.id) ?? events.find((event) => event?.result || event?.error);
    if (!matched) throw new Error('服务器没有在 SSE 里返回对应响应');
    if (matched.error) throw new Error(`MCP 错误 ${matched.error.code ?? ''}：${matched.error.message ?? '未知错误'}`);
    return { session, result: matched.result };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`响应不是 JSON：${text.slice(0, 200)}`);
  }
  if (parsed?.error) throw new Error(`MCP 错误 ${parsed.error.code ?? ''}：${parsed.error.message ?? '未知错误'}`);
  return { session, result: parsed?.result };
}

async function probeHttp(config, timeoutMs) {
  const { headers, skipped } = buildHeaders(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = await postRpc(
      config.url,
      headers,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      },
      undefined,
      controller.signal,
    );
    const session = init.session;
    await postRpc(config.url, headers, { jsonrpc: '2.0', method: 'notifications/initialized' }, session, controller.signal).catch(() => null);
    const listed = await postRpc(config.url, headers, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session, controller.signal);
    const tools = Array.isArray(listed.result?.tools) ? listed.result.tools : [];
    return {
      ok: true,
      tools: tools.map((tool) => ({ name: tool?.name ?? '(未命名)', description: tool?.description ?? '' })),
      instructionsChars: typeof init.result?.instructions === 'string' ? init.result.instructions.length : 0,
      serverInfo: init.result?.serverInfo ?? null,
      skippedHeaders: skipped,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeStdio(config, timeoutMs) {
  const env = { ...process.env };
  if (config && typeof config.env === 'object' && config.env !== null) {
    for (const [key, raw] of Object.entries(config.env)) {
      const value = resolveHeaderValue(raw);
      if (value !== null) env[key] = value;
    }
  }
  const child = spawn(config.command, Array.isArray(config.args) ? config.args : [], {
    env,
    cwd: config.cwd && config.cwd !== '' ? config.cwd : undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let buffer = '';
  let stderr = '';
  const pending = new Map();

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (message?.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`MCP 错误 ${message.error.code ?? ''}：${message.error.message ?? '未知错误'}`));
      else resolve(message.result);
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      handleLine(line);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });

  const failure = new Promise((_, reject) => {
    child.once('error', (error) => reject(new Error(`启动失败：${error.message}`)));
    child.once('exit', (code) => reject(new Error(`进程提前退出（code ${code}）${stderr ? `：${stderr.trim().slice(-500)}` : ''}`)));
  });

  const call = (message) =>
    new Promise((resolve, reject) => {
      pending.set(message.id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('探测超时')), timeoutMs).unref?.());

  try {
    const init = await Promise.race([
      call({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      }),
      failure,
      timeout,
    ]);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await Promise.race([call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), failure, timeout]);
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];
    return {
      ok: true,
      tools: tools.map((tool) => ({ name: tool?.name ?? '(未命名)', description: tool?.description ?? '' })),
      instructionsChars: typeof init?.instructions === 'string' ? init.instructions.length : 0,
      serverInfo: init?.serverInfo ?? null,
      skippedHeaders: [],
    };
  } finally {
    try {
      child.kill();
    } catch {
      // 忽略
    }
    // cmd/npx 会多套一层进程，Windows 下补一刀
    if (process.platform === 'win32' && child.pid) {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } catch {
        // 忽略
      }
    }
  }
}

/** 「估算」口径：工具定义 JSON 的字符数 / 1.6。只用于排序和心里有数，不是账单。 */
export function estimateTokens(tools, instructionsChars = 0) {
  const chars = tools.reduce((sum, tool) => sum + JSON.stringify(tool).length, 0) + instructionsChars;
  return { chars, estTokens: Math.round(chars / 1.6) };
}

/**
 * 探测一个条目。
 * @param {{patchId: string, transport: string|null, config: object}} target
 * @param {number} timeoutMs
 */
export async function probeEntry(target, timeoutMs = 8000) {
  const started = Date.now();
  const config = target.config ?? {};
  try {
    if (target.transport === 'streamable-http') {
      const result = await probeHttp(config, timeoutMs);
      const { estTokens, chars } = estimateTokens(result.tools, result.instructionsChars);
      return { ok: true, ...result, toolCount: result.tools.length, estTokens, chars, ms: Date.now() - started };
    }
    if (target.transport === 'stdio') {
      const result = await probeStdio(config, timeoutMs);
      const { estTokens, chars } = estimateTokens(result.tools, result.instructionsChars);
      return { ok: true, ...result, toolCount: result.tools.length, estTokens, chars, ms: Date.now() - started };
    }
    return { ok: false, error: '不支持的 transport（只认 stdio / streamable-http）', ms: Date.now() - started };
  } catch (error) {
    const message = error?.name === 'AbortError' ? `超时（${timeoutMs}ms）` : error?.message ?? String(error);
    return { ok: false, error: message, ms: Date.now() - started };
  }
}
