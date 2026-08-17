# TROUBLESHOOTING

## 节点隧道不上线

**现象**：门户卡片灰（离线）；插件状态行显示「frpc 运行中，尚未登录枢纽」或
「hub rejected this token」。

**排查顺序**（每步的实测输出留痕再进下一步）：

```bash
# 1. 配置完整性：hubUrl/token/slug 三缺一 = 未配置
curl -s http://127.0.0.1:3080/api/dsh-fleet/status

# 2. frpc 进程活着吗（插件托管模式下）
#    Windows: tasklist | findstr frpc   ·  macOS/Linux: pgrep -fl frpc

# 3. 从节点直连枢纽端口（排除防火墙）
#    Windows: Test-NetConnection <hub> -Port 7000
#    macOS/Linux: nc -vz <hub> 7000

# 4. 手动跑一次 frpc 看原始报错
~/.dsh-fleet/frpc-0.71.0/frpc -c ~/.dsh/fleet/frpc.toml
```

**常见原因**：

| 报错 | 原因 | 处理 |
|---|---|---|
| `login to server failed: token ...` | token 被吊销或抄错 | 枢纽 `sudo ./enroll.sh <slug>` 重新拿同一行信息 |
| `connection refused/timeout` | 安全组没放行 7000，或 hub 地址写错 | 枢纽安全组放行 TCP 7000 |
| 无报错但门户不显示 | frpc 端口与 enroll 分配不一致 | 设置页核对 port（6101-6199） |
| `frpc binary not found` | 没跑过 bootstrap | 按 README 步骤 5 执行 bootstrap |

## 门户打开节点 403 / 面板空白

**现象**：手机从门户点进节点，页面能开但会话列表/聊天 403。

**原因**：DSH 信任栅栏（详见 [trusted-host.md](trusted-host.md)）。

**处理**：节点必须用 `dsh-fleet web` 启动（而不是裸 `dsh --profile web`）。
裸启动时 Host 不是回环也不在 `--trusted-host` 白名单 → 全部 `/api` 403。

## 门户 404「no such fleet node」

**现象**：`https://<slug>.<域名>:8443/` 返回 no such fleet node。

**原因**：slug 未 enroll 或 Caddy 片段未生成。

**处理**：枢纽 `sudo ./enroll.sh <slug>` 幂等重跑（已 enroll 会复用凭据并重新
写片段）；确认 DNS 子域 `slug.<域名>` A 记录存在并已生效（`nslookup slug.<域名>`）。

## 证书迟迟不签发（浏览器告警）

**原因**：DNS-01 签发依赖两条：① 通配记录 `*.hub.example.com` 与 `hub.example.com`
都指向 VPS；② `/etc/caddy/fleet.env` 里有 DNS provider 凭据。

**处理**：

```bash
# 枢纽上核对
cat /etc/caddy/fleet.env        # TENCENT_SECRET_ID/KEY 或 ALIYUN_* 非空
nslookup hub.example.com        # 解析到 VPS IP
systemctl reload caddy          # Caddy 会自动重试签发
journalctl -u caddy -n 30       # 看 acme 报错
```

## GitHub 下载失败（frpc / WinSW / Caddy 构建）

**现象**：bootstrap 或 hub-setup 下载超时/重置。

**处理**：

- node-bootstrap 已内置镜像兜底（直连失败自动切 ghfast.top），无需干预；
- hub-setup 的 xcaddy 构建失败会自动用 `GOPROXY=https://goproxy.cn,direct` 重试；
- 仍失败：网络环境对 github.com 阻断较重时，枢纽选香港节点 VPS（见
  [vps-selection.md](vps-selection.md)），或手动把二进制放进缓存目录：
  - 节点：`~/.dsh-fleet/frp_0.71.0_<os>_<arch>.tar.gz|zip`
  - 枢纽：先 `apt install golang-go`，`GOPROXY=https://goproxy.cn,direct go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest`

## 密码轮换（门户）

```bash
# 枢纽上生成新 bcrypt 哈希
/usr/local/bin/caddy hash-password --plaintext '<新密码>'
# 替换 hub/fleet.d/00-base.caddy 与每个 10-<slug>.caddy 里的 fleet <hash>，
# 然后 systemctl reload caddy。节点不受影响（密码只挡在 Caddy 层）。
```
