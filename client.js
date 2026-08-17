// dsh-fleet-plugin client half — a settings card that configures the node's
// tunnel, plus a portal link when a hub is configured.
//
// Hand-written `window.__ModuleLoader__.load` bundle (no bundler): registers
// one `settings.section` entry (the DSH settings page), reading/writing the
// Node half's /api/dsh-fleet/config and /api/dsh-fleet/status routes.
window.__ModuleLoader__.load({
  id: 'dsh-fleet-plugin',
  factory: (require) => {
    const React = require('react');
    const e = React.createElement;

    const STYLES = {
      card: { padding: '4px 0 12px', fontSize: '13px', color: 'rgba(230,230,230,.85)', maxWidth: '560px' },
      field: { margin: '10px 0', display: 'flex', flexDirection: 'column', gap: '4px' },
      label: { color: 'rgba(230,230,230,.6)', fontSize: '12px' },
      input: {
        padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.35)',
        background: 'rgba(255,255,255,.04)', color: 'inherit', fontSize: '13px', width: '100%', boxSizing: 'border-box',
      },
      row: { display: 'flex', gap: '16px', flexWrap: 'wrap', margin: '10px 0' },
      switchRow: { display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', cursor: 'pointer', fontSize: '13px' },
      btn: { marginRight: '8px', padding: '5px 14px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.35)', background: 'rgba(255,255,255,.06)', color: 'inherit', cursor: 'pointer', fontSize: '12px' },
      btnPrimary: { background: '#10b981', borderColor: '#10b981', color: '#04120b', fontWeight: 'bold' },
      ok: { color: '#10b981' },
      warn: { color: '#ff9f1c' },
      err: { color: '#f43f5e' },
      muted: { color: 'rgba(230,230,230,.55)', fontSize: '12px' },
    };

    async function fetchJson(url, opts) {
      const res = await fetch(url, Object.assign({ headers: { Accept: 'application/json' } }, opts || {}));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
      return body;
    }

    function FleetSettingsSection() {
      const [cfg, setCfg] = React.useState(null);
      const [status, setStatus] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [saving, setSaving] = React.useState(false);
      const [saved, setSaved] = React.useState(false);

      const load = React.useCallback(async () => {
        try {
          setError(null);
          const [c, s] = await Promise.all([
            fetchJson('/api/dsh-fleet/config'),
            fetchJson('/api/dsh-fleet/status'),
          ]);
          setCfg(c); setStatus(s);
        } catch (err) {
          setError(String((err && err.message) || err));
        }
      }, []);

      React.useEffect(() => { load(); }, [load]);

      const set = (key) => (ev) => { setCfg((prev) => ({ ...prev, [key]: ev.target.value })); setSaved(false); };
      const toggle = (key) => () => { setCfg((prev) => ({ ...prev, [key]: !prev[key] })); setSaved(false); };

      const save = async () => {
        setSaving(true);
        try {
          const body = { ...cfg };
          if (typeof body.token === 'string' && body.token.startsWith('****')) delete body.token;
          const savedCfg = await fetchJson('/api/dsh-fleet/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          setCfg(savedCfg); setSaved(true);
          setStatus(await fetchJson('/api/dsh-fleet/status'));
        } catch (err) {
          setError(String((err && err.message) || err));
        } finally {
          setSaving(false);
        }
      };

      if (error !== null && cfg === null) {
        return e('div', { style: STYLES.card },
          e('p', { style: STYLES.err }, '无法读取 Fleet 配置：' + error),
          e('button', { type: 'button', style: STYLES.btn, onClick: load }, '重试'),
        );
      }
      if (cfg === null) return e('div', { style: STYLES.card }, e('p', { style: STYLES.muted }, '读取中…'));

      const portalUrl = cfg.hubUrl ? 'https://hub.' + String(cfg.hubUrl).split(':')[0].replace(/^hub\./, '') + ':8443' : '';
      const field = (label, key, type) => e('div', { style: STYLES.field },
        e('span', { style: STYLES.label }, label),
        e('input', { type, style: STYLES.input, value: cfg[key] || '', onChange: set(key) }),
      );
      const switchRow = (label, key) => e('label', { style: STYLES.switchRow },
        e('input', { type: 'checkbox', checked: Boolean(cfg[key]), onChange: toggle(key) }),
        e('span', null, label),
      );

      const statusLine = status === null ? '状态未知' : (
        !cfg.enabled ? '已停用（隧道不运行）' :
        !status.configured ? '未配置完整（hubUrl/token/slug 缺一）' :
        status.tunnelOnline ? '隧道在线 ✓' :
        status.frpcRunning ? 'frpc 运行中，尚未登录枢纽' :
        (status.lastError || 'frpc 未运行'));
      const statusColor = status !== null && status.tunnelOnline ? STYLES.ok
        : (status !== null && status.configured && !status.tunnelOnline ? STYLES.warn : STYLES.muted);

      return e('div', { style: STYLES.card },
        e('div', { style: { ...STYLES.row, alignItems: 'center', justifyContent: 'space-between' } },
          e('span', { style: statusColor }, '● ' + statusLine),
          e('button', { type: 'button', style: STYLES.btn, onClick: load }, '刷新'),
        ),
        status && status.restarts > 0 ? e('p', { style: STYLES.muted }, '重启次数 ' + status.restarts + ' · 最近错误：' + (status.lastError || '无')) : null,

        field('节点名称（门户卡片显示）', 'nodeName', 'text'),
        field('枢纽地址（hub.example.com 或 IP:7000）', 'hubUrl', 'text'),
        field('slug（hub enroll 分配）', 'slug', 'text'),
        field('端口（hub enroll 分配，6101-6199）', 'port', 'text'),
        e('div', { style: STYLES.field },
          e('span', { style: STYLES.label }, 'token（hub enroll 签发，已脱敏显示；留空不改动）'),
          e('input', { type: 'password', style: STYLES.input, value: cfg.token || '', onChange: set('token'), placeholder: '****' + (cfg.token || '').slice(-4) }),
        ),
        field('frpc 路径（留空用默认 ~/.dsh-fleet/frpc-0.71.0）', 'frpcPath', 'text'),

        switchRow('启用隧道（随 DSH 启动托管 frpc）', 'enabled'),
        switchRow('由插件管理 frpc 进程（关闭则依赖 node-bootstrap 自启服务）', 'manageFrpc'),

        e('div', { style: { marginTop: '12px' } },
          e('button', { type: 'button', style: { ...STYLES.btn, ...STYLES.btnPrimary }, disabled: saving, onClick: save }, saving ? '保存中…' : '保存配置'),
          saved ? e('span', { style: { ...STYLES.muted, color: '#10b981' } }, '已保存，隧道已按新配置重启') : null,
        ),
        portalUrl ? e('p', { style: { marginTop: '12px' } },
          e('a', { href: portalUrl, target: '_blank', rel: 'noreferrer', style: { color: '#00d4ff' } }, '打开门户 → ' + portalUrl),
        ) : null,
        error ? e('p', { style: STYLES.err }, error) : null,
      );
    }

    return {
      name: 'dsh-fleet-client',
      apply(ctx) {
        const slots = ctx.get('slots');
        if (slots === undefined) return;
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dsh-fleet', order: 22, label: 'Fleet 远程接入' },
          () => e(FleetSettingsSection),
        ));
      },
    };
  },
});
