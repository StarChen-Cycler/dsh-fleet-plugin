// dsh-fleet portal — static page served by the hub's Caddy (same origin).
//
// Data sources (shared-token era):
//  - node list: /nodes.json — maintained by `hub enroll`/`hub revoke` on the
//    hub (slug + port only, no credentials).
//  - online state + metrics: a direct probe of each node's
//    https://<slug>.<hub-domain>:8443/dsh-status — online when the probe
//    answers, offline (gray card) otherwise. Each node origin is basic_auth'd
//    with the SAME portal password, so the browser prompts once per node and
//    caches it. The frps dashboard is never touched by this page.
(function () {
  'use strict';

  var POLL_MS = 10000; // offline → gray within one poll cycle (≪ 60s bound)

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Portal origin is hub.<domain>:<port>; node origins share <domain>:<port>.
  function nodeOrigin(slug) {
    var base = location.hostname.replace(/^hub\./, '');
    var port = location.port ? ':' + location.port : '';
    return 'https://' + slug + '.' + base + port;
  }

  function fetchJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
  }

  function loadNodes() {
    return fetchJson('/nodes.json')
      .then(function (rows) {
        return (rows || []).map(function (r) {
          return { slug: String(r.slug || ''), port: r.port };
        }).filter(function (n) { return n.slug !== ''; });
      })
      .catch(function () { return []; }); // hub unreachable → empty grid, keep polling
  }

  function loadStatus(slug) {
    return fetchJson(nodeOrigin(slug) + '/dsh-status')
      .then(function (s) { return s && s.system ? s : null; })
      .catch(function () { return null; }); // offline / plugin missing / auth pending
  }

  function fmtBytes(bytes) {
    if (bytes === undefined || bytes === null || !isFinite(bytes)) return '—';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i += 1; }
    return bytes.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function metric(label, value, unit) {
    var box = el('div', 'metric');
    box.appendChild(el('div', 'metric-label', label));
    box.appendChild(el('div', 'metric-value', value));
    box.appendChild(el('div', 'metric-unit', unit));
    return box;
  }

  function render(results) {
    var grid = document.getElementById('grid');
    var hint = document.getElementById('hint');
    grid.textContent = '';
    if (results.length === 0) {
      grid.appendChild(el('p', 'hint', '暂无节点。在设备上安装 dsh-fleet-plugin 并完成接入后，节点会出现在这里。'));
      return;
    }
    if (hint) hint.remove();
    results.forEach(function (node) {
      var card = el('a', 'card' + (node.online ? '' : ' offline'));
      if (node.online) card.href = nodeOrigin(node.slug);

      var head = el('div', 'card-head');
      head.appendChild(el('span', 'dot ' + (node.online ? 'on' : 'off')));
      var displayName = node.status && node.status.node && node.status.node.name
        ? node.status.node.name : node.slug;
      head.appendChild(el('span', 'node-name', displayName));
      if (displayName !== node.slug) head.appendChild(el('span', 'node-slug', node.slug));
      card.appendChild(head);

      var sys = node.status && node.status.system;
      var m = el('div', 'metrics');
      if (sys) {
        var memUsed = sys.memTotal - sys.memFree;
        var diskUsed = sys.diskTotal - sys.diskFree;
        var memPct = sys.memTotal > 0 ? Math.round((memUsed / sys.memTotal) * 100) : 0;
        var diskPct = sys.diskTotal > 0 ? Math.round((diskUsed / sys.diskTotal) * 100) : 0;
        var cpu = sys.cpuLoadPct === undefined || sys.cpuLoadPct === null ? '—' : Number(sys.cpuLoadPct).toFixed(1);
        m.appendChild(metric('CPU', cpu, '%'));
        m.appendChild(metric('内存', String(memPct), '% · ' + fmtBytes(memUsed) + '/' + fmtBytes(sys.memTotal)));
        m.appendChild(metric('磁盘', String(diskPct), '% · ' + fmtBytes(diskUsed) + '/' + fmtBytes(sys.diskTotal)));
        card.appendChild(m);
        card.appendChild(el('div', 'meta', sys.os + ' · ' + (sys.hostname || '') + ' · ' + sys.cpus + ' 核'));
      } else if (node.online) {
        m.appendChild(metric('CPU', '—', ''));
        m.appendChild(metric('内存', '—', ''));
        m.appendChild(metric('磁盘', '—', ''));
        card.appendChild(m);
        card.appendChild(el('div', 'meta', '资源信息不可用（节点插件未安装，或该节点等待浏览器输入门户密码）'));
      } else {
        card.appendChild(el('div', 'meta', '离线：节点探测失败'));
      }
      grid.appendChild(card);
    });
  }

  function refresh() {
    document.getElementById('refresh-line').textContent = '更新于 ' + new Date().toLocaleTimeString();
    loadNodes().then(function (nodes) {
      Promise.all(nodes.map(function (n) {
        return loadStatus(n.slug).then(function (status) {
          return { slug: n.slug, online: status !== null, status: status };
        });
      })).then(render);
    });
  }

  document.getElementById('hub-line').textContent = location.host;
  refresh();
  setInterval(refresh, POLL_MS);
})();
