// Regression guard for the node Caddy fragment template in hub/enroll.sh:
// the portal probes /dsh-status cross-origin WITHOUT credentials, so the
// fragment must exempt that path from basic_auth — and the exemption must sit
// before the catch-all basic_auth handle inside the route block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENROLL = join(dirname(fileURLToPath(import.meta.url)), '..', 'hub', 'enroll.sh');
const src = readFileSync(ENROLL, 'utf8');

test('node fragment template exempts /dsh-status from basic_auth', () => {
  assert.ok(src.includes('handle /dsh-status*'), 'probe handle missing from the template');
});

test('probe handle is ordered before the catch-all basic_auth handle', () => {
  const probe = src.indexOf('handle /dsh-status*');
  const auth = src.indexOf('basic_auth {');
  const wsGate = src.indexOf('handle @ws {');
  assert.ok(probe > -1 && auth > -1 && wsGate > -1);
  assert.ok(wsGate < probe, 'WS 401 gate must come before the probe exemption');
  assert.ok(probe < auth, 'probe exemption must come before basic_auth or probes get 401');
});

test('probe handle still proxies with the loopback Host rewrite', () => {
  const probe = src.slice(src.indexOf('handle /dsh-status*'));
  const block = probe.slice(0, probe.indexOf('handle {'));
  assert.ok(block.includes('reverse_proxy 127.0.0.1:${PORT}'));
  assert.ok(block.includes('header_up Host 127.0.0.1:3080'));
  assert.ok(block.includes('header_up -Origin'));
});
