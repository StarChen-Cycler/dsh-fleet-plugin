#!/usr/bin/env node
// dsh-fleet node-bootstrap — join this machine's DSH to a fleet hub.
//
// Zero-dependency Node (>=18) script, one entry for Windows/Linux/macOS.
// Gated steps (AGENTS.md): each step verifies its inputs, executes, and gates
// its outputs; a FAIL aborts with the check name and reason. Idempotent.
//
// Usage:
//   node node-bootstrap.mjs --hub <host> --token <t> --slug <s> --port <p>
//   node node-bootstrap.mjs --install-service        (autostart the tunnel)
//   node node-bootstrap.mjs --uninstall-service
// The enroll output line can be passed whole:  node node-bootstrap.mjs <enroll-line>
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRP_VERSION = '0.71.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const FLEET_DIR = process.env.DSH_FLEET_DIR || join(homedir(), '.dsh-fleet');
const FRPC_BIN = join(FLEET_DIR, `frpc-${FRP_VERSION}`, process.platform === 'win32' ? 'frpc.exe' : 'frpc');
const FRPC_CFG = join(FLEET_DIR, 'frpc.toml');
const FRPC_LOG = join(FLEET_DIR, 'frpc.log');

// ── gating helpers ────────────────────────────────────────────────────────
function log(msg) { console.log(`[fleet-node] ${msg}`); }
function fail(name, reason) {
  console.error(`[fleet-node] FAIL  ${name}`);
  console.error(`[fleet-node]        check: ${reason}`);
  process.exit(1);
}
function gate(name, ok, detail) {
  if (ok) log(`PASS  ${name}`);
  else fail(name, detail);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  return {
    ok: res.status === 0,
    out: String(res.stdout || ''),
    err: String(res.stderr || ''),
  };
}

function parseArgs(argv) {
  const args = { install: false, uninstall: false };
  const line = argv.join(' ');
  // Enroll output line: HUB=host:7000 TOKEN=.. SLUG=.. PORT=.. URL=..
  for (const pair of line.split(/\s+/)) {
    if (pair.startsWith('HUB=')) args.hub = pair.slice(4);
    else if (pair.startsWith('TOKEN=')) args.token = pair.slice(6);
    else if (pair.startsWith('SLUG=')) args.slug = pair.slice(5);
    else if (pair.startsWith('PORT=')) args.port = pair.slice(5);
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--hub') args.hub = argv[++i];
    else if (argv[i] === '--token') args.token = argv[++i];
    else if (argv[i] === '--slug') args.slug = argv[++i];
    else if (argv[i] === '--port') args.port = argv[++i];
    else if (argv[i] === '--install-service') args.install = true;
    else if (argv[i] === '--uninstall-service') args.uninstall = true;
  }
  return args;
}

// ── step 01: preflight ────────────────────────────────────────────────────
function preflight(args) {
  if (args.uninstall) { uninstallService(); }
  if (args.install) { installService(); }
  const hub = args.hub || '';
  gate('01a: --hub <host>[:port] supplied', /^[a-z0-9.-]+(:\d+)?$/i.test(hub), `got ${JSON.stringify(hub)}`);
  gate('01b: --token supplied (32 hex from hub enroll)', /^[0-9a-f]{32}$/i.test(args.token || ''), 'token must be 32 hex chars');
  gate('01c: --slug supplied (lowercase a-z0-9-)', /^[a-z0-9][a-z0-9-]{1,62}$/.test(args.slug || ''), `got ${JSON.stringify(args.slug)}`);
  gate('01d: --port in the hub pool (6101-6199)', /^(6[1-9][0-9]{2})$/.test(args.port || ''), `got ${JSON.stringify(args.port)}`);
  const ver = process.versions.node.split('.').map(Number);
  gate('01e: node >= 18', ver[0] >= 18, `node ${process.versions.node}`);
}

// ── step 02: platform asset selection ─────────────────────────────────────
function assetName() {
  const osName = { win32: 'windows', linux: 'linux', darwin: 'darwin' }[process.platform];
  if (!osName) fail('02a: platform supported', `unsupported platform ${process.platform}`);
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!arch) fail('02a: architecture supported', `unsupported arch ${process.arch}`);
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
  return { osName, arch, file: `frp_${FRP_VERSION}_${osName}_${arch}.${ext}` };
}

// ── step 03: download (direct → ghfast.top mirror) ────────────────────────
function download(asset) {
  mkdirSync(FLEET_DIR, { recursive: true });
  const dest = join(FLEET_DIR, asset.file);
  if (existsSync(dest) && statSync(dest).size > 1024 * 1024) {
    log('PASS  03: frp archive already cached — reusing');
    return dest;
  }
  const urls = [
    `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${asset.file}`,
    `https://ghfast.top/https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${asset.file}`,
  ];
  for (const url of urls) {
    log(`        downloading ${url}`);
    const res = run(process.execPath, ['-e', `
      const { writeFileSync } = require('fs');
      fetch(${JSON.stringify(url)}).then((r) => {
        if (!r.ok) process.exit(2);
        return r.arrayBuffer();
      }).then((b) => { writeFileSync(${JSON.stringify(dest)}, Buffer.from(b)); });
    `], { timeout: 180000 });
    if (res.ok && existsSync(dest) && statSync(dest).size > 1024 * 1024) {
      log('PASS  03: archive downloaded');
      return dest;
    }
    log(`        mirror/download failed: ${res.err.slice(-120)}`);
  }
  fail('03: archive download', 'both direct and mirror URLs failed');
}

// ── step 04: extract ──────────────────────────────────────────────────────
function extract(archive, asset) {
  const target = join(FLEET_DIR, `frpc-${FRP_VERSION}`);
  if (existsSync(FRPC_BIN)) { log('PASS  04: frpc binary already extracted — reusing'); return; }
  mkdirSync(target, { recursive: true });
  if (process.platform === 'win32') {
    const res = run('powershell.exe', ['-NoProfile', '-Command',
      `Expand-Archive -Force -Path '${archive}' -DestinationPath '${target}'`]);
    if (!res.ok) fail('04: extract (Expand-Archive)', res.err.slice(-200));
    // Expand-Archive keeps the zip's top-level folder — flatten it up.
    const inner = join(target, `frp_${FRP_VERSION}_${asset.osName}_${asset.arch}`);
    if (!existsSync(FRPC_BIN) && existsSync(inner)) {
      const move = run('powershell.exe', ['-NoProfile', '-Command',
        `Move-Item '${inner}\\*' '${target}' -Force; Remove-Item '${inner}' -Force`]);
      if (!move.ok) fail('04: flatten zip top-level folder', move.err.slice(-200));
    }
  } else {
    const res = run('tar', ['-xzf', archive, '-C', target, '--strip-components=1']);
    if (!res.ok) fail('04: extract (tar)', res.err.slice(-200));
  }
  gate('04: frpc binary present after extract', existsSync(FRPC_BIN), FRPC_BIN);
}

// ── step 05: config ───────────────────────────────────────────────────────
function writeConfig(args) {
  const tpl = readFileSync(join(HERE, 'frpc.toml.tpl'), 'utf8');
  const hubHost = args.hub.includes(':') ? args.hub.split(':')[0] : args.hub;
  const hubPort = args.hub.includes(':') ? args.hub.split(':')[1] : '7000';
  const cfg = tpl
    .replaceAll('__HUB_HOST__', hubHost)
    .replace('serverPort = 7000', `serverPort = ${hubPort}`)
    .replaceAll('__TOKEN__', args.token)
    .replaceAll('__SLUG__', args.slug)
    .replaceAll('__PORT__', args.port);
  writeFileSync(FRPC_CFG, cfg);
  chmodSync(FRPC_CFG, 0o600);
  gate('05: frpc.toml written with all four placeholders resolved',
    !/__[A-Z_]+__/.test(readFileSync(FRPC_CFG, 'utf8')), FRPC_CFG);
}

// ── step 06: start + tunnel-up gate ───────────────────────────────────────
function startFrpc(args) {
  stopFrpc();
  // Redirect frpc stdout/stderr into FRPC_LOG so the tunnel-up gate can read
  // the login line (stdio pipes never reach a detached Windows spawn).
  const logFd = openSync(FRPC_LOG, 'w');
  const child = spawn(FRPC_BIN, ['-c', FRPC_CFG], {
    stdio: ['ignore', logFd, logFd],
    detached: process.platform !== 'win32',
  });
  if (typeof child.unref === 'function') child.unref();
  let up = false;
  for (let i = 0; i < 40; i += 1) {
    const tail = readFileSync(FRPC_LOG, 'utf8').slice(-4000);
    if (tail.includes('login to server success')) { up = true; break; }
    if (tail.includes('auth failed') || tail.includes("token in login doesn")) {
      fail('06: tunnel login', 'the hub rejected this token — was it revoked?');
    }
    if (tail.includes('connection refused') || tail.includes('i/o timeout') || tail.includes('connect: ')) {
      fail('06: tunnel login', 'cannot reach the hub — check the HUB host:port and TCP 7000');
    }
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},250)'], { stdio: 'ignore' });
  }
  gate('06: frpc logged into the hub (tunnel up)', up,
    `no "login to server success" in ${FRPC_LOG} within 10s`);
  log(`PASS  node online: https://${args.slug}.<hub-domain>:8443`);
}

function stopFrpc() {
  if (process.platform === 'win32') {
    run('taskkill.exe', ['/F', '/IM', 'frpc.exe'], { timeout: 10000 });
  } else {
    run('pkill', ['-f', `frpc -c ${FRPC_CFG}`], { timeout: 10000 });
  }
}

// ── step 06b: pin the in-app directory browser (portal workspace picking) ──
// The stock composition mounts directory-picker-auto, which resolves "native"
// on any desktop (loopback bind + local display) — an OS dialog a remote
// browser cannot see. Pin the browse backend+surface in the profile's own
// patch layer: host.listDirectory/createDirectory are NOT privileged methods,
// so the picker works through any trusted entry regardless of launch method.
const PROFILE_PATCH = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'web', 'cordis.patch.yml');
const PICKER_OVERLAY = `
# Pinned by dsh-fleet node-bootstrap (step 06b): in-app directory browser, so
# the workspace picker works through the portal.
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-browse-surface
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`;
// Pure patch computation, exported for tests: returns { text, changed }.
function applyPickerPatch(existing) {
  if (existing.includes('dsh-host-directory-picker-browse')) return { text: existing, changed: false };
  const stripped = existing.replace(/^\s*\[\]\s*$/m, '').trimEnd();
  const first = stripped.split('\n').find((l) => l.trim() !== '');
  if (first !== undefined && !/^\s*(#|-)/.test(first)) {
    throw new Error('profile patch is not a comment/array document');
  }
  const header = stripped === '' ? '# dsh profile patch layer (created by dsh-fleet node-bootstrap).\n' : `${stripped}\n`;
  return { text: header + PICKER_OVERLAY, changed: true };
}
function pinBrowsePicker() {
  const existing = existsSync(PROFILE_PATCH) ? readFileSync(PROFILE_PATCH, 'utf8') : '';
  let result;
  try {
    result = applyPickerPatch(existing);
  } catch (error) {
    fail('06b: profile patch shape', `${error.message} — pin the rows manually per docs/trusted-host.md`);
  }
  if (!result.changed) { log('PASS  06b: browse picker already pinned — idempotent'); return; }
  mkdirSync(dirname(PROFILE_PATCH), { recursive: true });
  writeFileSync(PROFILE_PATCH, result.text);
  const after = readFileSync(PROFILE_PATCH, 'utf8');
  gate('06b: browse picker pinned in the web profile patch',
    after.includes('dsh-host-directory-picker-browse')
      && after.includes('dsh-client-ui-directory-picker-browse')
      && /id: directory-picker\n\s+disabled: true/.test(after),
    PROFILE_PATCH);
}

// ── step 07: autostart service (Windows WinSW / macOS launchd / Linux systemd --user) ──
function fill(tplPath, map) {
  let text = readFileSync(join(HERE, tplPath), 'utf8');
  for (const [k, v] of Object.entries(map)) text = text.replaceAll(k, v);
  return text;
}

function serviceActive() {
  if (process.platform === 'win32') {
    return run('sc.exe', ['query', 'dsh-fleet-frpc'], { timeout: 10000 }).out.includes('RUNNING');
  }
  if (process.platform === 'darwin') {
    return run('launchctl', ['list'], { timeout: 10000 }).out.includes('com.dsh-fleet.frpc');
  }
  return run('systemctl', ['--user', 'is-active', '--quiet', 'dsh-fleet-frpc'], { timeout: 10000 }).ok;
}

function installService() {
  gate('07a: frpc config exists (bootstrap ran)', existsSync(FRPC_CFG), FRPC_CFG);
  if (serviceActive()) { log('PASS  07: autostart already active — idempotent'); process.exit(0); }
  const map = { __FRPC_BIN__: FRPC_BIN, __FRPC_CFG__: FRPC_CFG, __FLEET_DIR__: FLEET_DIR };
  if (process.platform === 'win32') {
    const winsw = join(FLEET_DIR, 'WinSW-x64.exe');
    if (!existsSync(winsw)) {
      const res = run(process.execPath, ['-e', `
        fetch('https://ghfast.top/https://github.com/winsw/winsw/releases/download/v2.11.0/WinSW-x64.exe')
          .then((r) => { if (!r.ok) process.exit(2); return r.arrayBuffer(); })
          .then((b) => require('fs').writeFileSync(${JSON.stringify(winsw)}, Buffer.from(b)));
      `], { timeout: 120000 });
      if (!res.ok) fail('07b: WinSW download', res.err.slice(-200));
    }
    writeFileSync(join(FLEET_DIR, 'dsh-fleet-frpc.xml'), fill('autostart-windows.xml.tpl', map));
    const res = run(winsw, ['install', join(FLEET_DIR, 'dsh-fleet-frpc.xml')], { timeout: 30000 });
    if (!res.ok) fail('07b: WinSW install (run this shell as administrator)', res.err.slice(-200));
    run(winsw, ['start', join(FLEET_DIR, 'dsh-fleet-frpc.xml')], { timeout: 30000 });
  } else if (process.platform === 'darwin') {
    const plist = join(homedir(), 'Library', 'LaunchAgents', 'com.dsh-fleet.frpc.plist');
    writeFileSync(plist, fill('autostart-macos.plist.tpl', map));
    run('launchctl', ['load', plist], { timeout: 10000 });
  } else {
    const dir = join(homedir(), '.config', 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'dsh-fleet-frpc.service'), fill('autostart-linux.service.tpl', map));
    run('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 });
    run('systemctl', ['--user', 'enable', '--now', 'dsh-fleet-frpc'], { timeout: 15000 });
    run('loginctl', ['enable-linger', process.env.USER || ''], { timeout: 10000 });
  }
  gate('07c: autostart registered and active', serviceActive(),
    'service did not report active after install');
  process.exit(0);
}

function uninstallService() {
  if (process.platform === 'win32') {
    const winsw = join(FLEET_DIR, 'WinSW-x64.exe');
    if (existsSync(winsw)) run(winsw, ['uninstall', join(FLEET_DIR, 'dsh-fleet-frpc.xml')], { timeout: 30000 });
  } else if (process.platform === 'darwin') {
    run('launchctl', ['unload', join(homedir(), 'Library', 'LaunchAgents', 'com.dsh-fleet.frpc.plist')], { timeout: 10000 });
  } else {
    run('systemctl', ['--user', 'disable', '--now', 'dsh-fleet-frpc'], { timeout: 15000 });
  }
  gate('07: autostart removed', !serviceActive(), 'service still reports active');
  process.exit(0);
}

// ── main ──────────────────────────────────────────────────────────────────
const isMain = (() => {
  try { return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]); } catch { return false; }
})();
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.install) installService();
  if (args.uninstall) uninstallService();
  preflight(args);
  const asset = assetName();
  const archive = download(asset);
  extract(archive, asset);
  writeConfig(args);
  startFrpc(args);
  pinBrowsePicker();
  log('node joined the fleet. Next:  node node-bootstrap.mjs --install-service');
  log('if DSH is already running, restart it (dsh-fleet web) to load the picker overlay');
}
export { applyPickerPatch, pinBrowsePicker };
