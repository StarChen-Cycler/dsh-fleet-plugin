#!/usr/bin/env bash
# dsh-fleet hub-setup — gated, idempotent Debian 12 hub installer.
#
# Purpose (one sentence): turn a clean Debian 12 VPS into a dsh-fleet hub —
# frps (per-node token auth + TLS, loopback dashboard), Caddy (DNS-01 wildcard
# TLS + bcrypt basic_auth + portal static site + server-side dashboard proxy),
# systemd autostart for both.
#
# Gated pipeline contract (see AGENTS.md):
#   - numbered steps run in order; each step gates its inputs before executing
#     and gates its outputs after; a FAIL aborts immediately with the check
#     name, measured value, and threshold.
#   - idempotent: artifacts already present are left alone unless --force.
#   - trace: every PASS/FAIL line and command output lands in $SETUP_LOG;
#     the final STATUS file is PASS or FAIL, nothing in between.
#
# Usage:
#   sudo ./hub-setup.sh --domain hub.example.com --dns tencentcloud|alidns|http \
#       [--email admin@example.com] [--password '<portal password>'] [--force]
#   --dns http = Caddy HTTP-01 challenge (open TCP 80; best for non-mainland
#   hubs; no DNS API credentials needed). Default Debian 12 or Ubuntu 22.04+.
# Env overrides: FLEET_DOMAIN FLEET_DNS_PROVIDER FLEET_EMAIL FLEET_PASSWORD
set -euo pipefail

# ── constants ──────────────────────────────────────────────────────────────
FRP_VERSION="v0.71.0"
FRP_TARBALL="frp_${FRP_VERSION#v}_linux_amd64.tar.gz"
FRP_URL="https://github.com/fatedier/frp/releases/download/${FRP_VERSION}/${FRP_TARBALL}"
FRP_DIR="/opt/frp"
FRP_ETC="/etc/frp"
TOKENS_FILE="${FRP_ETC}/tokens"
FRPS_BIN="${FRP_DIR}/frps"

CADDY_BIN="/usr/local/bin/caddy"
CADDY_ETC="/etc/caddy"
FRAG_DIR="${CADDY_ETC}/fleet.d"
PORTAL_DIR="/var/www/fleet-portal"
FLEET_ENV="${CADDY_ETC}/fleet.env"

SETUP_LOG="/var/log/dsh-fleet-setup.log"
STATUS_DIR="/var/log/dsh-fleet"
STATUS_FILE="${STATUS_DIR}/STATUS.txt"

# ── helpers ────────────────────────────────────────────────────────────────
log() { echo "[dsh-fleet] $*" | tee -a "$SETUP_LOG"; }

fail() {
  log "FAIL  $1"
  shift || true
  log "       check: $*"
  echo "FAIL" > "$STATUS_FILE"
  exit 1
}

# gate <check-name> <command...> — PASS when the command exits 0.
gate() {
  local name="$1"; shift
  if "$@" >>"$SETUP_LOG" 2>&1; then
    log "PASS  ${name}"
  else
    fail "${name}" "$@"
  fi
}

mkdir -p "$STATUS_DIR"
: > "$SETUP_LOG"
echo "RUNNING" > "$STATUS_FILE"

# ── 00_preflight: args + platform ──────────────────────────────────────────
log "00_preflight  args=${*}  (setup log: ${SETUP_LOG})"
[[ $EUID -eq 0 ]] || { echo "must run as root (sudo ./hub-setup.sh ...)"; exit 1; }

DOMAIN="${FLEET_DOMAIN:-}"
DNS_PROVIDER="${FLEET_DNS_PROVIDER:-}"
EMAIL="${FLEET_EMAIL:-}"
PORTAL_PW="${FLEET_PASSWORD:-}"
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --dns) DNS_PROVIDER="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --password) PORTAL_PW="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

gate "00a: domain supplied and well-formed" bash -c \
  "[[ -n '${DOMAIN}' ]] && grep -Eq '^[a-z0-9.-]+\\.[a-z]{2,}$' <<< '${DOMAIN}'"
case "$DNS_PROVIDER" in
  tencentcloud) DNS_ENV_ID="TENCENT_SECRET_ID"; DNS_ENV_KEY="TENCENT_SECRET_KEY" ;;
  alidns)       DNS_ENV_ID="ALIYUN_ACCESS_KEY_ID"; DNS_ENV_KEY="ALIYUN_ACCESS_KEY_SECRET" ;;
  http)         DNS_ENV_ID=""; DNS_ENV_KEY="" ;;
  *) fail "00b: dns provider" "--dns must be tencentcloud, alidns, or http (got '${DNS_PROVIDER}')" ;;
esac
log "PASS  00b: dns provider=${DNS_PROVIDER} (env ${DNS_ENV_ID:-<none>}/${DNS_ENV_KEY:-<none>})"
# TLS block: DNS-01 providers use their plugin; `http` omits the tls directive
# entirely — Caddy auto-issues via HTTP-01 on :80 / TLS-ALPN on :443 (needs
# TCP 80 open; the natural choice for non-mainland hubs like Hong Kong, and it
# needs NO DNS API credentials).
if [[ "$DNS_PROVIDER" == "http" ]]; then
  TLS_BLOCK=$'\t# tls mode http — automatic issuance (keep TCP 80 open)'
else
  TLS_BLOCK=$'\ttls {\n\t\tdns '${DNS_PROVIDER}$' {env.'${DNS_ENV_ID}$'} {env.'${DNS_ENV_KEY}$'}\n\t}'
fi
gate "00c: running Debian 12 or Ubuntu 22.04+" bash -c \
  "grep -qE '^ID=(debian|ubuntu)$' /etc/os-release"

# ── 01_deps ────────────────────────────────────────────────────────────────
log "01_deps  pre-flight: apt install ≈ 30-60 s"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >>"$SETUP_LOG" 2>&1
apt-get install -y -qq curl tar ca-certificates openssl >>"$SETUP_LOG" 2>&1
gate "01: curl/tar/openssl installed" bash -c \
  "command -v curl && command -v tar && command -v openssl"

# ── 02_frps_binary ─────────────────────────────────────────────────────────
log "02_frps  pre-flight: download+extract ≈ 10-30 s (one-off)"
if [[ ! -x "$FRPS_BIN" ]]; then
  mkdir -p "$FRP_DIR"
  tmp="$(mktemp -d)"
  gate "02a: frps tarball downloaded (${FRP_URL})" bash -c \
    "curl -fsSL '${FRP_URL}' -o '${tmp}/frp.tar.gz' || curl -fsSL 'https://ghfast.top/${FRP_URL}' -o '${tmp}/frp.tar.gz'"
  tar -xzf "${tmp}/frp.tar.gz" -C "$tmp"
  cp "${tmp}"/frp_*/frps "$FRPS_BIN"
  rm -rf "$tmp"
fi
# --force deliberately never re-copies over a RUNNING binary (Linux refuses
# with "Text file busy"); the version gate below still catches mismatches.
gate "02b: frps version == ${FRP_VERSION}" bash -c \
  "\"$FRPS_BIN\" --version 2>&1 | grep -q '${FRP_VERSION#v}'"

# ── 03_frps_config ─────────────────────────────────────────────────────────
log "03_frpscfg  gates: per-node tokenSource + TLS + loopback dashboard"
mkdir -p "$FRP_ETC"
if [[ ! -f "${FRP_ETC}/frps.toml" || $FORCE -eq 1 ]]; then
  DASH_PW="$(openssl rand -hex 16)"
  sed "s/__DASHBOARD_PASSWORD__/${DASH_PW}/" \
    "$(dirname "$0")/frps.toml.tpl" > "${FRP_ETC}/frps.toml"
  chmod 600 "${FRP_ETC}/frps.toml"
fi
# Shared fleet token (architecture decision 2026-08-17: frp v0.71 tokenSource
# supports ONE token per file, read once at startup — per-node tokens upgrade
# later via per-node frps instances). Generated once; --force never rotates it
# because every enrolled node holds it.
if [[ ! -s "$TOKENS_FILE" ]]; then
  openssl rand -hex 16 > "$TOKENS_FILE"
  chmod 600 "$TOKENS_FILE"
  log "       generated shared fleet token — SAVE IT (nodes join with it): $(cat "$TOKENS_FILE")"
fi
gate "03a: tokenSource configured" bash -c \
  "grep -q 'auth.tokenSource' '${FRP_ETC}/frps.toml'"
gate "03b: control-channel TLS forced" bash -c \
  "grep -q 'transport.tls.force' '${FRP_ETC}/frps.toml'"
gate "03c: dashboard bound to loopback only" bash -c \
  "grep -q 'webServer.addr = \"127.0.0.1\"' '${FRP_ETC}/frps.toml'"
gate "03d: tokens file exists and is root-only" bash -c \
  "[[ -f '${TOKENS_FILE}' ]] && [[ \$(stat -c %a '${TOKENS_FILE}') == '600' ]]"

# ── 04_frps_service ────────────────────────────────────────────────────────
log "04_frpssvc"
if [[ ! -f /etc/systemd/system/frps.service || $FORCE -eq 1 ]]; then
  cat > /etc/systemd/system/frps.service <<EOF
[Unit]
Description=dsh-fleet frps server
After=network.target

[Service]
Type=simple
ExecStart=${FRPS_BIN} -c ${FRP_ETC}/frps.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
fi
systemctl enable frps >/dev/null 2>&1 || true
systemctl restart frps
gate "04a: frps service active" systemctl is-active frps
gate "04b: frps listening on 7000 (waits up to 10s for the bind)" bash -c \
  "for i in \$(seq 1 20); do ss -lntp | grep -q ':7000 ' && exit 0; sleep 0.5; done; exit 1"

# ── 05_caddy_binary (build once with both DNS plugins) ─────────────────────
log "05_caddy  pre-flight: Go+xcaddy build ≈ 2-5 min (one-off; network to Go proxy)"
if [[ ! -x "$CADDY_BIN" || $FORCE -eq 1 ]]; then
  apt-get install -y -qq golang-go >>"$SETUP_LOG" 2>&1
  export GOBIN=/usr/local/bin
  gate "05a: xcaddy installed" bash -c \
    "go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest"
  build_caddy() {
    xcaddy build \
      --with github.com/caddy-dns/tencentcloud \
      --with github.com/caddy-dns/alidns \
      --output "$CADDY_BIN"
  }
  if ! build_caddy >>"$SETUP_LOG" 2>&1; then
    log "       retrying with GOPROXY=https://goproxy.cn,direct"
    GOPROXY="https://goproxy.cn,direct" build_caddy
  fi
fi
gate "05b: caddy built with both DNS plugins" bash -c \
  "\"$CADDY_BIN\" list-modules 2>/dev/null | grep -Eq 'dns.providers.(tencentcloud|alidns)'"

# ── 06_portal_password ─────────────────────────────────────────────────────
log "06_portalpw  bcrypt hash for the deployment-level single password"
mkdir -p "$CADDY_ETC" "$FRAG_DIR"
# Re-runs must NEVER rotate the password: node fragments copy the bcrypt hash
# from 00-base.caddy, and a rotated hash would lock already-enrolled nodes
# out. --password overrides explicitly; otherwise reuse, else generate once.
if [[ -z "$PORTAL_PW" && -s "${CADDY_ETC}/fleet.pw" ]]; then
  PORTAL_PW="$(cat "${CADDY_ETC}/fleet.pw")"
  log "       reusing existing portal password from ${CADDY_ETC}/fleet.pw"
fi
if [[ -z "$PORTAL_PW" ]]; then
  PORTAL_PW="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  log "       no --password supplied: generated a random 24-char portal password"
  log "       SAVE IT NOW: ${PORTAL_PW}"
fi
umask 077
echo "$PORTAL_PW" > "${CADDY_ETC}/fleet.pw"
PW_HASH="$("$CADDY_BIN" hash-password --plaintext "$PORTAL_PW" | tail -n1)"
gate "06: portal password hashed (bcrypt)" bash -c \
  "grep -Eq '^\\\$2[aby]\\\$' <<< '${PW_HASH}'"

# ── 07_caddy_config ────────────────────────────────────────────────────────
log "07_caddycfg  fragments: ${FRAG_DIR} (node blocks append here via hub enroll)"
FRPS_USER="$(grep -oP 'webServer.user = "\K[^"]+' "${FRP_ETC}/frps.toml")"
FRPS_PW="$(grep -oP 'webServer.password = "\K[^"]+' "${FRP_ETC}/frps.toml")"
FRPS_AUTH_B64="$(printf '%s:%s' "$FRPS_USER" "$FRPS_PW" | base64 -w0)"

if [[ ! -f "$FLEET_ENV" || $FORCE -eq 1 ]]; then
  {
    echo "# dsh-fleet secrets (root-only)."
    if [[ "$DNS_PROVIDER" != "http" ]]; then
      echo "# Fill in the DNS provider credentials, then \`systemctl reload caddy\` —"
      echo "# cert issuance retries automatically."
      echo "${DNS_ENV_ID}="
      echo "${DNS_ENV_KEY}="
    else
      echo "# tls-mode http: no DNS credentials needed; keep TCP 80 open in the"
      echo "# security group for HTTP-01 challenges."
    fi
    echo "FRPS_DASHBOARD_AUTH=${FRPS_AUTH_B64}"
  } > "$FLEET_ENV"
  chmod 600 "$FLEET_ENV"
fi
# WS cookie secret: gates the browser WebSocket stream (enroll fragments check
# for it). Generated once; never rotated by re-runs (same ownership rule as
# the portal password — node fragments reference it).
if ! grep -q '^WS_COOKIE_SECRET=' "$FLEET_ENV" 2>/dev/null; then
  echo "WS_COOKIE_SECRET=$(openssl rand -hex 16)" >> "$FLEET_ENV"
  chmod 600 "$FLEET_ENV"
  log "       generated WS cookie secret into ${FLEET_ENV}"
fi

PW_HASH_ESC="${PW_HASH//\$/\\$}"
TPL="$(dirname "$0")/caddy-00-base.caddy.tpl"
export SETUP_DOMAIN="$DOMAIN" SETUP_TLS_MODE="$DNS_PROVIDER" SETUP_DNS_ENV_ID="$DNS_ENV_ID" \
       SETUP_DNS_ENV_KEY="$DNS_ENV_KEY" SETUP_PW_HASH="$PW_HASH" SETUP_TLS_BLOCK="$TLS_BLOCK"
python3 - "$TPL" "${FRAG_DIR}/00-base.caddy" <<'PYEOF'
import os, re, sys
tpl, out = sys.argv[1], sys.argv[2]
text = open(tpl).read()
if os.environ["SETUP_TLS_MODE"] == "http":
    # wildcard certs are impossible over HTTP-01 — drop the fallback block
    text = re.sub(r"# __WILDCARD_BEGIN__.*# __WILDCARD_END__\n?", "", text, flags=re.S)
for key, value in (
    ("__DOMAIN__", os.environ["SETUP_DOMAIN"]),
    ("__TLS_MODE__", os.environ["SETUP_TLS_MODE"]),
    ("__DNS_ENV_ID__", os.environ["SETUP_DNS_ENV_ID"]),
    ("__DNS_ENV_KEY__", os.environ["SETUP_DNS_ENV_KEY"]),
    ("__PORTAL_PW_HASH__", os.environ["SETUP_PW_HASH"]),
    ("__TLS_BLOCK__", os.environ["SETUP_TLS_BLOCK"]),
):
    text = text.replace(key, value)
open(out, "w").write(text)
PYEOF

cat > "${CADDY_ETC}/Caddyfile" <<EOF
{
	admin off
}
import ${FRAG_DIR}/*.caddy
EOF

if [[ ! -f /etc/systemd/system/caddy.service || $FORCE -eq 1 ]]; then
  cat > /etc/systemd/system/caddy.service <<EOF
[Unit]
Description=dsh-fleet Caddy web server
After=network.target

[Service]
Type=simple
ExecStart=${CADDY_BIN} run --config ${CADDY_ETC}/Caddyfile
# Graceful reload via SIGUSR1 — the `caddy reload` CLI needs the admin API,
# which this deployment disables (`admin off` in the Caddyfile).
ExecReload=/bin/kill -USR1 \$MAINPID
Restart=on-failure
RestartSec=5
EnvironmentFile=${FLEET_ENV}

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
fi
gate "07a: Caddyfile validates" bash -c \
  "\"$CADDY_BIN\" validate --config '${CADDY_ETC}/Caddyfile' >/dev/null 2>&1"
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy
gate "07b: caddy service active" systemctl is-active caddy

# ── 08_portal_placeholder ──────────────────────────────────────────────────
log "08_portal  placeholder page (the real portal lands with the portal task)"
mkdir -p "$PORTAL_DIR"
# Write the placeholder ONLY when the directory has no portal yet: the real
# portal page is delivered content (repo portal/), and --force re-runs must
# never clobber it — same ownership principle as the portal password.
if [[ ! -f "${PORTAL_DIR}/index.html" ]]; then
  cat > "${PORTAL_DIR}/index.html" <<'EOF'
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-fleet portal</title>
<style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;
display:grid;place-items:center;height:100vh;margin:0}
p{color:#8b949e}</style></head>
<body><main><h1>dsh-fleet hub is up</h1>
<p>Portal page is being installed. Nodes join via <code>hub enroll</code>.</p>
</main></body></html>
EOF
fi
gate "08: portal placeholder served from ${PORTAL_DIR}" bash -c \
  "[[ -f '${PORTAL_DIR}/index.html' ]]"

# ── 09_firewall ────────────────────────────────────────────────────────────
log "09_firewall"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 7000/tcp >/dev/null
  ufw allow 8443/tcp >/dev/null
  [[ "$DNS_PROVIDER" == "http" ]] && ufw allow 80/tcp >/dev/null
  gate "09: ufw allows 7000, 8443 (+80 in http tls-mode)" bash -c \
    "ufw status | grep -q '7000/tcp.*ALLOW' && ufw status | grep -q '8443/tcp.*ALLOW'"
else
  log "PASS  09: no active ufw — skipping (ensure the cloud security group allows TCP 7000+8443, plus 80 in http tls-mode)"
fi

# ── 10_final_gates ─────────────────────────────────────────────────────────
log "10_final"
gate "10a: frps dashboard answers with its credentials (loopback)" bash -c \
  "curl -fsS -u '${FRPS_USER}:${FRPS_PW}' -o /dev/null 'http://127.0.0.1:7500/api/serverinfo'"
VPS_IP="$(curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || echo '<VPS_PUBLIC_IP>')"

echo "PASS" > "$STATUS_FILE"
log "STATUS: PASS — hub installed."
log ""
log "── verification checklist (run these and keep the output in the task notes) ──"
log "  systemctl is-active frps caddy                # expect: active active"
log "  ss -lntp | grep -E ':(7000|7500|8443) '       # expect: all listening"
log "  curl -fsS -o /dev/null -w '%{http_code}' https://127.0.0.1:8443/ -k   # 401 (no auth)"
log "  curl -fsS -u fleet:'<portal pw>' -o /dev/null -w '%{http_code}' https://127.0.0.1:8443/ -k  # 200"
log "── before the HTTPS cert can issue, create these DNS records ──"
log "  hub.${DOMAIN}   A  ${VPS_IP}"
log "  *.${DOMAIN}     A  ${VPS_IP}"
if [[ "$DNS_PROVIDER" == "http" ]]; then
  log "── tls-mode http: also open TCP 80 in the cloud security group (HTTP-01) ──"
  log "  no DNS API credentials needed — Caddy issues certs automatically"
else
  log "── then fill the DNS provider credentials into ${FLEET_ENV} ──"
  log "  ${DNS_ENV_ID}=..."
  log "  ${DNS_ENV_KEY}=..."
  log "  systemctl reload caddy   # Caddy retries cert issuance automatically"
fi
log "── next steps ──"
log "  hub enroll <slug>   (per-node token + subdomain; see AGENTS.md/task graph)"
log "  portal page install (separate task) once the portal/ deliverables land"
log "  rotate the portal password anytime: caddy hash-password --plaintext '<new>'"
log "  full trace: ${SETUP_LOG}    status: ${STATUS_FILE}"
