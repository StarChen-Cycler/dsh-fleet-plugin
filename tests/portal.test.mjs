// Portal behavior test: drives portal/app.js inside a stubbed-DOM VM and
// proves the two poll-cycle behaviors behind T2's acceptance criteria —
// (a) online nodes render a click-through card, (b) a node that goes offline
// turns gray on the NEXT poll (POLL_MS = 10s ≪ the 1-minute bound), without
// waiting on real timers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_SRC = readFileSync(join(HERE, '..', 'portal', 'app.js'), 'utf8');

function makeEl(tag) {
  const el = {
    tagName: tag,
    className: '',
    children: [],
    style: {},
    href: '',
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {},
    remove() {},
  };
  let text = '';
  // Real DOM semantics: assigning '' clears the children (render() relies on it).
  Object.defineProperty(el, 'textContent', {
    get: () => text,
    set: (value) => { text = value; if (value === '') el.children.length = 0; },
  });
  return el;
}

function makeDoc(grid, hint, refreshLine, hubLine) {
  return {
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => ({ grid, hint, 'refresh-line': refreshLine, 'hub-line': hubLine }[id] || makeEl('div')),
  };
}

function boot({ nodes, nodeStatus }) {
  const grid = makeEl('main');
  const hint = makeEl('p');
  const refreshLine = makeEl('span');
  const hubLine = makeEl('span');
  let intervalCb = null;
  const fetch = async (url) => {
    if (url === '/nodes.json') {
      return { ok: true, json: async () => nodes() };
    }
    if (url.includes('/dsh-status')) {
      const body = nodeStatus();
      return { ok: body !== null, status: body === null ? 401 : 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const sandbox = {
    document: makeDoc(grid, hint, refreshLine, hubLine),
    location: { hostname: 'hub.example.com', port: '8443', host: 'hub.example.com:8443' },
    fetch,
    setInterval: (cb) => { intervalCb = cb; return 1; },
    clearInterval: () => {},
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(APP_SRC, sandbox);
  return { grid, hint, sandbox, poll: async () => { intervalCb(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); } };
}

function allText(el) {
  return [el.textContent, ...el.children.map(allText)].join(' ');
}

test('portal renders online nodes as clickable cards', async () => {
  const { grid } = boot({
    nodes: () => [{ slug: 'home-pc', port: 6101 }],
    nodeStatus: () => ({ ok: true, node: { name: 'Home PC', slug: 'home-pc' }, system: { os: 'win32/x64', hostname: 'DESKTOP', cpus: 8, cpuLoadPct: 12.3, memTotal: 1000, memFree: 500, diskTotal: 1000, diskFree: 250 } }),
  });
  await new Promise((r) => setTimeout(r, 10)); // initial refresh microtasks

  const cards = grid.children.filter((c) => c.className.includes('card'));
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.ok(!card.className.includes('offline'), 'online node must not render offline');
  assert.equal(card.href, 'https://home-pc.example.com:8443', 'card links to the node origin');
  const texts = allText(card);
  assert.ok(texts.includes('Home PC'), 'node name rendered');
  assert.ok(texts.includes('DESKTOP'), 'system hostname rendered');
});

test('portal grays a node on the next poll after its probe fails (10s poll ≪ 60s bound)', async () => {
  let up = true;
  const { grid, poll } = boot({
    nodes: () => [{ slug: 'home-pc', port: 6101 }],
    nodeStatus: () => (up ? { ok: true, node: { name: 'Home PC' }, system: { os: 'x', hostname: 'h', cpus: 1, cpuLoadPct: 0, memTotal: 1, memFree: 0, diskTotal: 1, diskFree: 0 } } : null),
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!grid.children[0].className.includes('offline'));

  up = false; // node probe starts failing
  await poll();
  assert.ok(grid.children[0].className.includes('offline'), 'node turns gray within one poll cycle');
});
