#!/usr/bin/env python3
"""dsh-fleet hub DNS records — create/remove node A records.

Providers (auto-detected from /etc/caddy/fleet.env):
  tencentcloud  → DNSPod API (Tencent Cloud API v3, TC3-HMAC-SHA256)
  alidns        → Aliyun DNS API (RPC, HMAC-SHA1)

Usage:
  dns-record.py add <slug> <domain> [value]     # create <slug>.<domain> A record
  dns-record.py remove <slug> <domain>          # delete it

Credentials are read from /etc/caddy/fleet.env (root-only, written by
hub-setup.sh). Stdlib only — Debian 12 ships python3.
"""
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

FLEET_ENV = "/etc/caddy/fleet.env"


def load_env(path):
    env = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip()
    except OSError:
        pass
    return env


def fail(msg):
    sys.stderr.write(f"dns-record: FAIL {msg}\n")
    sys.exit(1)


# ── Tencent Cloud API v3 (DNSPod) ──────────────────────────────────────────
def tc3_sign(secret_id, secret_key, action, payload, host="dnspod.tencentcloudapi.com"):
    service = "dnspod"
    algorithm = "TC3-HMAC-SHA256"
    now = int(time.time())
    date = datetime.fromtimestamp(now, tz=timezone.utc).strftime("%Y-%m-%d")
    ct = "application/json; charset=utf-8"
    body = json.dumps(payload, separators=(",", ":"))

    def h(key, msg):
        return hmac.new(key.encode(), msg.encode(), hashlib.sha256).digest()

    canonical_request = "\n".join([
        "POST", "/", "",
        f"content-type:{ct}\nhost:{host}\n",
        "content-type;host",
        hashlib.sha256(body.encode()).hexdigest(),
    ])
    credential_scope = f"{date}/{service}/tc3_request"
    string_to_sign = "\n".join([
        algorithm, str(now), credential_scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])
    secret_date = h(f"TC3{secret_key}", date)
    secret_service = hmac.new(secret_date, service.encode(), hashlib.sha256).digest()
    secret_signing = hmac.new(secret_service, b"tc3_request", hashlib.sha256).digest()
    signature = hmac.new(secret_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = (
        f"{algorithm} Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders=content-type;host, Signature={signature}"
    )
    req = urllib.request.Request(
        f"https://{host}/",
        data=body.encode(),
        headers={"Content-Type": ct, "X-TC-Action": action, "Authorization": authorization},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def tc3_record(env, action, slug, domain, value=None):
    if action == "add":
        payload = {
            "Domain": domain,
            "SubDomain": slug,
            "RecordType": "A",
            "RecordLine": "默认",
            "Value": value,
        }
        return tc3_sign(env["TENCENT_SECRET_ID"], env["TENCENT_SECRET_KEY"], "CreateRecord", payload)
    listed = tc3_sign(
        env["TENCENT_SECRET_ID"], env["TENCENT_SECRET_KEY"], "DescribeRecordList",
        {"Domain": domain, "Subdomain": slug, "RecordType": "A", "Limit": 10},
    )
    records = listed.get("Response", {}).get("RecordList", [])
    if not records:
        return None  # nothing to remove — idempotent
    return tc3_sign(
        env["TENCENT_SECRET_ID"], env["TENCENT_SECRET_KEY"], "DeleteRecord",
        {"Domain": domain, "RecordId": records[0]["RecordId"]},
    )


# ── Aliyun DNS (RPC, HMAC-SHA1) ────────────────────────────────────────────
def aliyun_call(env, params):
    params = dict(params)
    params.update({
        "Format": "JSON",
        "Version": "2015-01-09",
        "AccessKeyId": env["ALIYUN_ACCESS_KEY_ID"],
        "SignatureMethod": "HMAC-SHA1",
        "SignatureVersion": "1.0",
        "SignatureNonce": os.urandom(8).hex(),
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    canonical = urllib.parse.urlencode(sorted(params.items()))
    string_to_sign = "GET&%2F&" + urllib.parse.quote(canonical, safe="")
    signature = hmac.new(
        (env["ALIYUN_ACCESS_KEY_SECRET"] + "&").encode(),
        string_to_sign.encode(),
        hashlib.sha1,
    ).digest()
    signature = urllib.parse.quote(base64.b64encode(signature).decode(), safe="")
    url = f"https://alidns.aliyuncs.com/?{canonical}&Signature={signature}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        return json.loads(resp.read().decode())


def aliyun_record(env, action, slug, domain, value=None):
    if action == "add":
        return aliyun_call(env, {
            "Action": "AddDomainRecord",
            "DomainName": domain,
            "RR": slug,
            "Type": "A",
            "Value": value,
        })
    listed = aliyun_call(env, {
        "Action": "DescribeDomainRecords",
        "DomainName": domain,
        "RRKeyWord": slug,
        "TypeKeyWord": "A",
    })
    records = listed.get("DomainRecords", {}).get("Record", [])
    if not records:
        return None
    return aliyun_call(env, {
        "Action": "DeleteDomainRecord",
        "RecordId": records[0]["RecordId"],
    })


def main():
    if len(sys.argv) < 4:
        fail(f"usage: dns-record.py add|remove <slug> <domain> [value] (got {sys.argv[1:]})")
    action, slug, domain = sys.argv[1], sys.argv[2], sys.argv[3]
    value = sys.argv[4] if len(sys.argv) > 4 else None
    if action not in ("add", "remove"):
        fail(f"action must be add|remove (got {action})")
    if action == "add" and not value:
        fail("add requires the record value (the VPS public IP)")

    env = load_env(FLEET_ENV)
    if env.get("TENCENT_SECRET_ID"):
        result = tc3_record(env, action, slug, domain, value)
    elif env.get("ALIYUN_ACCESS_KEY_ID"):
        result = aliyun_record(env, action, slug, domain, value)
    else:
        fail("no DNS provider credentials in /etc/caddy/fleet.env")

    if result is None:
        print(f"dns-record: {action} {slug}.{domain}: nothing to do")
        return
    err = (result.get("Response", {}) or {}).get("Error")
    if err:
        fail(f"{action} {slug}.{domain}: {err.get('Code')} {err.get('Message')}")
    print(f"dns-record: {action} {slug}.{domain}: OK")


if __name__ == "__main__":
    main()
