// dsh-fleet portal — static page served by the hub's Caddy (same origin).
//
// Data sources:
//  - node list + online state: /fleet/api/proxy/tcp — the frps dashboard API,
//    proxied by the hub with SERVER-SIDE credential injection. The browser
//    never receives or holds frps credentials (AGENTS.md invariant #4).
//  - per-node metrics: https://<slug>.<hub-domain>:8443/dsh-status — served by
//    the node's plugin. Each node origin is basic_auth'd with the SAME portal
//    password, so the browser prompts once per node and caches it.
(function () {
  'use strict';

  var POLL_MS = 10000; // offline → gray within one poll cycle

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
    return fetchJson('/fleet/api/proxy/tcp')
      .then(function (data) {
        var proxies = (data && data.proxies) || [];
        return proxies
          .filter(function (p) { return p.type === 'tcp'; })
          .map(function (p) {
            // frp reports proxy liveness under different spellings across
            // versions; treat both online/running as up, anything else down.
            var st = String(p.status || '');
            return { slug: String(p.name || ''), online: st === 'online' || st === 'running' };
          })
          .sort(function (a, b) {
            if (a.online !== b.online) return a.online ? -1 : 1;
            return a.slug.localeCompare(b.slug);
          });
      })
      .catch(function () { return []; }); // dashboard unreachable → empty grid, keep polling
  }

  function loadMetrics(slug) {
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

  function render(nodes, metricsBySlug) {
    var grid = document.getElementById('grid');
    var hint = document.getElementById('hint');
    grid.textContent = '';
    if (nodes.length === 0) {
      var empty = el('p', 'hint', '暂无节点。在设备上安装 dsh-fleet-plugin 并完成接入后，节点会出现在这里。');
      grid.appendChild(empty);
      return;
    }
    if (hint) hint.remove();
    nodes.forEach(function (node) {
      var card = el('a', 'card' + (node.online ? '' : ' offline'));
      if (node.online) card.href = nodeOrigin(node.slug);

      var head = el('div', 'card-head');
      head.appendChild(el('span', 'dot ' + (node.online ? 'on' : 'off')));
      var status = metricsBySlug[node.slug];
      var displayName = status && status.node && status.node.name ? status.node.name : node.slug;
      head.appendChild(el('span', 'node-name', displayName));
      if (displayName !== node.slug) head.appendChild(el('span', 'node-slug', node.slug));
      card.appendChild(head);

      var sys = status && status.system;
      var m = el('div', 'metrics');
      if (sys) {
        var memUsed = sys.memTotal - sys.memFree;
        var diskUsed = sys.diskTotal - sys.diskFree;
        var memPct = sys.memTotal > 0 ? Math.round((memUsed / sys.memTotal) * 100) : 0;
        var diskPct = sys.diskTotal > 0 ? Math.round((diskUsed / sys.diskTotal) * 100) : 0;
        var cpu = sys.cpuLoadPct === undefined ? '—' : sys.cpuLoadPct.toFixed(1);
        m.appendChild(metric('CPU', cpu, '%'));
        m.appendChild(metric('内存', String(memPct), '% · ' + fmtBytes(memUsed) + '/' + fmtBytes(sys.memTotal)));
        m.appendChild(metric('磁盘', String(diskPct), '% · ' + fmtBytes(diskUsed) + '/' + fmtBytes(sys.diskTotal)));
        var meta = el('div', 'meta', sys.os + ' · ' + (sys.hostname || '') + ' · ' + sys.cpus + ' 核');
        card.appendChild(m);
        card.appendChild(meta);
      } else if (node.online) {
        m.appendChild(metric('CPU', '—', ''));
        m.appendChild(metric('内存', '—', ''));
        m.appendChild(metric('磁盘', '—', ''));
        card.appendChild(m);
        card.appendChild(el('div', 'meta', '资源信息不可用（节点插件未安装，或该节点等待浏览器输入门户密码）'));
      } else {
        card.appendChild(el('div', 'meta', '离线：节点未连接枢纽'));
      }
      grid.appendChild(card);
    });
  }

  function refresh() {
    document.getElementById('refresh-line').textContent = '更新于 ' + new Date().toLocaleTimeString();
    loadNodes().then(function (nodes) {
      var jobs = nodes.filter(function (n) { return n.online; }).map(function (n) {
        return loadMetrics(n.slug).then(function (sys) { return { slug: n.slug, sys: sys }; });
      });
      Promise.all(jobs).then(function (results) {
        var bySlug = {};
        results.forEach(function (r) { bySlug[r.slug] = r.sys; });
        render(nodes, bySlug);
      });
    });
  }

  document.getElementById('hub-line').textContent = location.host;
  refresh();
  setInterval(refresh, POLL_MS);
})();
