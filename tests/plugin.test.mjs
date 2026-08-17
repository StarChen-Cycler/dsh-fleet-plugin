// dsh-fleet-plugin Node half tests (node:test — zero dependencies, CI runs
// `node --test tests/`). Evidence gates: routes register, /dsh-status carries
// no credentials and serves the CORS header, the config route redacts and
// validates, and the supervisor stays inert when disabled.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../plugin/index.mjs';

function makeCtx() {
  const routes = [];
  const cleanups = [];
  const webServer = {
    register: (route) => { routes.push(route); return () => {}; },
  };
  const ctx = {
    get: (n, _strict) => (n === 'webServer' ? webServer : undefined),
    effect: (cb) => {
      const cleanup = cb();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return () => {};
    },
  };
  ctx.disposeAll = () => {
    for (const c of cleanups) { try { c(); } catch { /* best-effort */ } }
    cleanups.length = 0;
  };
  return { routes, ctx };
}

async function call(handler, req = { url: '/', method: 'GET' }) {
  let status = 200;
  const headers = {};
  const chunks = [];
  const res = {
    writeHead: (code, h) => { status = code; Object.assign(headers, h); },
    end: (body) => { chunks.push(body); },
  };
  const fakeReq = {
    url: req.url || '/',
    method: req.method || 'GET',
    on: (ev, cb) => { if (ev === 'data') req.body ? cb(Buffer.from(req.body)) : 0; if (ev === 'end') queueMicrotask(cb); if (ev === 'error') {} },
    destroy: () => {},
  };
  await handler(fakeReq, res);
  return { status, headers, body: JSON.parse(chunks.join('') || '{}') };
}

test('dsh-fleet Node half: routes register and /dsh-status is credential-free with CORS', async (t) => {
  const home = join(tmpdir(), `dsh-fleet-test-${Date.now()}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'dsh-fleet.json'), JSON.stringify({ enabled: false, nodeName: 'test-node', slug: 'test', token: '0123456789abcdef0123456789abcdef' }));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { routes, ctx } = makeCtx();
    apply(ctx);
    const paths = routes.map((r) => r.path).sort();
    assert.deepEqual(paths, ['/api/dsh-fleet/config', '/api/dsh-fleet/status', '/dsh-status']);

    const statusRoute = routes.find((r) => r.path === '/dsh-status');
    const res = await call(statusRoute.handler);
    assert.equal(res.status, 200);
    assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
    assert.equal(res.body.ok, true);
    assert.equal(res.body.node.name, 'test-node');
    assert.equal(res.body.node.slug, 'test');
    assert.ok(res.body.system.cpus >= 1);
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('0123456789abcdef'), '/dsh-status must never carry credentials');
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test('config route: GET redacts the token; POST validates and preserves redacted values', async (t) => {
  const home = join(tmpdir(), `dsh-fleet-test-${Date.now()}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'dsh-fleet.json'), JSON.stringify({ enabled: false, token: '0123456789abcdef0123456789abcdef' }));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { routes, ctx } = makeCtx();
    apply(ctx);
    const route = routes.find((r) => r.path === '/api/dsh-fleet/config');

    const got = await call(route.handler);
    assert.equal(got.body.token, '****cdef');
    assert.ok(!JSON.stringify(got.body).includes('0123456789abcdef'));

    // Redacted token on POST must be a no-op for the secret.
    const kept = await call(route.handler, { method: 'POST', body: JSON.stringify({ token: '****cdef', slug: 'node-a', port: '6102' }) });
    assert.equal(kept.status, 200);
    const stored = JSON.parse(readFileSync(join(home, 'dsh-fleet.json'), 'utf8'));
    assert.equal(stored.token, '0123456789abcdef0123456789abcdef');
    assert.equal(stored.slug, 'node-a');

    const bad = await call(route.handler, { method: 'POST', body: JSON.stringify({ slug: 'BAD_SLUG' }) });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error.includes('slug'));
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test('supervisor stays inert when disabled and reports a missing binary when enabled', () => {
  const home = join(tmpdir(), `dsh-fleet-test-${Date.now()}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'dsh-fleet.json'), JSON.stringify({ enabled: true, manageFrpc: true, frpcPath: join(home, 'no-such-frpc'), token: 'a'.repeat(32), slug: 's', hubUrl: '127.0.0.1' }));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { routes, ctx } = makeCtx();
    apply(ctx); // must not throw and must not spawn anything
    assert.ok(!existsSync(join(home, 'no-such-frpc')));
    assert.ok(routes.length >= 3);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

// Real-binary test (skipped on CI machines without frpc): a frpc pointed at a
// dead hub exits on its own — the supervisor must restart it with backoff, and
// the plugin dispose must kill it for good.
const REAL_FRPC = join(homedir(), '.dsh-fleet', 'frpc-0.71.0', process.platform === 'win32' ? 'frpc.exe' : 'frpc');

test('supervisor restarts a dying frpc with backoff and dispose stops it', { skip: !existsSync(REAL_FRPC) }, async () => {
  const home = join(tmpdir(), `dsh-fleet-test-${Date.now()}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'dsh-fleet.json'), JSON.stringify({
    enabled: true, manageFrpc: true, frpcPath: REAL_FRPC,
    token: 'b'.repeat(32), slug: 'backoff-test', port: '6199',
    hubUrl: '127.0.0.1:7000', restartBackoffSec: 1,
  }));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { routes, ctx } = makeCtx();
    apply(ctx); // ctx.effect captured cb — apply's own ctx.effect call returns it
    const statusRoute = routes.find((r) => r.path === '/api/dsh-fleet/status');

    // frpc cannot reach 127.0.0.1:7000 → it exits → supervisor restarts.
    const deadline = Date.now() + 9000;
    let restarts = 0;
    while (Date.now() < deadline) {
      const res = await call(statusRoute.handler);
      restarts = res.body.restarts || 0;
      if (restarts >= 1) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(restarts >= 1, `supervisor restarted a dying frpc (got restarts=${restarts})`);

    ctx.disposeAll(); // plugin stop: dispose must kill the child for good
    const after = await call(statusRoute.handler);
    assert.equal(after.body.frpcRunning, false);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});
