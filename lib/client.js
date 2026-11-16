/**
 * dsh-mcp-manager · Client 半身（浏览器模块）
 *
 * 注册到「设置 → 插件」的一个标签页里：
 *   · 列表与开关走 DSH 自己的 pluginManager remote（写入语义最权威，自带热重载与回滚）；
 *   · 配置细节与工具数/ token 估算走本插件 Host 半身的两条 HTTP 路由。
 *
 * 这个文件不是 ESM，而是 __ModuleLoader__ 的 factory 形式：
 * 执行时只登记工厂，require() 拿到的都是 shell 提供的种子模块（react / primitives）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-mcp-cost',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const h = react.createElement;

    // 组件库里只依赖两个控件；拿不到就退回原生元素，绝不因此整页崩掉。
    let primitives = {};
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {};
    } catch {
      primitives = {};
    }

    const NS = 'mcpCost';
    /** 侧边栏条目 id，同时是主面板的 key。 */
    const PANEL_ID = 'mcp';
    const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client';
    const API_BASE = '/api/mcp-cost';

    const C = {
      text: 'var(--dsw-alias-label-primary, #1b1d22)',
      soft: 'var(--dsw-alias-label-secondary, #555b66)',
      dim: 'var(--dsw-alias-label-tertiary, #8a909a)',
      error: 'var(--dsw-alias-label-error, #d64545)',
      warn: 'var(--dsw-alias-state-warn-label, #9a6b00)',
      ok: 'var(--dsw-alias-state-success-primary, #22a06b)',
      card: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      softBg: 'var(--dsw-alias-bg-layer-2, #f4f5f7)',
      border: 'var(--dsw-alias-border-l2, #e4e7ec)',
      link: 'var(--dsw-alias-link, #3d6bff)',
    };

    const zh = {
      tab: 'MCP 服务器',
      panel: 'MCP',
      pageIntro: '这里列出当前 profile 的所有 MCP 服务器。关掉不用的能直接省输入 token；开关对所有会话生效。',
      summary: '{enabled} 启用 / 共 {total}',
      search: '搜索 serverName、entryId 或地址',
      refresh: '刷新',
      probeAll: '检测全部',
      probe: '检测',
      probing: '检测中…',
      details: '详情',
      collapse: '收起',
      on: '已启用',
      off: '已停用',
      locked: '只读',
      lockManagement: '这一行由 DSH 管理入口自己控制，面板不能改。',
      lockUnaddressable: '这一行定位不到 profile 里的可写条目（readOnlyReason=unaddressable）。',
      phaseActive: '运行中',
      phaseFailed: '启动失败',
      phasePending: '等待启动',
      phaseLoading: '启动中',
      phaseUnloading: '停止中',
      phaseIdle: '未运行',
      tools: '{count} 个工具 · 约 {tokens} token（估算）',
      toolsUnknown: '工具数未知 · 点「检测」',
      probeFailed: '连不上：{error}',
      estimateHint: '按工具定义字符数 ÷ 1.6 粗估，实测会偏',
      emptyTitle: '这个 profile 里还没有 MCP 服务器',
      emptyBody: '在 cordis.patch.yml 里加一条 insert 就会出现在这里（面板会自己刷新）。',
      note: '开关影响所有会话。MCP 的工具定义每轮都会随请求发送，关掉不用的服务器能直接省输入 token。',
      entryId: 'entryId',
      patchId: 'patchId',
      transport: '传输',
      endpoint: '地址',
      definedIn: '定义层',
      timeout: '调用超时',
      failOnStartup: '启动失败阻塞',
      headers: '请求头',
      yes: '是',
      no: '否',
      defaultTimeout: '默认',
      toggledOn: '已启用「{name}」',
      toggledOff: '已停用「{name}」',
      restartRequired: '「{name}」的改动要重启 DSH 才生效',
      overridden: '「{name}」被更高优先级的配置覆盖了，实际状态没变',
      failed: '「{name}」切换失败：{message}',
      loadFailed: '读取 MCP 列表失败：{message}',
      noMatch: '没有匹配的条目。',
      loading: '读取中…',
      batchAllOff: '全关',
      batchRestore: '恢复上次',
      batchRestoreHint: '把每个服务器的开关还原到上一次批量操作之前',
      batchKeep: '只保留勾选',
      selectedCount: '已选 {count}',
      batchRunning: '处理中 {done}/{total}…',
      batchDone: '批量完成：{ok} 个已切换',
      batchDoneFail: '批量完成：{ok} 个成功，{fail} 个失败',
      batchNothing: '没有需要改动的条目',
      snapshotEmpty: '还没有可恢复的快照（先做一次批量操作）',
      selectRow: '选中 {name}',
      dryHint: '',
    };

    const en = {
      tab: 'MCP servers',
      panel: 'MCP',
      pageIntro: 'Every MCP server in this profile. Disabling unused ones cuts input tokens; toggles affect all sessions.',
      summary: '{enabled} enabled of {total}',
      search: 'Search serverName, entryId or endpoint',
      refresh: 'Refresh',
      probeAll: 'Probe all',
      probe: 'Probe',
      probing: 'Probing…',
      details: 'Details',
      collapse: 'Hide',
      on: 'Enabled',
      off: 'Disabled',
      locked: 'Read-only',
      lockManagement: 'Managed by DSH itself; this panel cannot change it.',
      lockUnaddressable: 'This row cannot be addressed in the profile patch (readOnlyReason=unaddressable).',
      phaseActive: 'Running',
      phaseFailed: 'Failed',
      phasePending: 'Pending',
      phaseLoading: 'Starting',
      phaseUnloading: 'Stopping',
      phaseIdle: 'Not running',
      tools: '{count} tools · ~{tokens} tokens (estimate)',
      toolsUnknown: 'Tool count unknown · press Probe',
      probeFailed: 'Unreachable: {error}',
      estimateHint: 'Rough estimate: definition characters / 1.6',
      emptyTitle: 'No MCP server in this profile yet',
      emptyBody: 'Add an insert entry in cordis.patch.yml and it shows up here.',
      note: 'Toggles affect every session. MCP tool definitions are sent with every request, so disabling unused servers cuts input tokens.',
      entryId: 'entryId',
      patchId: 'patchId',
      transport: 'Transport',
      endpoint: 'Endpoint',
      definedIn: 'Defined in',
      timeout: 'Tool timeout',
      failOnStartup: 'Block startup on failure',
      headers: 'Headers',
      yes: 'yes',
      no: 'no',
      defaultTimeout: 'default',
      toggledOn: 'Enabled "{name}"',
      toggledOff: 'Disabled "{name}"',
      restartRequired: '"{name}" takes effect after a DSH restart',
      overridden: '"{name}" is overridden by a higher-priority configuration',
      failed: 'Could not switch "{name}": {message}',
      loadFailed: 'Could not load MCP entries: {message}',
      noMatch: 'No matching entry.',
      loading: 'Loading…',
      batchAllOff: 'Disable all',
      batchRestore: 'Restore last',
      batchRestoreHint: 'Put every switch back to how it was before the last batch',
      batchKeep: 'Keep selected only',
      selectedCount: '{count} selected',
      batchRunning: 'Applying {done}/{total}…',
      batchDone: 'Batch done: {ok} switched',
      batchDoneFail: 'Batch done: {ok} ok, {fail} failed',
      batchNothing: 'Nothing to change',
      snapshotEmpty: 'No snapshot yet (run a batch first)',
      selectRow: 'Select {name}',
      dryHint: '',
    };

    /** t 的插值兜底：某些路径下 t 不会替换 {name}，这里补一刀。 */
    function msg(t, key, params) {
      let text;
      try {
        text = t(key, params);
      } catch {
        text = key;
      }
      if (typeof text !== 'string') text = key;
      if (!params) return text;
      return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
    }

    function FallbackSwitch({ checked, disabled, label, title, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          title,
          disabled,
          onClick: () => onChange(!checked),
          style: {
            width: 36,
            height: 20,
            borderRadius: 999,
            border: `1px solid ${checked ? C.ok : C.border}`,
            background: checked ? C.ok : C.softBg,
            position: 'relative',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            padding: 0,
            flex: 'none',
          },
        },
        h('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: 'var(--dsw-alias-switch-thumb, #fff)',
            boxShadow: '0 1px 2px rgba(0,0,0,.25)',
            transition: 'left .15s',
          },
        }),
      );
    }

    function FallbackButton({ children, onClick, disabled, title, 'aria-label': ariaLabel, variant }) {
      return h(
        'button',
        {
          type: 'button',
          onClick,
          disabled,
          title,
          'aria-label': ariaLabel,
          style: {
            font: 'inherit',
            fontSize: 12.5,
            padding: '5px 10px',
            borderRadius: 8,
            cursor: disabled ? 'default' : 'pointer',
            border: `1px solid ${variant === 'ghost' ? 'transparent' : C.border}`,
            background: variant === 'ghost' ? 'transparent' : C.softBg,
            color: variant === 'ghost' ? C.link : C.text,
            opacity: disabled ? 0.5 : 1,
          },
        },
        children,
      );
    }

    const Switch = primitives.Switch ?? FallbackSwitch;
    const Button = primitives.Button ?? FallbackButton;

    const styles = {
      // 作为侧边栏主面板时：自己撑满、自己滚动（布局层的 mainPanel 是 flex 列）
      page: { height: '100%', minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: '20px 24px 28px' },
      pageInner: { maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 },
      pageTitle: { margin: 0, fontSize: 18, fontWeight: 600, lineHeight: '26px' },
      pageIntro: { margin: 0, fontSize: 12.5, color: C.dim, lineHeight: '19px' },
      wrap: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, color: C.text },
      header: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      title: { margin: 0, fontSize: 15, fontWeight: 600, lineHeight: '22px' },
      count: { fontSize: 12.5, color: C.dim },
      spacer: { flex: 1 },
      search: {
        minWidth: 180,
        flex: '1 1 200px',
        font: 'inherit',
        fontSize: 12.5,
        padding: '6px 9px',
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        background: C.softBg,
        color: C.text,
        outline: 'none',
      },
      list: { display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0, listStyle: 'none' },
      card: {
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        background: C.card,
        padding: '11px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        minWidth: 0,
      },
      cardOff: { borderColor: C.border, background: C.softBg },
      rowHead: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      dot: { width: 7, height: 7, borderRadius: '50%', flex: 'none' },
      name: { fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      id: { fontFamily: 'var(--ds-font-family-code, ui-monospace, Consolas, monospace)', fontSize: 11, color: C.dim, whiteSpace: 'nowrap' },
      pill: { fontSize: 11, padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap', lineHeight: '18px' },
      metaRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: C.soft, minWidth: 0 },
      code: {
        fontFamily: 'var(--ds-font-family-code, ui-monospace, Consolas, monospace)',
        fontSize: 11,
        background: C.softBg,
        padding: '1px 5px',
        borderRadius: 4,
        wordBreak: 'break-all',
        color: C.soft,
      },
      actions: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
      batchBar: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
      checkbox: { width: 14, height: 14, margin: 0, flex: 'none', accentColor: C.link, cursor: 'pointer' },
      details: {
        display: 'grid',
        gridTemplateColumns: '82px 1fr',
        gap: '3px 10px',
        fontSize: 11.5,
        background: C.softBg,
        border: `1px solid ${C.border}`,
        borderRadius: 9,
        padding: '9px 10px',
      },
      dt: { color: C.dim },
      dd: { margin: 0, wordBreak: 'break-all', fontFamily: 'var(--ds-font-family-code, ui-monospace, Consolas, monospace)', fontSize: 11 },
      errbox: { fontSize: 11.5, color: C.error, background: 'color-mix(in srgb, ' + C.error + ' 10%, transparent)', border: `1px solid color-mix(in srgb, ${C.error} 35%, ${C.border})`, borderRadius: 8, padding: '7px 9px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
      note: { fontSize: 11.5, color: C.dim, margin: 0, lineHeight: '18px' },
      toast: (tone) => ({
        position: 'sticky',
        bottom: 0,
        alignSelf: 'center',
        fontSize: 12,
        padding: '6px 11px',
        borderRadius: 8,
        color: tone === 'error' ? '#fff' : 'var(--dsw-alias-toast-label, #fff)',
        background: tone === 'error' ? C.error : tone === 'warn' ? C.warn : 'var(--dsw-alias-toast-bg, #22252c)',
        boxShadow: '0 6px 20px rgba(0,0,0,.18)',
      }),
    };

    function phaseCopy(t, phase) {
      switch (phase) {
        case 'active':
          return { text: msg(t, 'phaseActive'), color: C.ok };
        case 'failed':
          return { text: msg(t, 'phaseFailed'), color: C.error };
        case 'pending':
          return { text: msg(t, 'phasePending'), color: C.dim };
        case 'loading':
          return { text: msg(t, 'phaseLoading'), color: C.dim };
        case 'unloading':
          return { text: msg(t, 'phaseUnloading'), color: C.dim };
        default:
          return { text: msg(t, 'phaseIdle'), color: C.dim };
      }
    }

    function lockReason(t, reason) {
      if (reason === 'management-required') return msg(t, 'lockManagement');
      if (reason === 'unaddressable') return msg(t, 'lockUnaddressable');
      return String(reason);
    }

    function formatTokens(value) {
      if (value == null) return '?';
      if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
      return String(value);
    }

    const SNAPSHOT_KEY = 'dsh-mcp-cost:last-snapshot';

    /** 上一次批量操作前的开关快照：存 localStorage，刷新页面也还在。 */
    function readSnapshot() {
      try {
        const raw = window.localStorage?.getItem(SNAPSHOT_KEY);
        if (typeof raw !== 'string') return null;
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || !value.states || typeof value.states !== 'object') return null;
        return value.states;
      } catch {
        return null;
      }
    }

    function writeSnapshot(states) {
      try {
        window.localStorage?.setItem(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), states }));
      } catch {
        // 存不了就只保留内存里的那份
      }
    }

    function McpManagerBody(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const isPage = props.variant === 'page';
      const listPlugins = props.listPlugins;
      const setEnabled = props.setEnabled;
      const fetchState = props.fetchState;
      const fetchProbe = props.fetchProbe;

      const [rows, setRows] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [busy, setBusy] = react.useState({});
      const [probing, setProbing] = react.useState({});
      const [expanded, setExpanded] = react.useState({});
      const [query, setQuery] = react.useState('');
      const [toast, setToast] = react.useState(null);
      const [selected, setSelected] = react.useState({});
      const [batch, setBatch] = react.useState(null);
      const [snapshot, setSnapshot] = react.useState(() => readSnapshot());
      const alive = react.useRef(true);
      const toastTimer = react.useRef(null);

      react.useEffect(
        () => () => {
          alive.current = false;
          if (toastTimer.current !== null) clearTimeout(toastTimer.current);
        },
        [],
      );

      const notify = react.useCallback((text, tone) => {
        if (!alive.current) return;
        setToast({ text, tone, at: Date.now() });
        if (toastTimer.current !== null) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => {
          if (alive.current) setToast(null);
        }, tone === 'error' ? 6000 : 3000);
      }, []);

      const load = react.useCallback(async () => {
        try {
          const plugins = await listPlugins();
          let details = null;
          try {
            details = await fetchState();
          } catch {
            details = null;
          }
          const detailMap = new Map();
          if (details && Array.isArray(details.entries)) {
            for (const entry of details.entries) detailMap.set(entry.patchId, entry);
          }
          const next = plugins
            .filter((plugin) => plugin.moduleName === MCP_CLIENT_MODULE)
            .map((plugin) => ({
              ...plugin,
              detail: plugin.patchId === undefined ? null : detailMap.get(plugin.patchId) ?? null,
            }));
          if (!alive.current) return;
          setRows(next);
          setError(null);
        } catch (cause) {
          if (!alive.current) return;
          const message = cause && cause.message ? cause.message : String(cause);
          setError(msg(t, 'loadFailed', { message }));
        }
      }, [listPlugins, fetchState, t]);

      react.useEffect(() => {
        load();
      }, [load]);

      react.useEffect(() => {
        const timer = setInterval(() => {
          load();
        }, 15000);
        return () => clearInterval(timer);
      }, [load]);

      const toggle = react.useCallback(
        async (row, nextEnabled) => {
          const key = row.entryId;
          if (busy[key]) return;
          const title = (row.detail && row.detail.serverName) || row.patchId || row.entryId;
          setBusy((prev) => ({ ...prev, [key]: true }));
          setRows((prev) => (prev === null ? prev : prev.map((item) => (item.entryId === key ? { ...item, enabled: nextEnabled } : item))));
          try {
            const result = await setEnabled(key, nextEnabled);
            const application = result && result.application ? result.application : 'applied';
            if (application === 'applied') {
              notify(msg(t, nextEnabled ? 'toggledOn' : 'toggledOff', { name: title }), 'ok');
            } else if (application === 'restart-required') {
              notify(msg(t, 'restartRequired', { name: title }), 'warn');
            } else if (application === 'overridden') {
              notify(msg(t, 'overridden', { name: title }), 'warn');
            } else {
              const detail = result && result.error ? `${result.error.code}: ${result.error.message ?? ''}` : application;
              notify(msg(t, 'failed', { name: title, message: detail }), 'error');
            }
          } catch (cause) {
            const message = cause && cause.message ? cause.message : String(cause);
            notify(msg(t, 'failed', { name: title, message }), 'error');
          } finally {
            if (alive.current) {
              setBusy((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
              load();
            }
          }
        },
        [busy, setEnabled, notify, load, t],
      );

      const probe = react.useCallback(
        async (row, fresh) => {
          if (row.patchId === undefined) return;
          const key = row.entryId;
          if (probing[key]) return;
          setProbing((prev) => ({ ...prev, [key]: true }));
          try {
            const answer = await fetchProbe(row.patchId, fresh);
            if (!alive.current) return;
            setRows((prev) =>
              prev === null
                ? prev
                : prev.map((item) => (item.entryId === key ? { ...item, probe: answer } : item)),
            );
          } catch (cause) {
            const message = cause && cause.message ? cause.message : String(cause);
            if (alive.current) setRows((prev) => (prev === null ? prev : prev.map((item) => (item.entryId === key ? { ...item, probe: { ok: false, error: message } } : item))));
          } finally {
            if (alive.current) {
              setProbing((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
            }
          }
        },
        [probing, fetchProbe],
      );

      const probeAll = react.useCallback(() => {
        if (rows === null) return;
        for (const row of rows) {
          if (row.enabled) probe(row, true);
        }
      }, [rows, probe]);

      const lockedRow = (row) => row.readOnlyReason !== undefined && row.readOnlyReason !== null;
      const changeableRows = (rows ?? []).filter((row) => !lockedRow(row));
      const selectedCount = Object.values(selected).filter(Boolean).length;
      const pendingBatch = Boolean(batch);

      /** 只挑出真正需要改的条目，逐个串行调用（避免同时触发多次重载）。 */
      const batchTargets = (decide) => {
        const targets = [];
        for (const row of changeableRows) {
          const next = Boolean(decide(row));
          if (next !== Boolean(row.enabled)) targets.push({ entryId: row.entryId, enabled: next });
        }
        return targets;
      };

      /**
       * 批量执行：先存快照（供「恢复上次」），再串行 setEnabled。
       * 单个失败只计数不中断——面板永远报真实结果，凑数算成功的事不做。
       */
      const runBatch = react.useCallback(
        async (targets) => {
          if (targets.length === 0) {
            notify(msg(t, 'batchNothing'), '');
            return;
          }
          const states = {};
          for (const row of rows ?? []) states[row.entryId] = Boolean(row.enabled);
          writeSnapshot(states);
          setSnapshot(states);
          setBatch({ done: 0, total: targets.length });
          let ok = 0;
          let fail = 0;
          for (let index = 0; index < targets.length; index += 1) {
            try {
              const result = await setEnabled(targets[index].entryId, targets[index].enabled);
              const application = result && result.application ? result.application : 'applied';
              if (application === 'applied') ok += 1;
              else fail += 1;
            } catch {
              fail += 1;
            }
            if (alive.current) setBatch({ done: index + 1, total: targets.length });
          }
          if (!alive.current) return;
          setBatch(null);
          notify(msg(t, fail > 0 ? 'batchDoneFail' : 'batchDone', { ok, fail }), fail > 0 ? 'warn' : 'ok');
          load();
        },
        [rows, setEnabled, notify, load, t],
      );

      const disableAll = () => runBatch(batchTargets(() => false));
      const keepSelected = () => runBatch(batchTargets((row) => Boolean(selected[row.entryId])));
      const restoreLast = () => {
        if (snapshot === null) {
          notify(msg(t, 'snapshotEmpty'), '');
          return;
        }
        runBatch(batchTargets((row) => (snapshot[row.entryId] === undefined ? Boolean(row.enabled) : Boolean(snapshot[row.entryId]))));
      };

      const toggleDetails = (key) =>
        setExpanded((prev) => {
          const next = { ...prev };
          if (next[key]) delete next[key];
          else next[key] = true;
          return next;
        });

      const needle = query.trim().toLowerCase();
      const visible = (rows ?? []).filter((row) => {
        if (needle === '') return true;
        const detail = row.detail ?? {};
        const hay = [detail.serverName, row.patchId, row.entryId, detail.endpoint, detail.transport, detail.definedIn]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      });

      const enabledCount = (rows ?? []).filter((row) => row.enabled).length;
      const totalCount = (rows ?? []).length;

      const header = h(
        'div',
        { style: styles.header },
        h(isPage ? 'h2' : 'h3', { style: isPage ? styles.pageTitle : styles.title }, msg(t, 'tab')),
        h('span', { style: styles.count }, msg(t, 'summary', { enabled: enabledCount, total: totalCount })),
        h('span', { style: styles.spacer }),
        h('input', {
          type: 'search',
          value: query,
          placeholder: msg(t, 'search'),
          onChange: (event) => setQuery(event.target.value),
          style: styles.search,
          'aria-label': msg(t, 'search'),
        }),
        h(Button, { variant: 'ghost', size: 'sm', onClick: probeAll }, msg(t, 'probeAll')),
        h(Button, { variant: 'ghost', size: 'sm', onClick: () => load() }, msg(t, 'refresh')),
      );

      const body = [];
      if (error !== null) body.push(h('div', { key: 'error', style: styles.errbox }, error));

      if (rows === null) {
        body.push(h('p', { key: 'loading', style: styles.note }, msg(t, 'loading')));
      } else if (rows.length === 0) {
        body.push(
          h(
            'div',
            { key: 'empty', style: { ...styles.card, alignItems: 'flex-start' } },
            h('strong', { style: { fontSize: 13.5 } }, msg(t, 'emptyTitle')),
            h('p', { style: styles.note }, msg(t, 'emptyBody')),
          ),
        );
      } else if (visible.length === 0) {
        body.push(h('p', { key: 'nomatch', style: styles.note }, msg(t, 'noMatch')));
      }

      for (const row of visible) {
        const detail = row.detail ?? {};
        const key = row.entryId;
        const isBusy = Boolean(busy[key]);
        const isProbing = Boolean(probing[key]);
        const locked = row.readOnlyReason !== undefined && row.readOnlyReason !== null;
        const phase = phaseCopy(t, row.fiberPhase);
        const probeInfo = row.probe && row.probe.ok
          ? msg(t, 'tools', { count: row.probe.toolCount, tokens: formatTokens(row.probe.estTokens) })
          : row.probe && row.probe.ok === false
            ? msg(t, 'probeFailed', { error: String(row.probe.error).slice(0, 90) })
            : msg(t, 'toolsUnknown');
        const title = detail.serverName || row.patchId || key;

        const pill = locked
          ? { text: msg(t, 'locked'), color: C.warn }
          : row.enabled
            ? phase
            : { text: msg(t, 'off'), color: C.dim };

        const metaRow = h(
          'div',
          { style: styles.metaRow },
          detail.transport ? h('span', { key: 'transport' }, detail.transport) : null,
          detail.endpoint ? h('code', { key: 'endpoint', style: styles.code }, detail.endpoint) : null,
          h('span', { key: 'tools', style: row.probe && row.probe.ok === false ? { color: C.error } : undefined }, probeInfo),
        );

        const detailRows = [];
        const pushDetail = (label, value) => {
          if (value === undefined || value === null || value === '') return;
          detailRows.push(h('dt', { key: `dt-${label}`, style: styles.dt }, label));
          detailRows.push(h('dd', { key: `dd-${label}`, style: styles.dd }, String(value)));
        };
        pushDetail(msg(t, 'entryId'), key);
        pushDetail(msg(t, 'patchId'), row.patchId);
        pushDetail(msg(t, 'definedIn'), detail.definedIn);
        pushDetail(msg(t, 'transport'), detail.transport);
        pushDetail(msg(t, 'endpoint'), detail.endpoint);
        pushDetail(
          msg(t, 'timeout'),
          detail.toolCallTimeoutMs == null ? msg(t, 'defaultTimeout') : `${detail.toolCallTimeoutMs} ms`,
        );
        pushDetail(msg(t, 'failOnStartup'), detail.failOnStartupError ? msg(t, 'yes') : msg(t, 'no'));
        if (Array.isArray(detail.headerKeys) && detail.headerKeys.length > 0) pushDetail(msg(t, 'headers'), detail.headerKeys.join(', '));
        if (row.probe && row.probe.ok) pushDetail(msg(t, 'estimateHint'), `${row.probe.chars ?? '?'} chars`);
        if (row.probe && row.probe.ok && Array.isArray(row.probe.tools)) {
          pushDetail('tools', row.probe.tools.map((tool) => tool.name).join(', '));
        }

        body.push(
          h(
            'li',
            { key, style: row.enabled ? styles.card : { ...styles.card, ...styles.cardOff } },
            h(
              'div',
              { style: styles.rowHead },
              h('input', {
                type: 'checkbox',
                checked: Boolean(selected[key]),
                disabled: pendingBatch || locked,
                'aria-label': msg(t, 'selectRow', { name: title }),
                onChange: (event) => setSelected((prev) => ({ ...prev, [key]: event.target.checked })),
                style: styles.checkbox,
              }),
              h('span', { style: { ...styles.dot, background: row.enabled ? (row.fiberPhase === 'failed' ? C.error : phase.color) : C.dim } }),
              h('span', { style: styles.name, title }, title),
              row.patchId ? h('code', { style: styles.id }, row.patchId) : null,
              h('span', { style: styles.spacer }),
              h(
                'span',
                { style: { ...styles.pill, color: pill.color, background: `color-mix(in srgb, ${pill.color} 13%, transparent)` } },
                pill.text,
              ),
              locked
                ? h('span', { style: { ...styles.pill, color: C.warn, border: `1px solid color-mix(in srgb, ${C.warn} 40%, ${C.border})` }, title: lockReason(t, row.readOnlyReason) }, msg(t, 'locked'))
                : null,
              h(Switch, {
                checked: Boolean(row.enabled),
                label: `${title}`,
                disabled: isBusy || locked || pendingBatch,
                ...(locked ? { title: lockReason(t, row.readOnlyReason) } : {}),
                onChange: (next) => toggle(row, next),
              }),
            ),
            metaRow,
            row.diagnostic ? h('div', { style: styles.errbox }, row.diagnostic) : null,
            h(
              'div',
              { style: styles.actions },
              h(Button, { variant: 'ghost', size: 'sm', onClick: () => toggleDetails(key) }, msg(t, expanded[key] ? 'collapse' : 'details')),
              h(
                Button,
                { variant: 'ghost', size: 'sm', disabled: isProbing || row.patchId === undefined, onClick: () => probe(row, true) },
                isProbing ? msg(t, 'probing') : msg(t, 'probe'),
              ),
            ),
            expanded[key] && detailRows.length > 0 ? h('dl', { style: styles.details }, detailRows) : null,
          ),
        );
      }

      body.push(h('p', { key: 'note', style: styles.note }, msg(t, 'note')));

      const batchBar =
        rows === null || rows.length === 0
          ? null
          : h(
              'div',
              { style: styles.batchBar },
              h(Button, { variant: 'ghost', size: 'sm', disabled: pendingBatch, onClick: disableAll }, msg(t, 'batchAllOff')),
              h(
                Button,
                {
                  variant: 'ghost',
                  size: 'sm',
                  disabled: pendingBatch || snapshot === null,
                  title: snapshot === null ? msg(t, 'snapshotEmpty') : msg(t, 'batchRestoreHint'),
                  onClick: restoreLast,
                },
                msg(t, 'batchRestore'),
              ),
              h(Button, { variant: 'ghost', size: 'sm', disabled: pendingBatch, onClick: keepSelected }, msg(t, 'batchKeep')),
              h('span', { style: styles.count }, msg(t, 'selectedCount', { count: selectedCount })),
              pendingBatch
                ? h('span', { style: { ...styles.count, color: C.link } }, msg(t, 'batchRunning', { done: batch.done, total: batch.total }))
                : null,
            );

      return h(
        'div',
        { style: isPage ? { ...styles.wrap, flex: 1, minHeight: 0 } : styles.wrap },
        header,
        isPage ? h('p', { style: styles.pageIntro }, msg(t, 'pageIntro')) : null,
        batchBar,
        h('ul', { style: styles.list }, body),
        toast ? h('div', { style: styles.toast(toast.tone) }, toast.text) : null,
      );
    }

    /** 设置 → 插件 → MCP 服务器（紧凑版，不重复大标题）。 */
    function McpSettingsTab(props) {
      return h(McpManagerBody, { ...props, variant: 'tab' });
    }

    /** 侧边栏主面板（整列都是我们的，自己的滚动容器）。 */
    function McpPanelPage(props) {
      return h(
        'div',
        { style: styles.page },
        h('div', { style: styles.pageInner }, h(McpManagerBody, { ...props, variant: 'page' })),
      );
    }

    /** 侧边栏图标：两个叠起来的"服务器"盒子。 */
    function McpPanelIcon(owner) {
      const size = owner && typeof owner.size === 'number' ? owner.size : 16;
      const boxProps = { rx: 2.2, strokeWidth: 1.7 };
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', { x: 3.5, y: 3.5, width: 17, height: 7, ...boxProps }),
        h('rect', { x: 3.5, y: 13.5, width: 17, height: 7, ...boxProps }),
        h('circle', { cx: 7.6, cy: 7, r: 1, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 7.6, cy: 17, r: 1, fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M15.5 7h2.2M15.5 17h2.2' }),
      );
    }

    function safeFetchJson(path) {
      return fetch(path, { headers: { accept: 'application/json' } }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      });
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcp-cost: dictionaries');
      const t = ctx.locale.bind(NS);

      const injected = () => ({
        listPlugins: async () => {
          const result = await ctx.remote.pluginManager.listPlugins();
          if (!result || result.ok !== true) {
            const failure = result && result.error ? `${result.error.code}: ${result.error.message}` : 'unknown error';
            throw new Error(failure);
          }
          return result.value ?? [];
        },
        setEnabled: async (entryId, enabled) => {
          const result = await ctx.remote.pluginManager.setPluginEnabled(entryId, enabled);
          if (!result || result.ok !== true) {
            const failure = result && result.error ? `${result.error.code}: ${result.error.message}` : 'unknown error';
            throw new Error(failure);
          }
          return result.value;
        },
        fetchState: () => safeFetchJson(`${API_BASE}/state`),
        fetchProbe: (patchId, fresh) =>
          safeFetchJson(`${API_BASE}/probe?patchId=${encodeURIComponent(patchId)}${fresh ? '&fresh=1' : ''}`).then((answer) => answer.probe),
        resolveText: (text) => ctx.locale.resolveText(text),
      });

      ctx.slots.inject('settings.plugins.tab', () =>
        ctx.slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'mcp',
            order: 20,
            label: () => t('tab'),
            locale: NS,
            inject: injected,
          },
          McpSettingsTab,
        ),
      );

      // 侧边栏主面板：一个图标 + 一整列页面，点一下就到，不经过设置对话框。
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 5,
            label: () => t('panel'),
            locale: NS,
          },
          McpPanelIcon,
        ),
      );
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: injected,
          },
          McpPanelPage,
        ),
      );
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = ['slots', 'locale', 'remote', 'remote.pluginManager'];
    return module.exports;
  },
});
