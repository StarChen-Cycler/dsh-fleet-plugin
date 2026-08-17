#!/usr/bin/env node
// dsh-fleet web — start this node's DSH reachable through the fleet portal.
//
// Equivalent to `dsh --profile web --trusted-host <slug>.<hub>:8443`: the
// DSH /api trust fence rejects Hosts that are not loopback or --trusted-host
// authorities, and the portal reaches the node exactly as
// https://<slug>.<hub>:8443. Privileged methods stay loopback-locked (see
// docs/trusted-host.md — the fence is why this wrapper exists).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-fleet.json');
const PORTAL_PORT = process.env.FLEET_PORTAL_PORT || '8443';

function load() {
  try { return JSON.parse(readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}

function nodeAuthority(cfg) {
  const hub = String(cfg.hubUrl || '');
  const host = hub.includes(':') ? hub.split(':')[0] : hub;
  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null; // IP or empty → no domain authority
  const root = host.replace(/^hub\./, '');
  const slug = String(cfg.slug || '');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return null;
  return `${slug}.${root}:${PORTAL_PORT}`;
}

const args = process.argv.slice(2);
if (args[0] === 'web') args.shift();
const cfg = load();
const authority = nodeAuthority(cfg);

const dshArgs = ['--profile', 'web'];
if (authority) dshArgs.push('--trusted-host', authority);
dshArgs.push(...args);

if (!authority && cfg.hubUrl && cfg.slug) {
  console.warn('[dsh-fleet] hubUrl is not a domain (or slug missing) — starting WITHOUT --trusted-host;');
  console.warn('[dsh-fleet] the portal will get 403 on /api until you configure a domain hub. See docs/trusted-host.md');
}
if (!authority) console.warn('[dsh-fleet] no node authority derived from dsh-fleet.json — passing through to plain `dsh --profile web`.');

const res = spawnSync('dsh', dshArgs, { stdio: 'inherit' });
process.exit(res.status === null ? 1 : res.status);
