#!/usr/bin/env bash
# dsh-fleet hub revoke — remove a node from the fleet (shared-token era).
#
# Usage (on the hub, as root):  sudo ./revoke.sh <slug>
# Removes the Caddy node block (the subdomain instantly 404s via the wildcard
# fallback), drops the node from the portal nodes.json (it disappears from the
# portal on the next poll), releases the port, and removes the DNS record
# (auto when provider creds exist, else prints it). The shared frp token is
# untouched, so no frps restart is needed — the tunnel itself dies when the
# node is shut down or its config removed on the node side.
set -euo pipefail

FRP_ETC="/etc/frp"
NODES_FILE="${FRP_ETC}/nodes.json"
CADDY_ETC="/etc/caddy"
FRAG_DIR="${CADDY_ETC}/fleet.d"
FLEET_ENV="${CADDY_ETC}/fleet.env"
PORTAL_DIR="/var/www/fleet-portal"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[revoke] $*"; }
fail() { echo "[revoke] FAIL  $1"; shift || true; echo "[revoke]        check: $*"; exit 1; }
gate() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then log "PASS  ${name}"; else fail "${name}" "$@"; fi
}

update_portal_nodes() {
  python3 -c "
import json, os
d = json.load(open('${NODES_FILE}'))
rows = [{'slug': k, 'port': v['port']} for k, v in sorted(d.items())]
os.makedirs('${PORTAL_DIR}', exist_ok=True)
json.dump(rows, open('${PORTAL_DIR}/nodes.json', 'w'), indent=2)
open('${PORTAL_DIR}/nodes.json', 'a').write('\n')
"
}

SLUG="${1:-}"
[[ $EUID -eq 0 ]] || { echo "run as root: sudo ./revoke.sh <slug>"; exit 1; }
gate "01a: slug was enrolled (nodes.json entry exists)" bash -c \
  "python3 -c \"import json;d=json.load(open('${NODES_FILE}'));assert '${SLUG}' in d\""

DOMAIN="$(grep -oP '^hub\.\K[^:]+(?=:8443)' "${FRAG_DIR}/00-base.caddy" | head -n1)"

# ── 01_drop_the_routes ─────────────────────────────────────────────────────
rm -f "${FRAG_DIR}/10-${SLUG}.caddy"
gate "01b: node Caddy block removed" bash -c "[[ ! -f '${FRAG_DIR}/10-${SLUG}.caddy' ]]"
systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy
gate "01c: Caddyfile still validates after removal" bash -c \
  "caddy validate --config '${CADDY_ETC}/Caddyfile' >/dev/null 2>&1"

# ── 02_portal_list + state ─────────────────────────────────────────────────
python3 -c "
import json
p = '${NODES_FILE}'
d = json.load(open(p))
d.pop('${SLUG}', None)
json.dump(d, open(p, 'w'), indent=2)
open(p, 'a').write('\n')
"
update_portal_nodes
gate "02: portal nodes.json no longer lists ${SLUG}" bash -c \
  "! grep -q '\"${SLUG}\"' '${PORTAL_DIR}/nodes.json'"

# ── 03_dns_record ──────────────────────────────────────────────────────────
if [[ -n "$(grep -oP '^\w+_SECRET_ID=\K.*' "$FLEET_ENV" | head -n1)" || -n "$(grep -oP '^ALIYUN_ACCESS_KEY_ID=\K.*' "$FLEET_ENV" | head -n1)" ]]; then
  gate "03: DNS record auto-removed (${SLUG}.${DOMAIN})" bash -c \
    "python3 '${SCRIPT_DIR}/dns-record.py' remove '${SLUG}' '${DOMAIN}'"
else
  log "PASS  03: DNS auto disabled — remove this record manually:"
  log "        ${SLUG}.${DOMAIN}  A  <VPS-IP>"
fi

log "PASS  04: ${SLUG} revoked — subdomain 404s, portal entry gone, port released"
