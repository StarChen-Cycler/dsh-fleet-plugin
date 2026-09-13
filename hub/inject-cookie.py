#!/usr/bin/env python3
"""Inject a DSH browser-session cookie into one node fragment's proxies.

For nodes on DSH 0.1.5+ (whose `dsh web` requires an authority-bound signed
cookie — see docs/TROUBLESHOOTING.md). Mint the cookie on the node with
`hub/browser-session-cookie.mjs`, copy it here, then:

  sudo python3 inject-cookie.py <slug> <cookie-file>
  sudo systemctl reload caddy

Idempotent: replaces an existing injected `header_up Cookie` line, otherwise
adds one after every `header_up Host` line (WS gate, probe, and REST proxies).
"""
import pathlib
import re
import subprocess
import sys

if len(sys.argv) != 3:
    print('usage: inject-cookie.py <slug> <cookie-file>')
    sys.exit(2)
slug = sys.argv[1]
cookie = pathlib.Path(sys.argv[2]).read_text().strip()
if '=' not in cookie or ' ' in cookie:
    print('ERROR: cookie looks malformed (expect name=value)')
    sys.exit(1)

path = pathlib.Path(f'/etc/caddy/fleet.d/10-{slug}.caddy')
if not path.exists():
    print(f'ERROR: fragment not found: {path}')
    sys.exit(1)

text = path.read_text()
line = f'\t\t\t\theader_up Cookie "{cookie}"'
if 'header_up Cookie' in text:
    text, n = re.subn(r'\t+header_up Cookie ".*"', line.lstrip('\t'), text)
    print(f'replaced {n} existing cookie line(s)')
else:
    text, n = re.subn(r'(\t+header_up Host [^\n]+\n)', r'\1' + line + '\n', text)
    print(f'inserted cookie line into {n} proxy block(s)')

path.write_text(text)
result = subprocess.run(
    ['caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
    capture_output=True, text=True)
print('validate:', (result.stdout + result.stderr).strip().splitlines()[-1])
if result.returncode != 0:
    sys.exit(1)
print('OK — now: systemctl reload caddy')
