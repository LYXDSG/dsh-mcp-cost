/**
 * profile 读取与三层 patch 合成。
 *
 * 合成顺序必须和 dsh-app-boot 的 readProfilePatches 一致：
 *   bundle 层（按 package.json 的 dsh.profile.bundles 顺序）
 *   → profile 自己的 cordis.patch.yml
 *   → ~/.dsh/cordis.patch.yml（home 层）
 * 后者覆盖前者；同一个 id 的 disabled 以最后一次写入为准。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import os from 'node:os';

export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client';

export const MANAGED_BEGIN = '# --- mcp-manager managed (auto-generated; do not edit) ---';
export const MANAGED_END = '# --- end mcp-manager managed ---';

const JS_TAG = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value) => value,
};

const yamlByProfile = new Map();

/** 从 profile 自己的 node_modules 里取 yaml，保证和 DSH 用的是同一个解析器。 */
export function yamlFor(profileDir) {
  const cached = yamlByProfile.get(profileDir);
  if (cached) return cached;
  const attempts = [
    () => createRequire(join(profileDir, 'package.json'))('yaml'),
    () => createRequire(join(process.cwd(), 'package.json'))('yaml'),
    () => createRequire(import.meta.url)('yaml'),
  ];
  for (const attempt of attempts) {
    try {
      const mod = attempt();
      yamlByProfile.set(profileDir, mod);
      return mod;
    } catch {
      // 换下一个锚点
    }
  }
  throw new Error(
    `找不到 yaml 模块。请确认 ${join(profileDir, 'node_modules', 'yaml')} 存在（DSH 自己依赖它）。`,
  );
}

export function resolveDshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh');
}

export function resolveProfileDir(home, profile) {
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new Error(`非法的 profile 名：${profile}`);
  return join(home, 'profiles', profile);
}

/** 按 DSH 的规则读一个 patch 文件：调用方保证文件存在时按 YAML 序列解析。 */
export function loadPatches(file, profileDir) {
  if (!existsSync(file)) return { patches: [], error: null };
  const YAML = yamlFor(profileDir);
  try {
    const text = readFileSync(file, 'utf8');
    const value = YAML.parse(text, { customTags: [JS_TAG] }) ?? [];
    if (!Array.isArray(value)) return { patches: [], error: 'patch 文件的顶层不是 YAML 数组' };
    return { patches: value, error: null };
  } catch (error) {
    return { patches: [], error: `解析失败：${error?.message ?? String(error)}` };
  }
}

/** 按 Node 解析规则找 bundle 包目录（pnpm 是 hoisted 布局，直接目录存在）。 */
function resolvePackageDir(profileDir, name) {
  try {
    const req = createRequire(join(profileDir, 'package.json'));
    return req.resolve(`${name}/package.json`).replace(/[\\/]package\.json$/, '');
  } catch {
    const guess = join(profileDir, 'node_modules', ...name.split('/'));
    return existsSync(join(guess, 'package.json')) ? guess : null;
  }
}

function bundlePatchFiles(bundle) {
  const declared = typeof bundle?.patch === 'string' ? [bundle.patch] : bundle?.patch;
  if (!Array.isArray(declared)) return [];
  return declared.filter((file) => typeof file === 'string');
}

/** 读 profile 的 package.json（只读取 dsh.profile.bundles）。 */
export function readProfileManifest(profileDir) {
  try {
    return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * 读取全部层。
 * @returns {{ layers: Array<{label: string, kind: string, file: string|null, patches: object[], error: string|null}>, patchPath: string, homePatchPath: string, patchReload: string }}
 */
export function loadLayers(home, profileDir) {
  const manifest = readProfileManifest(profileDir);
  const bundles = manifest?.dsh?.profile?.bundles ?? [];
  const layers = [];

  for (const packageName of bundles) {
    const dir = resolvePackageDir(profileDir, packageName);
    if (!dir) {
      layers.push({ label: `bundle ${packageName}`, kind: 'bundle', file: null, patches: [], error: '包未解析到' });
      continue;
    }
    let bundle = null;
    try {
      bundle = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))?.dsh?.bundle ?? null;
    } catch (error) {
      layers.push({ label: `bundle ${packageName}`, kind: 'bundle', file: null, patches: [], error: `读 package.json 失败：${error?.message ?? error}` });
      continue;
    }
    if (!bundle) {
      layers.push({ label: `bundle ${packageName}`, kind: 'bundle', file: null, patches: [], error: '没有 dsh.bundle 声明' });
      continue;
    }
    for (const rel of bundlePatchFiles(bundle)) {
      const file = join(dir, rel);
      const loaded = loadPatches(file, profileDir);
      layers.push({
        label: `bundle ${packageName}`,
        kind: 'bundle',
        file,
        patches: loaded.patches,
        error: loaded.error,
      });
    }
  }

  const patchPath = join(profileDir, 'cordis.patch.yml');
  const profileLayer = loadPatches(patchPath, profileDir);
  layers.push({ label: 'profile patch', kind: 'profile', file: patchPath, patches: profileLayer.patches, error: profileLayer.error });

  const homePatchPath = join(home, 'cordis.patch.yml');
  const homeLayer = loadPatches(homePatchPath, profileDir);
  layers.push({ label: 'home patch', kind: 'home', file: homePatchPath, patches: homeLayer.patches, error: homeLayer.error });

  return {
    layers,
    patchPath,
    homePatchPath,
    patchReload: manifest?.dsh?.profile?.patchReload ?? 'live(默认)',
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 合成所有层。
 * @returns {Map<string, {id: string, name?: string, config?: object, disabled: boolean, definedIn: string, disabledFrom: string|null, overrideLayers: string[]}>}
 */
export function composeLayers(layers) {
  const entries = new Map();
  for (const layer of layers) {
    for (const patch of layer.patches) {
      if (!isPlainObject(patch)) continue;
      if (Array.isArray(patch.insert)) {
        for (const row of patch.insert) {
          if (!isPlainObject(row) || typeof row.id !== 'string') continue;
          const id = row.id;
          const prev = entries.get(id) ?? {
            id,
            disabled: false,
            definedIn: layer.label,
            disabledFrom: null,
            overrideLayers: [],
          };
          const next = { ...prev, ...row, id };

          // applyPatches 对覆盖块是「按 key 直接赋值」，config 整体替换而不是深合并。
          if (row.config !== undefined) next.config = row.config;
          if (typeof row.name === 'string') next.name = row.name;
          if (row.disabled !== undefined) {
            next.disabled = row.disabled === true;
            next.disabledFrom = layer.label;
          }
          if (prev.definedIn !== layer.label) next.definedIn = layer.label;
          entries.set(id, next);
        }
      } else if (typeof patch.id === 'string') {
        const id = patch.id;
        const prev = entries.get(id);
        // DSH 的 applyPatches 在 name 不匹配时是 warn + 跳过整条覆盖；这里保持一致。
        if (prev === undefined) continue;
        if (typeof patch.name === 'string' && patch.name !== prev.name) continue;
        const next = { ...prev, ...patch, id };
        if (patch.config !== undefined) next.config = patch.config;
        if (patch.disabled !== undefined) {
          next.disabled = patch.disabled === true;
          next.disabledFrom = layer.label;
        }
        if (!next.overrideLayers.includes(layer.label)) next.overrideLayers.push(layer.label);
        entries.set(id, next);
      }
    }
  }
  return entries;
}

/** 把一个 MCP 条目的 patch 配置整理成界面要的字段。 */
export function toEntryView(entry) {
  const config = entry.config ?? {};
  const transport = config.transport === 'stdio' ? 'stdio' : config.transport === 'streamable-http' ? 'streamable-http' : null;
  let endpoint = '';
  if (transport === 'streamable-http') endpoint = config.url ?? '';
  else if (transport === 'stdio') endpoint = [config.command, ...(Array.isArray(config.args) ? config.args : [])].filter(Boolean).join(' ');

  const headerKeys = isPlainObject(config.headers) ? Object.keys(config.headers) : [];
  let lockedReason = null;
  if (entry.definedIn === 'home patch') lockedReason = '该条目定义在 home patch（~/.dsh/cordis.patch.yml），本工具不改它';
  else if (entry.disabledFrom === 'home patch') lockedReason = 'home patch 里已禁用，profile 层覆盖不到它';

  return {
    patchId: entry.id,
    entryId: `include:${entry.id}`,
    moduleName: entry.name,
    serverName: typeof config.serverName === 'string' ? config.serverName : entry.id,
    enabled: !entry.disabled,
    definedIn: entry.definedIn ?? '未知层',
    disabledFrom: entry.disabledFrom,
    transport,
    endpoint,
    headerKeys,
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? null,
    failOnStartupError: config.failOnStartupError ?? false,
    hasEnvVars: headerKeys.some((key) => typeof config.headers[key] === 'string' && config.headers[key].includes('${')),
    lockedReason,
  };
}

/** 用「指定的 profile patch 文本」合成一次（测试/预览用，不读文件里的 profile 层）。 */
export function composeWithProfileText(home, profileDir, profilePatchText) {
  const loaded = loadLayers(home, profileDir);
  const YAML = yamlFor(profileDir);
  let patches;
  try {
    patches = YAML.parse(profilePatchText, { customTags: [JS_TAG] }) ?? [];
  } catch {
    patches = [];
  }
  if (!Array.isArray(patches)) patches = [];
  const layers = loaded.layers.map((layer) => (layer.kind === 'profile' ? { ...layer, patches } : layer));
  return composeLayers(layers);
}

export function collectMcpEntries(home, profileDir) {
  const loaded = loadLayers(home, profileDir);
  const composed = composeLayers(loaded.layers);
  const entries = [];
  for (const entry of composed.values()) {
    if (entry.name === MCP_CLIENT_MODULE) entries.push(toEntryView(entry));
  }
  entries.sort((a, b) => (a.enabled === b.enabled ? a.serverName.localeCompare(b.serverName) : a.enabled ? -1 : 1));
  return {
    entries,
    patchPath: loaded.patchPath,
    homePatchPath: loaded.homePatchPath,
    patchReload: loaded.patchReload,
    layerErrors: loaded.layers.filter((layer) => layer.error).map((layer) => ({ label: layer.label, error: layer.error })),
    rawEntries: composed,
  };
}

export const patchFileName = (path) => (path ? basename(path) : '');
