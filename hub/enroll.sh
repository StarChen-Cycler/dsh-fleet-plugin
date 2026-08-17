#!/usr/bin/env bash
# dsh-fleet hub enroll — register a node and wire its routes (shared-token
# architecture, per the recorded decision: frp v0.71 tokenSource holds ONE
# token; per-node frps instances are the later upgrade path).
#
# Usage (on the hub, as root):  sudo ./enroll.sh <slug>
# Idempotent: re-enrolling an existing slug reuses its port and prints the
# SAME credentials. Every step gates its inputs (AGENTS.md gated rules).
#
# Output (last line, for node-bootstrap):
#   HUB=<hub-host>:7000 TOKEN=<shared token> SLUG=<slug> PORT=<port> URL=https://<slug>.<domain>:8443
set -euo pipefail

# ── constants ──────────────────────────────────────────────────────────────
FRP_ETC="/etc/frp"
TOKENS_FILE="${FRP_ETC}/tokens"
NODES_FILE="${FRP_ETC}/nodes.json"
CADDY_ETC="/etc/caddy"
FRAG_DIR="${CADDY_ETC}/fleet.d"
FLEET_ENV="${CADDY_ETC}/fleet.env"
PORTAL_DIR="/var/www/fleet-portal"
PORT_MIN=6101
PORT_MAX=6199
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[enroll] $*"; }
fail() { echo "[enroll] FAIL  $1"; shift || true; echo "[enroll]        check: $*"; exit 1; }
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

# ── 01_preflight ───────────────────────────────────────────────────────────
SLUG="${1:-}"
[[ $EUID -eq 0 ]] || { echo "run as root: sudo ./enroll.sh <slug>"; exit 1; }
gate "01a: slug format (lowercase, 2-63 chars, a-z0-9 and -)" bash -c \
  "grep -Eq '^[a-z0-9][a-z0-9-]{1,62}$' <<< '${SLUG}'"
gate "01b: hub-setup artifacts present (tokens + fragments + fleet env)" bash -c \
  "[[ -s '${TOKENS_FILE}' && -d '${FRAG_DIR}' && -f '${FLEET_ENV}' ]]"

# ── 02_shared_token ────────────────────────────────────────────────────────
TOKEN="$(cat "$TOKENS_FILE")"
gate "02: shared fleet token readable (32 hex)" bash -c \
  "grep -Eq '^[0-9a-f]{32}\$' <<< '${TOKEN}'"

# ── 03_port_pool (idempotent per slug) ─────────────────────────────────────
mkdir -p "$FRP_ETC"
[[ -f "$NODES_FILE" ]] || echo '{}' > "$NODES_FILE"
chmod 600 "$NODES_FILE"
if grep -q "\"${SLUG}\"" "$NODES_FILE" 2>/dev/null; then
  PORT="$(python3 -c "import json;print(json.load(open('${NODES_FILE}'))['${SLUG}']['port'])")"
  log "PASS  03: ${SLUG} already enrolled — reusing port ${PORT}"
else
  PORT=""
  for p in $(seq $PORT_MIN $PORT_MAX); do
    if ! grep -qE "\"port\": ${p}\b" "$NODES_FILE" 2>/dev/null; then PORT="$p"; break; fi
  done
  [[ -n "$PORT" ]] || fail "03: port pool exhausted (${PORT_MIN}-${PORT_MAX})" "enroll fewer nodes or extend the pool"
  python3 -c "
import json
p = '${NODES_FILE}'
d = json.load(open(p))
d['${SLUG}'] = {'port': ${PORT}}
json.dump(d, open(p, 'w'), indent=2)
open(p, 'a').write('\n')
"
  chmod 600 "$NODES_FILE"
  gate "03: port ${PORT} recorded for ${SLUG}" bash -c \
    "python3 -c \"import json;d=json.load(open('${NODES_FILE}'));assert d['${SLUG}']['port']==${PORT}\""
fi

# ── 04_dns_record ──────────────────────────────────────────────────────────
DOMAIN="$(grep -oP '^hub\.\K[^:]+(?=:8443)' "${FRAG_DIR}/00-base.caddy" | head -n1)"
VPS_IP="$(curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || echo '')"
if [[ -n "$(grep -oP '^\w+_SECRET_ID=\K.*' "$FLEET_ENV" | head -n1)" || -n "$(grep -oP '^ALIYUN_ACCESS_KEY_ID=\K.*' "$FLEET_ENV" | head -n1)" ]]; then
  gate "04: DNS record auto-created (${SLUG}.${DOMAIN} A ${VPS_IP})" bash -c \
    "python3 '${SCRIPT_DIR}/dns-record.py' add '${SLUG}' '${DOMAIN}' '${VPS_IP}'"
else
  log "PASS  04: DNS auto disabled — create this record manually:"
  log "        ${SLUG}.${DOMAIN}  A  ${VPS_IP}"
fi

# ── 05_caddy_node_fragment ─────────────────────────────────────────────────
PW_HASH="$(grep -oP '^\s*fleet \K[^\s]+' "${FRAG_DIR}/00-base.caddy" | head -n1)"
TLS_MODE="$(grep -oP 'fleet-tls-mode: \K\w+' "${FRAG_DIR}/00-base.caddy" | head -n1)"
DNS_ENV_ID="$(grep -oP 'fleet-tls-env-id: \K\w*' "${FRAG_DIR}/00-base.caddy" | head -n1)"
DNS_ENV_KEY="$(grep -oP 'fleet-tls-env-key: \K\w*' "${FRAG_DIR}/00-base.caddy" | head -n1)"
if [[ "$TLS_MODE" == "http" ]]; then
  TLS_BLOCK=$'\t# tls mode http — automatic issuance (keep TCP 80 open)'
elif [[ "$TLS_MODE" == "tencentcloud" || "$TLS_MODE" == "alidns" ]]; then
  TLS_BLOCK=$'\ttls {\n\t\tdns '${TLS_MODE}$' {env.'${DNS_ENV_ID}$'} {env.'${DNS_ENV_KEY}$'}\n\t}'
else
  fail "05a: tls mode" "cannot read fleet-tls-mode from 00-base.caddy (got '${TLS_MODE}')"
fi
cat > "${FRAG_DIR}/10-${SLUG}.caddy" <<EOF
${SLUG}.${DOMAIN}:8443 {
${TLS_BLOCK}

	basic_auth {
		fleet ${PW_HASH}
	}

	reverse_proxy 127.0.0.1:${PORT}
}
EOF
gate "05b: node Caddy fragment written and validates" bash -c \
  "caddy validate --config '${CADDY_ETC}/Caddyfile' >/dev/null 2>&1"
systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy
gate "05c: caddy reloaded with the new node block" bash -c "systemctl is-active caddy"

# ── 06_portal_nodes + bootstrap line ───────────────────────────────────────
update_portal_nodes
gate "06: portal nodes.json lists ${SLUG}" bash -c \
  "grep -q '\"${SLUG}\"' '${PORTAL_DIR}/nodes.json'"

log "PASS  07: ${SLUG} enrolled (port ${PORT})"
echo "HUB=hub.${DOMAIN}:7000 TOKEN=${TOKEN} SLUG=${SLUG} PORT=${PORT} URL=https://${SLUG}.${DOMAIN}:8443"
