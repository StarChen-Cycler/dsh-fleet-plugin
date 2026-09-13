#!/usr/bin/env node
// Mint a DSH browser-session cookie (0.1.5+ `dsh web` auth) for a given authority.
//
// DSH 0.1.5 made `dsh web` authenticate browsers: the printed URL carries a
// per-process launch token that exchanges for an authority-bound signed cookie
// (`dsh-auth-<hash(authority)>`), signed with a secret persisted in the
// credentials store. Behind the fleet portal the Node Host is rewritten to
// 127.0.0.1:3080, so a cookie minted for that authority authenticates every
// proxied request — REST and WebSocket alike — without any per-browser visit.
//
// Usage:
//   node browser-session-cookie.mjs --credentials <path> --authority <host:port> [--days 30]
// Prints:  dsh-auth-<hash>=<value>
//
// Re-run after the cookie's lifetime elapses (or after the credentials store is
// rotated) and update the node fragment's `header_up Cookie` line.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const credentialsPath = arg('credentials');
const authority = arg('authority');
const days = Number(arg('days', '30'));
if (!credentialsPath || !authority || !Number.isSafeInteger(days) || days < 1) {
  console.error('usage: node browser-session-cookie.mjs --credentials <path> --authority <host:port> [--days 30]');
  process.exit(2);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
const secretBytes = (value) => {
  const decoded = Buffer.from(String(value).replaceAll('-', '+').replaceAll('_', '/'), 'base64');
  if (decoded.byteLength !== 32) throw new Error('browser-session secret is not 32 bytes');
  return decoded;
};

// Minimal line-based YAML read: find the record block, then its `secret:` line.
const text = readFileSync(credentialsPath, 'utf8');
const lines = text.split(/\r?\n/u);
const start = lines.findIndex((l) => /^\s*client-connection\/browser-session:\s*$/u.test(l));
if (start === -1) throw new Error('credential record client-connection/browser-session not found');
const indent = lines[start].match(/^\s*/u)[0].length;
let secret;
for (let i = start + 1; i < lines.length; i += 1) {
  const line = lines[i];
  if (line.trim() === '') continue;
  const lineIndent = line.match(/^\s*/u)[0].length;
  if (lineIndent <= indent) break;
  const m = /^\s*secret:\s*(\S+)\s*$/u.exec(line);
  if (m) { secret = m[1]; break; }
}
if (secret === undefined) throw new Error('secret not found inside the browser-session record');

const secretKey = secretBytes(secret);
const name = 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest());
const issuedAt = Date.now();
const expiresAt = issuedAt + days * 24 * 60 * 60 * 1000;
const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), 'utf8'));
const value = `v1.${body}.${b64url(createHmac('sha256', secretKey).update(body).digest())}`;
console.log(`${name}=${value}`);
