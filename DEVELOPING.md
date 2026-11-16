# DEVELOPING

开发者笔记：布局、HTTP 接口、自检脚本、更新循环。
面向使用者请看 [README.md](./README.md)。

## 布局

```
dsh-plugin/
├─ package.json          dsh.bundle（补丁层）+ dsh.client（浏览器半身）+ exports
├─ cordis.patch.yml      bundle 层：insert 我们的 loader 条目
├─ lib/index.js          Host 半身：读 patch 层、探测 MCP、挂两条 HTTP 路由
├─ lib/client.js         浏览器半身：侧边栏主面板 + 设置标签页（__ModuleLoader__ factory）
├─ lib/engine/*.mjs      引擎（与 ../lib/*.mjs 同步，见下）
├─ install.mjs           本地安装/同步脚本（复制包 + 处理 profile patch）
├─ sync-engine.mjs       把 ../lib/*.mjs 同步进 lib/engine/
└─ README.md / LICENSE
```

**引擎只有一份源码**：`../lib/profile.mjs`、`../lib/toggle.mjs`、`../lib/probe.mjs`（独立小面板也用它们）。
发布包需要自带这些文件，所以 `lib/engine/` 是**同步副本**；改了源就用 `node sync-engine.mjs`，
`tests/package-shape.mjs` 会检查两边是否一致（防止忘同步后发出一个坏包）。

## HTTP 接口（Host 半身）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mcp-cost/ping` | 存活自检：`{"ok":true,"plugin":"dsh-mcp-cost","version":"…"}` |
| GET | `/api/mcp-cost/state` | 当前 profile 的 MCP 条目详情（serverName / transport / endpoint / 超时 / 定义层 / 锁定原因），不含任何密钥 |
| GET | `/api/mcp-cost/probe?patchId=<id>&fresh=1&timeout=8000` | 真连一次 MCP 服务器，返回工具数与估算 token；`fresh=1` 跳过 30 秒缓存 |

启停**不在这里**：面板直接调 DSH 的 `pluginManager.setPluginEnabled`，写入语义最权威。

## 自检

```bat
node ..\tests\client-module.mjs        :: 迷你 React 桩渲染标签页/主面板，含批量开关
node ..\tests\probe-client-bundle.mjs  :: 用 artifactRevision 算法验证服务端吐的是当前源码
node ..\tests\roundtrip.mjs            :: 引擎的写入往返（假 profile）
node ..\tests\e2e.mjs                  :: 真起面板服务、真写文件、真探测
node ..\tests\package-shape.mjs        :: 发布前的包形状检查
node sync-engine.mjs                   :: 同步引擎副本
```

## 更新循环

| 改了什么 | 要做什么 |
|---|---|
| `lib/client.js` | `node install.mjs` → 刷新页面（实测服务端会重新合成新 bundle，不用重启 DSH） |
| `lib/index.js`、`lib/engine/*.mjs` | `node install.mjs` → **重启 DSH**（已加载的 host 模块不会热替换） |
| `../lib/*.mjs`（引擎源码） | `node sync-engine.mjs` → `node install.mjs` → 重启 DSH |

`install.mjs` 是幂等的：包目录覆盖复制；profile patch 里那条 insert 已有就跳过（写前有备份）。

## 两种安装形态

- **本地/开发**：`install.mjs` 复制包 + 在 profile 的 `cordis.patch.yml` 里写一条 insert。
- **市场/bundle**：`dsh plugin add dsh-mcp-cost` 把包选为 bundle，`cordis.patch.yml`（包自带）负责 insert。

两种同时生效会出现两条同 id 条目，所以 `install.mjs` 会检查 profile 的 `dsh.profile.bundles`：
一旦本包已被选为 bundle，它会**删掉**自己以前写的那条 insert。

## 卸载

1. 市场/插件页里卸载，或把 `dsh.profile.bundles` 里的 `dsh-mcp-cost` 移除；
2. 用 install.mjs 装的，删掉 profile `cordis.patch.yml` 里 `# ===== MCP 管理器面板 …` 那一块；
3. 删掉 `profiles/<profile>/node_modules/dsh-mcp-cost`；
4. 刷新页面（或重启 DSH）。

备份文件：`cordis.patch.yml.bak-mcp-plugin-*`（install 时）、`cordis.patch.yml.bak-mcp-manager-*`（独立小面板时）。

## 发布前检查

```bat
node sync-engine.mjs
node ..\tests\package-shape.mjs
npm pack --dry-run
```
