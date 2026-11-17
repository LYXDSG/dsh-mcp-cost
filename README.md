# dsh-mcp-cost

**English** · [简体中文](#简体中文)

MCP server manager for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): a sidebar panel that lists every MCP server configured in the current profile, toggles it hot (no restart), shows its runtime phase, and estimates how many input tokens it costs you.

MCP tool definitions are sent with **every** request. Turning off a server you are not using today cuts input tokens immediately — but doing that by hand means editing `cordis.patch.yml` and restarting. This plugin makes it one click, and tells you what each click is worth.

## What you get

- **Two entry points, one panel.** A `MCP` icon in the sidebar's panel rail (one click, no settings dialog), plus a tab under Settings → Plugins for when you are already there.
- **Every MCP entry, identified properly.** Rows are selected by `moduleName === '@deepseek-ai/dsh-mcp-client'`, not by id prefix. Each row shows `serverName`, `patchId`, transport, endpoint, call timeout, whether a startup failure blocks boot, and which layer (bundle / profile patch / home patch) defines it.
- **Honest toggle.** Enable/disable goes through DSH's own `pluginManager` remote — the same write path the Plugins page uses — so layering, hot reload, rollback and `restart-required` / `overridden` outcomes behave exactly like DSH itself. The panel never writes YAML by hand.
- **Runtime state, not just config.** Enabled/disabled is the configuration side; the row also shows the entry's `fiberPhase` (`active`, `failed`, …) and prints the startup diagnostic verbatim when a server fails to connect.
- **Batch.** *Disable all*, *Enable all*, *Keep selected only*, and *Restore last* (a snapshot is kept in `localStorage`, so it survives a page refresh), plus select-all / clear. Batch actions run serially and report how many succeeded and how many failed — a failure is never presented as success, and *keep selected only* refuses to run with nothing ticked rather than silently disabling everything.
- **Cost estimate.** Press *Probe* (or *Probe all*) and the host half does a real MCP handshake + `tools/list` against that server, then reports the tool count and an estimated token footprint. The number is an estimate, deliberately labelled as one.
- **Read-only rows stay read-only.** Rows DSH will not let a profile patch address (`readOnlyReason`) show a greyed switch with the reason as its tooltip.
- **Bilingual** (`zh` / `en`), light and dark themes via the host design tokens.

## Install

From a plugin market listing (recommended):

```
插件市场 / Discover → dsh-mcp-cost → Install
```

Or from the CLI:

```sh
dsh plugin add dsh-mcp-cost
```

Either way the package ships its own `dsh.bundle` patch layer, so the loader entry appears automatically — there is no `cordis.patch.yml` to edit. After installing, **refresh the browser page** once so the client module is loaded, and the `MCP` icon appears in the sidebar.

Manual install (no `dsh plugin`): copy the package into `<DSH_HOME>/profiles/<profile>/node_modules/dsh-mcp-cost` and add

```yaml
- insert:
    - id: mcp-manager
      name: dsh-mcp-cost
```

to that profile's `cordis.patch.yml`, then refresh the page.

## Requirements

- A `dsh` Web profile (the provider / `pluginManager` is part of the default profile).
- A browser that supports `color-mix()` (any current Chromium, Firefox or Safari).

## How it works

Two halves in one package:

| Half | File | Job |
|---|---|---|
| Host | `lib/index.js` | Reads the profile's patch layers to describe each MCP entry, and performs the MCP handshake when you press Probe. Registers two routes on `ctx.webServer`: `GET /api/mcp-cost/state` and `GET /api/mcp-cost/probe?patchId=…` |
| Client | `lib/client.js` | The panel (`window.__ModuleLoader__` factory form). Listing and toggling call `ctx.remote.pluginManager`; details and probing call the two routes above |

The host half intentionally imports nothing from `@deepseek-ai/*` — only Node built-ins — so the package does not pin itself to a harness version and needs no build step.

## Known limits

- **Token numbers are estimates.** They are `JSON(tool definitions).length / 1.6` plus the server's `instructions` character count. Different tokenizers will differ; use the number to rank servers, not to bill anyone.
- **The two HTTP routes are local and unauthenticated**, like other plugin routes on the same server. They expose MCP metadata (names, transports, endpoints, header *names* — never header values) and can spawn a probe subprocess. Keep the host on loopback, as `dsh web` does by default.
- **No MCP server installation or editing.** This plugin toggles and measures; it does not add servers, edit endpoints, or manage `npx`/Docker.
- Only the two transports DSH itself supports are understood: `stdio` and `streamable-http`.
- Probing a `stdio` server spawns its command (`npx …`); the first probe of such a server can be slow.

## Development

See [DEVELOPING.md](./DEVELOPING.md) for the layout, the HTTP API, the self-check scripts, and the update loop.

## License

MIT.

---

# 简体中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）用的 **MCP 服务器管理面板**：在侧边栏一列里看见当前 profile 的所有 MCP 服务器，一键启停（热生效、不用重启），显示运行态，并估算每个服务器每轮要花掉多少输入 token。

MCP 的工具定义是**每轮请求都会发送**的。关掉今天不用的服务器，输入 token 立刻下降——但手工做这件事意味着改 `cordis.patch.yml` 再重启。这个插件把它变成一次点击，并且告诉你这一次点击值多少 token。

## 有什么

- **两个入口，一份面板**：侧边栏面板栏里的 `MCP` 图标（一步直达，不经过设置对话框），以及 设置 → 插件 里的同名标签页。
- **按 `moduleName` 认条目**（`@deepseek-ai/dsh-mcp-client`），不猜 id 前缀；每行展示 `serverName`、`patchId`、传输方式、地址、调用超时、启动失败是否阻塞，以及它定义在哪一层。
- **开关走 DSH 自己的 `pluginManager` remote**，和插件页是同一条写入路径：分层覆盖、热重载、回滚、`restart-required` / `overridden` 都跟 DSH 一致。面板**从不手写 YAML**。
- **配置面 + 运行面**：`enabled` 之外还显示 `fiberPhase`；启动失败的条目会把报错原文展开。
- **批量**：全关 / 全开 / 只保留勾选 / 恢复上次（快照存 `localStorage`，刷新页面还在），外加全选与清空。批量**串行执行**，如实汇报成功与失败的数量；「只保留勾选」在一个都没勾时会**拒绝执行并提示**，而不是悄悄把服务器全关掉。
- **代价量化**：点「检测」会真的做一次 MCP 握手 + `tools/list`，给出工具数与**估算** token（明确标注是估算）。
- **只读保护**：DSH 不允许通过 profile patch 改动的条目，开关灰显并把原因放进 tooltip。
- 中英双语，跟随宿主设计令牌适配明暗主题。

## 安装

市场里搜 `dsh-mcp-cost` 安装，或者：

```sh
dsh plugin add dsh-mcp-cost
```

包自带 `dsh.bundle` 补丁层，条目会自动出现，**不需要**改 `cordis.patch.yml`。装完刷新一次页面，侧边栏就会出现 `MCP` 图标。

## 已知限制

- token 数字是**估算**（工具定义 JSON 字符数 ÷ 1.6，加上 instructions 字符数），只适合用来排序「先关哪个」，不要当账单。
- 两条 HTTP 路由是**本机、无鉴权**的（和其它插件路由同一层），只暴露元数据（含请求头**名字**，从不含值）；宿主请保持监听 loopback。
- 不做 MCP 服务器的安装、编辑、托管；只负责启停与量化。
- 只认识 `stdio` 与 `streamable-http` 两种传输。
- 检测 `stdio` 服务器会真的起子进程（比如 `npx …`），第一次可能较慢。

## 许可证

MIT。
