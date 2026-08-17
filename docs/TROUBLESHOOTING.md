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

## 远程访问时的控制台 403 与 WS 报错

**现象**（从门户打开节点 DSH 后浏览器控制台）：

- `POST /api/settings.describe 403`、`/api/credentials.describe 403`、部分插件配置
  （如 modlens/config）403——**这是设计内的特权锁**：设置/凭据/原生对话框只允许本机
  回环，远程会话面不受影响。设置页在远程打开会是空的，属预期。
- `WebSocket ... failed / connection lost, retry #N`——若出现在**节点 DSH 刚重启后**，
  是启动窗口期的瞬时抖动，客户端会自动重连；持续失败才需要排查（见下）。

**持续 WS 失败排查**：curl 分层验证（每层都该是 101）：

```bash
curl --http1.1 -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
  http://127.0.0.1:3080/api/events.mux                    # ① 节点本机 DSH
curl --http1.1 ... http://127.0.0.1:<port>/api/events.mux # ② 枢纽直打 frps remotePort
curl --http1.1 ... https://<slug>.<域名>:8443/api/events.mux  # ③ 经 Caddy 完整链路
```

注意必须 `--http1.1`：curl 默认对 https 走 h2，而升级只在 HTTP/1.1 上发生——走 h2
拿到 426 是测试假象，浏览器本身永远用 h1.1 做 WS 握手。

## 工作区历史偶尔加载失败

大会话（几十 MB 的历史）经枢纽隧道加载时慢于本机，客户端超时/重试会表现为偶发失败。
这不是配置错误；缓解：历史按需分页加载（DSH 自身行为），或需要整段历史时在本机打开。
隧道带宽由 VPS 决定（轻量 4Mbps 已够流式文本，大文件传输另计）。

## 密码轮换（门户）

```bash
# 枢纽上生成新 bcrypt 哈希
/usr/local/bin/caddy hash-password --plaintext '<新密码>'
# 替换 hub/fleet.d/00-base.caddy 与每个 10-<slug>.caddy 里的 fleet <hash>，
# 然后 systemctl reload caddy。节点不受影响（密码只挡在 Caddy 层）。
```

## 新节点 enroll 后：WS 无 Cookie 也 101 / settings.describe 403

**现象**（2026-08 在 a6000 上实测）：enroll 成功、页面能开，但 WS 无 Cookie 得到 101
（门闸形同虚设）、特权方法 403——说明该节点片段是**旧模板**写的。

**根因**：仓库的 `hub/enroll.sh` 更新了（cookie 门闸 f289f92、Host 改写 2aa091d），
但**枢纽上跑的副本没有同步**——enroll 用的是 `<hub 目录>/enroll.sh` 的本地副本，
模板漂移直接遗传给新片段。

**修复**：把仓库当前 `hub/enroll.sh`、`hub/hub-setup.sh` 重新 scp 到枢纽目录，
并按 `enroll.sh` 里的新模板重写该节点的 `10-<slug>.caddy`（或删片段重新 enroll），
`caddy validate` 后 reload。

**预防**：改了仓库 `hub/` 下的脚本，**同一个 commit 里必须包含枢纽同步动作**
（scp + 抽查标记位，如 `grep -c header_up <hub>/enroll.sh` 应 ≥ 2）。
