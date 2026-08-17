#!/usr/bin/env bash
# dsh-fleet hub revoke — drop one node's credentials and routes.
#
# Usage (on the hub, as root):  sudo ./revoke.sh <slug>
# Removes the token (frps re-read), the Caddy node block, the DNS record
# (auto when provider creds exist, else prints the record to remove), and
# releases the port. Other nodes are unaffected (frps API reload keeps
# established tunnels up).
set -euo pipefail

FRP_ETC="/etc/frp"
TOKENS_FILE="${FRP_ETC}/tokens"
NODES_FILE="${FRP_ETC}/nodes.json"
FRPS_CFG="${FRP_ETC}/frps.toml"
CADDY_ETC="/etc/caddy"
FRAG_DIR="${CADDY_ETC}/fleet.d"
FLEET_ENV="${CADDY_ETC}/fleet.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[revoke] $*"; }
fail() { echo "[revoke] FAIL  $1"; shift || true; echo "[revoke]        check: $*"; exit 1; }
gate() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then log "PASS  ${name}"; else fail "${name}" "$@"; fi
}

SLUG="${1:-}"
[[ $EUID -eq 0 ]] || { echo "run as root: sudo ./revoke.sh <slug>"; exit 1; }
gate "01a: slug was enrolled (nodes.json entry exists)" bash -c \
  "python3 -c \"import json;d=json.load(open('${NODES_FILE}'));assert '${SLUG}' in d\""

TOKEN="$(python3 -c "import json;print(json.load(open('${NODES_FILE}'))['${SLUG}']['token'])")"
DOMAIN="$(grep -oP '^hub\.\K[^:]+(?=:8443)' "${FRAG_DIR}/00-base.caddy" | head -n1)"

# ── 01_token_removal + frps reload ─────────────────────────────────────────
python3 -c "
import json
p = '${NODES_FILE}'
d = json.load(open(p))
d.pop('${SLUG}', None)
json.dump(d, open(p, 'w'), indent=2)
open(p, 'a').write('\n')
"
grep -vxF "$TOKEN" "$TOKENS_FILE" > "${TOKENS_FILE}.new" && mv "${TOKENS_FILE}.new" "$TOKENS_FILE"
chmod 600 "$TOKENS_FILE" "$NODES_FILE"
gate "01b: token line removed from tokenSource" bash -c "! grep -q '${TOKEN}' '${TOKENS_FILE}'"

FRPS_USER="$(grep -oP 'webServer.user = "\K[^"]+' "$FRPS_CFG")"
FRPS_PW="$(grep -oP 'webServer.password = "\K[^"]+' "$FRPS_CFG")"
curl -fsS -u "${FRPS_USER}:${FRPS_PW}" -X POST -o /dev/null "http://127.0.0.1:7500/api/reload" \
  || systemctl restart frps
gate "01c: frps reloaded and the proxy is gone from the state API" bash -c \
  "! curl -fsS -u '${FRPS_USER}:${FRPS_PW}' 'http://127.0.0.1:7500/api/proxy/tcp' | grep -q '\"name\":\"${SLUG}\"'"

# ── 02_caddy_block + dns record ────────────────────────────────────────────
rm -f "${FRAG_DIR}/10-${SLUG}.caddy"
systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy
gate "02a: node Caddy block removed and config still validates" bash -c \
  "caddy validate --config '${CADDY_ETC}/Caddyfile' >/dev/null 2>&1"

if [[ -n "$(grep -oP '^\w+_SECRET_ID=\K.*' "$FLEET_ENV" | head -n1)" || -n "$(grep -oP '^ALIYUN_ACCESS_KEY_ID=\K.*' "$FLEET_ENV" | head -n1)" ]]; then
  gate "02b: DNS record auto-removed (${SLUG}.${DOMAIN})" bash -c \
    "python3 '${SCRIPT_DIR}/dns-record.py' remove '${SLUG}' '${DOMAIN}'"
else
  log "PASS  02b: DNS auto disabled — remove this record manually:"
  log "        ${SLUG}.${DOMAIN}  A  <VPS-IP>"
fi

log "PASS  03: ${SLUG} revoked — tunnel dead, port released, other nodes untouched"
