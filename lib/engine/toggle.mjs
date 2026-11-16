/**
 * 只改 profile 层：cordis.patch.yml。
 *
 * 为什么只写 profile 层：合成顺序是 bundle → profile → home，
 * profile 层既能覆盖 bundle 里的定义，又不会动 DSH 自己的托管区。
 * 写法照抄 dsh-plugin-manager 的 writePluginEnabled：给某个 id 追加
 * `disabled: true|false` 行即可；本工具把这些行集中放在文件末尾的托管区里。
 *
 * 每次写之前：① 解析校验 ② 备份 ③ 原子替换（临时文件 + rename）
 * 写完再读回来合成一次，确认这个 id 真的到了目标状态，否则报错（不假装成功）。
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { MANAGED_BEGIN, MANAGED_END, composeLayers, composeWithProfileText, loadLayers, yamlFor } from './profile.mjs';

const BACKUP_PREFIX = 'cordis.patch.yml.bak-mcp-manager-';
const MAX_BACKUPS = 10;

function stamp(now = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
}

/** 把文件切成「托管区前 / 托管区行 / 托管区后」。没有托管区时 region 为 null。 */
export function splitManaged(text) {
  const lines = text.split('\n');
  const begin = lines.findIndex((line) => line.trim() === MANAGED_BEGIN);
  if (begin < 0) return { before: lines, region: null, after: [] };
  const end = lines.findIndex((line, index) => index > begin && line.trim() === MANAGED_END);
  if (end < 0) return { before: lines.slice(0, begin), region: lines.slice(begin), after: [] };
  return {
    before: lines.slice(0, begin),
    region: lines.slice(begin, end + 1),
    after: lines.slice(end + 1),
  };
}

/** 解析托管区里的行（托管区标记本身不是 YAML）。 */
export function readManagedRows(region, profileDir) {
  if (!region) return [];
  const YAML = yamlFor(profileDir);
  const body = region.filter((line) => line.trim() !== MANAGED_BEGIN && line.trim() !== MANAGED_END).join('\n');
  if (body.trim() === '') return [];
  try {
    const value = YAML.parse(body) ?? [];
    return Array.isArray(value) ? value.filter((row) => row && typeof row.id === 'string') : [];
  } catch {
    return [];
  }
}

function renderManaged(rows, profileDir) {
  const YAML = yamlFor(profileDir);
  const body = YAML.stringify(rows).trimEnd();
  return [MANAGED_BEGIN, body, MANAGED_END];
}

function joinLines(lines) {
  const text = lines.join('\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}

function pruneBackups(patchPath) {
  const dir = dirname(patchPath);
  try {
    const backups = readdirSync(dir)
      .filter((name) => name.startsWith(BACKUP_PREFIX))
      .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const extra of backups.slice(MAX_BACKUPS)) {
      try {
        unlinkSync(join(dir, extra.name));
      } catch {
        // 清理失败不影响主流程
      }
    }
  } catch {
    // 目录读不到就跳过清理
  }
}

function validatePatchText(text, profileDir) {
  const YAML = yamlFor(profileDir);
  const customTags = [{ tag: 'tag:yaml.org,2002:js', resolve: (value) => value }];
  const doc = YAML.parseDocument(text, { customTags });
  const error = doc.errors[0];
  if (error) throw new Error(`写前校验失败（YAML 解析错误）：${error.message}`);
  const value = YAML.parse(text, { customTags });
  if (!Array.isArray(value)) throw new Error('写前校验失败：patch 顶层不是数组');
  return value;
}

/** 除了本工具托管区以外，其它层认为它是开还是关（皮块等其它禁用块仍然算数）。 */
function stateWithoutManaged(home, profileDir, restText) {
  return composeWithProfileText(home, profileDir, restText);
}

/**
 * 切换一个 MCP 条目的启用状态。
 * @param {{home: string, profileDir: string, patchId: string, enabled: boolean, dryRun?: boolean}} options
 * @returns {{ changed: boolean, backupPath: string|null, text: string, targetState: boolean }}
 */
export function setEntryEnabled({ home, profileDir, patchId, enabled, dryRun = false }) {
  const patchPath = join(profileDir, 'cordis.patch.yml');
  const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n';

  const { before, region, after } = splitManaged(original);
  const rows = readManagedRows(region, profileDir);
  const tail = after.length > 0 && after[0].trim() === '' ? after.slice(1) : after;

  // 托管区整体摘掉之后的文本，就是「其它层眼里的配置」（皮肤托管区等仍然算数）
  const restDisabled = stateWithoutManaged(home, profileDir, joinLines([...before, ...tail])).get(patchId)?.disabled === true;

  const nextRows = rows.filter((row) => row.id !== patchId);
  const needsOverride = restDisabled !== !enabled;
  if (needsOverride) nextRows.push({ id: patchId, disabled: !enabled });
  nextRows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 托管区永远重新生成在文件末尾：保证它在所有其它禁用块之后，后写者生效。
  const base = [...before, ...tail];
  while (base.length > 0 && base[base.length - 1].trim() === '') base.pop();
  const rebuilt = [...base];
  if (nextRows.length > 0) {
    if (rebuilt.length > 0) rebuilt.push('');
    rebuilt.push(...renderManaged(nextRows, profileDir));
  }
  const text = joinLines(rebuilt);

  const changed = text !== original;
  if (!changed) return { changed: false, backupPath: null, text, targetState: !restDisabled };

  validatePatchText(text, profileDir);

  if (dryRun) return { changed: true, backupPath: null, text, targetState: enabled, dryRun: true };

  const backupPath = join(dirname(patchPath), `${BACKUP_PREFIX}${stamp()}`);
  if (existsSync(patchPath)) copyFileSync(patchPath, backupPath);

  const tempPath = `${patchPath}.tmp-mcp-manager`;
  writeFileSync(tempPath, text, 'utf8');
  renameSync(tempPath, patchPath);
  pruneBackups(patchPath);

  // 写完回读确认，不确认就当失败
  const verify = loadLayers(home, profileDir);
  const verifyEntry = [...composeLayers(verify.layers).values()].find((entry) => entry.id === patchId);
  if (!verifyEntry || verifyEntry.disabled === enabled) {
    throw new Error(
      `写入后回读状态不符（期望 ${enabled ? '启用' : '停用'}）。备份在 ${backupPath}，可以手动还原。`,
    );
  }

  return { changed: true, backupPath, text, targetState: enabled };
}
