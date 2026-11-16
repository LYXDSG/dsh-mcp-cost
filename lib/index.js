/**
 * dsh-mcp-cost · Host 半身
 *
 * 只做两件事：
 *   1. 把当前 profile 里 MCP 条目的**配置细节**（serverName / transport / 地址 / 超时…）
 *      通过 HTTP 路由交给浏览器里的面板；
 *   2. 接受面板的探测请求，真的连一次 MCP 服务器，回答「几个工具 / 估算多少 token」。
 *
 * 为什么用 HTTP 路由而不是自建 typert remote：这里不需要任何 @deepseek-ai/* 依赖，
 * 一个包塞进 profile 的 node_modules 就能跑，避免版本绑定和构建链。
 * 启停则不在这里做——面板直接走 DSH 自己的 pluginManager remote，写入语义最权威。
 */
import { collectMcpEntries } from './engine/profile.mjs';
import { probeEntry } from './engine/probe.mjs';
import { createRequire } from 'node:module';

/** 版本号从包自己的 package.json 读，避免两处漂移。 */
const version = () => {
  try {
    return createRequire(import.meta.url)('../package.json').version;
  } catch {
    return 'unknown';
  }
};

export const name = 'mcp-cost';

/** webServer 必须有；profileContext 在 profile 部署里一定在，缺了就用不到状态接口。 */
export const inject = ['webServer', 'profileContext'];

const PREFIX = '/api/mcp-cost';
const PROBE_TTL_MS = 30_000;

const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function readQuery(request) {
  try {
    return new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/** 面板要的静态信息：不含任何密钥，请求头只给名字。 */
function describe(profileContext) {
  const collected = collectMcpEntries(profileContext.home, profileContext.dir);
  const configs = new Map();
  for (const entry of collected.rawEntries.values()) {
    if (entry.name !== MCP_CLIENT_MODULE) continue;
    const view = collected.entries.find((item) => item.patchId === entry.id);
    configs.set(entry.id, { transport: view?.transport ?? null, config: entry.config ?? {} });
  }
  return {
    ok: true,
    profileDir: profileContext.dir,
    patchPath: collected.patchPath,
    homePatchPath: collected.homePatchPath,
    patchReload: collected.patchReload,
    entries: collected.entries,
    layerErrors: collected.layerErrors,
    configs,
  };
}

export function apply(ctx) {
  const profileContext = ctx.profileContext;
  if (profileContext === void 0) {
    ctx.logger?.warn?.('mcp-cost: no profileContext, the panel will not answer state requests');
    return;
  }

  const probeCache = new Map();

  const state = async () => {
    const described = describe(profileContext);
    const entries = described.entries.map((entry) => ({
      ...entry,
      probe: probeCache.get(entry.patchId)?.result ?? null,
    }));
    return json(200, {
      ok: true,
      profileDir: described.profileDir,
      patchPath: described.patchPath,
      homePatchPath: described.homePatchPath,
      patchReload: described.patchReload,
      layerErrors: described.layerErrors,
      entries,
      serverTime: new Date().toISOString(),
    });
  };

  const probe = async (request) => {
    const params = readQuery(request);
    const patchId = params.get('patchId');
    if (patchId === null || patchId === '') return json(400, { ok: false, error: '缺少 patchId' });
    const described = describe(profileContext);
    const entry = described.entries.find((item) => item.patchId === patchId);
    if (entry === void 0) return json(404, { ok: false, error: `没有这个条目：${patchId}` });
    const target = described.configs.get(patchId);
    if (target === void 0) return json(404, { ok: false, error: '读不到该条目的配置' });

    const fresh = params.get('fresh') === '1';
    const cached = probeCache.get(patchId);
    if (!fresh && cached !== void 0 && Date.now() - cached.at < PROBE_TTL_MS) {
      return json(200, { ok: true, probe: cached.result, cached: true });
    }
    const rawTimeout = Number(params.get('timeout') ?? 8000);
    const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(Math.max(rawTimeout, 1000), 60_000) : 8000;
    const result = await probeEntry(target, timeoutMs);
    probeCache.set(patchId, { at: Date.now(), result });
    return json(200, { ok: true, probe: result, cached: false });
  };

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/state`, resource: () => state() }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/probe`, resource: (request) => probe(request) }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/ping`,
        resource: () => json(200, { ok: true, plugin: 'dsh-mcp-cost', version: version() }),
      }),
    ];
    return () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          // 卸载阶段的清理失败不影响其它路由
        }
      }
      probeCache.clear();
    };
  }, 'mcp-cost: routes');
}
