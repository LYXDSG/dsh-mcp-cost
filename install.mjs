#!/usr/bin/env node
/**
 * 把 dsh-mcp-cost 装进一个 DSH profile（本地开发用；市场安装走 dsh plugin add，不需要本脚本）。
 *
 * 做的事（幂等，可以反复跑）：
 *   1. 把包复制到 <home>/profiles/<profile>/node_modules/dsh-mcp-cost
 *      （lib/engine/*.mjs 从上层 mcp-manager/lib 同步，避免两份逻辑漂移）
 *   2. profile 的 cordis.patch.yml：
 *        · 先清掉本脚本历史上写过的 insert 块（含旧包名 dsh-mcp-manager 的），防止同 id 两条条目
 *        · 如果 profile 没把本包选为 bundle，再补一条新的 insert
 *   3. 读回校验，确认 YAML 还能解析、insert 真的在了
 *
 * 用法：
 *   node install.mjs                  # 装进默认的 web profile
 *   node install.mjs --profile web
 *   node install.mjs --home C:\Users\you\.dsh
 *   node install.mjs --dry-run        # 只报告要做什么
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_NAME = 'dsh-mcp-cost';
const ENTRY_ID = 'mcp-cost';
const LEGACY_PACKAGE_NAMES = ['dsh-mcp-manager', 'dsh-mcp-cost'];
const MANIFEST = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
/**
 * 引擎源码目录：
 *   · 作者的开发工作区里，源码在 ../lib（独立小面板与插件共用一份）；
 *   · 从仓库/npm 拿到的包里没有 ../lib，就用包自带的 lib/engine。
 */
const ENGINE_DIR = existsSync(join(HERE, '..', 'lib', 'profile.mjs')) ? join(HERE, '..', 'lib') : join(HERE, 'lib', 'engine');
const ENGINE_FILES = ['profile.mjs', 'toggle.mjs', 'probe.mjs'];
const MANAGED_BEGIN = '# --- mcp-manager managed (auto-generated; do not edit) ---';
const BLOCK_HEADER = '# ===== MCP 管理器面板';

function parseArgs(argv) {
  const options = { profile: 'web', home: null, dryRun: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') options.profile = argv[++index];
    else if (arg === '--home') options.home = argv[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('用法：node install.mjs [--profile web] [--home <dsh home>] [--dry-run] [--force]');
  process.exit(0);
}

const home = options.home ?? process.env.DSH_HOME ?? join(os.homedir(), '.dsh');
const profileDir = join(home, 'profiles', options.profile);
const targetDir = join(profileDir, 'node_modules', PKG_NAME);
const patchPath = join(profileDir, 'cordis.patch.yml');

if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`找不到 profile：${profileDir}`);
  process.exit(1);
}

function stamp(now = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 用 profile 自己的 yaml 解析器校验，和 DSH 读文件时一致。 */
function yamlOf() {
  return createRequire(join(profileDir, 'package.json'))('yaml');
}

function validate(text) {
  const YAML = yamlOf();
  const customTags = [{ tag: 'tag:yaml.org,2002:js', resolve: (value) => value }];
  const doc = YAML.parseDocument(text, { customTags });
  const error = doc.errors[0];
  if (error) throw new Error(`写前校验失败：${error.message}`);
  const value = YAML.parse(text, { customTags });
  if (!Array.isArray(value)) throw new Error('写前校验失败：patch 顶层不是数组');
  return value;
}

/** 清掉本脚本历史上写进 profile patch 的 insert 块（旧包名的一并清）。 */
function stripOurBlocks(text, removeCurrent = false) {
  const lines = text.split('\n');
  const kept = [];
  let index = 0;
  let removed = 0;
  while (index < lines.length) {
    if (lines[index].trim().startsWith(BLOCK_HEADER)) {
      // 块形状：若干注释行 → "- insert:" → "- id: …" → "name: …"（name 必须是我们写的包名）
      let cursor = index;
      let sawInsert = false;
      let matched = false;
      while (cursor < lines.length) {
        const line = lines[cursor];
        const trimmed = line.trim();
        if (trimmed === '- insert:') {
          sawInsert = true;
          cursor += 1;
          continue;
        }
        if (!sawInsert) {
          if (trimmed === '' || trimmed.startsWith('#')) {
            cursor += 1;
            continue;
          }
          break;
        }
        if (/^\s+-\s+id:/.test(line)) {
          cursor += 1;
          continue;
        }
        if (/^\s+name:\s*\S+/.test(line)) {
          const name = trimmed.slice(trimmed.indexOf('name:') + 'name:'.length).trim().replace(/^['"]|['"]$/g, '');
          // 不是 bundle 模式时，已有的「当前包名」块要留着，否则每次 install 都会重写一遍文件
          matched = LEGACY_PACKAGE_NAMES.includes(name) && (removeCurrent || name !== PKG_NAME);
          cursor += 1;
          break;
        }
        break;
      }
      if (sawInsert && matched) {
        removed += 1;
        // 顺带吃掉紧跟其后的空行，避免文件里留下一串空行
        while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
        index = cursor;
        continue;
      }
    }
    kept.push(lines[index]);
    index += 1;
  }
  return { text: kept.join('\n'), removed };
}

function insertPatchEntry(text) {
  if (new RegExp(`name:\\s*['"]?${PKG_NAME}['"]?`).test(text)) {
    return { text, changed: false, reason: 'patch 里已经有这一行' };
  }
  const block = [
    '',
    `${BLOCK_HEADER}（设置 → 插件 → MCP 服务器，或侧边栏 MCP 图标）=====`,
    `# 由 ${PKG_NAME}/install.mjs 添加；删掉本块并移除 node_modules/${PKG_NAME} 即可卸载。`,
    '- insert:',
    `    - id: ${ENTRY_ID}`,
    `      name: ${PKG_NAME}`,
    '',
  ].join('\n');

  const marker = text.indexOf(MANAGED_BEGIN);
  const next =
    marker >= 0
      ? `${text.slice(0, marker).replace(/\n+$/, '\n')}${block}\n${text.slice(marker)}`
      : `${text.replace(/\n+$/, '')}\n${block}`;
  validate(next);
  return { text: next, changed: true };
}

function bundleSelected() {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
    return (manifest?.dsh?.profile?.bundles ?? []).includes(PKG_NAME);
  } catch {
    return false;
  }
}

function copyPackage() {
  const engineTarget = join(targetDir, 'lib', 'engine');
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(engineTarget, { recursive: true });
  for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
    cpSync(join(HERE, file), join(targetDir, file), { overwrite: true });
  }
  for (const file of ENGINE_FILES) {
    cpSync(join(ENGINE_DIR, file), join(engineTarget, file), { overwrite: true });
  }
  return targetDir;
}

/** 旧包名的安装目录（改名后残留会导致两个条目）——顺手清掉。 */
function removeLegacyInstalls() {
  const removed = [];
  for (const name of LEGACY_PACKAGE_NAMES) {
    if (name === PKG_NAME) continue;
    const dir = join(profileDir, 'node_modules', name);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return removed;
}

function writePatch(nextText, original) {
  const backup = join(profileDir, `cordis.patch.yml.bak-mcp-plugin-${stamp()}`);
  writeFileSync(backup, original, 'utf8');
  writeFileSync(`${patchPath}.tmp-mcp-manager`, nextText, 'utf8');
  renameSync(`${patchPath}.tmp-mcp-manager`, patchPath);
  validate(readFileSync(patchPath, 'utf8'));
  return backup;
}

console.log(`🐟 安装 ${MANIFEST.name}@${MANIFEST.version}`);
console.log(`   profile  ${profileDir}`);
console.log(`   目标     ${targetDir}`);
console.log(`   patch    ${patchPath}`);
if (options.dryRun) console.log('   （dry-run：不会真的写文件）');

let patchChanged = false;
const bundleMode = bundleSelected();
const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n';
const stripped = stripOurBlocks(original, bundleMode);
const plan = bundleMode ? { text: stripped.text, changed: stripped.removed > 0 } : insertPatchEntry(stripped.text);

if (options.dryRun) {
  console.log(`  · 需要清掉的旧 insert 块：${stripped.removed} 个`);
  console.log(
    `  · patch：${bundleMode ? 'profile 已把本包选为 bundle，bundle 层负责 insert' : plan.changed ? '需要补一条 insert' : plan.reason ?? '已存在'}`,
  );
} else {
  copyPackage();
  const removedDirs = removeLegacyInstalls();
  console.log('  · 包文件已就位');
  if (removedDirs.length > 0) console.log(`  · 已清理旧安装目录：${removedDirs.join(', ')}`);

  if (!plan.changed) {
    console.log(`  · patch：${bundleMode ? 'bundle 层负责 insert，无需改动' : plan.reason ?? '无需改动'}`);
  } else {
    const backup = writePatch(plan.text, original);
    patchChanged = true;
    console.log(`  · patch：已更新（${stripped.removed} 个旧块被清理，备份 ${backup}）`);
  }
}

console.log('');
if (options.dryRun) {
  console.log('dry-run 结束，什么都没改。');
} else {
  console.log('装好了。接下来的事：');
  console.log('  1. 浏览器刷新一下页面（F5），让浏览器加载新的客户端模块。');
  console.log('  2. 侧边栏应该出现 MCP 图标；设置 → 插件 里也有同名标签页。');
  if (patchChanged) console.log('  · 这次改了 cordis.patch.yml（有备份）。');
  console.log('');
  console.log('自检地址：');
  console.log('  GET /api/mcp-cost/ping   → {"ok":true,"plugin":"dsh-mcp-cost"}');
  console.log('  GET /api/mcp-cost/state  → 当前 MCP 条目详情');
}
