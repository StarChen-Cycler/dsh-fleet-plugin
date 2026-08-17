# dsh-fleet-plugin

> 把你的 DeepSeek Harness 变成可远程指挥的舰队节点。

**dsh-fleet-plugin** 是 DeepSeek Harness 的 bundle 插件 + 配套枢纽脚本：任意设备
（Windows / Linux / macOS）装本插件并接入一个 Web 门户后，手机浏览器打开一个域名即可
看到所有在线实例及资源状态，点击进入任一实例的 DSH 界面直接指挥 agent。

设计 **canonical 且 generic**：两种角色用同一套脚本，无单用户专用逻辑。

| 角色 | 你做什么 | 得到什么 |
|---|---|---|
| **枢纽主** | 在你的 VPS（Debian 12 + 域名）上跑 `hub-setup.sh` | 一个门户入口 + 节点签发/吊销；可以只服务自己，也可以给别人开节点名额 |
| **节点主** | 在设备上装 DSH + 本插件，跑接入脚本 | 设备出现在枢纽门户，可被远程指挥 |
| **自建者** | 就是枢纽主角色，用自己的域名再跑一遍 | 自己的门户 |

> ⚠️ **安全边界**：DSH Web UI 能执行任意命令——门户密码即最高权限。节点零公网入站、
> DSH 特权方法（设置/凭据/打开文件夹）永远只允许本机回环，远程只能会话操作。
> 完整设计见 [MANIFEST.md](MANIFEST.md) 与 [docs/spec.md](docs/spec.md)。

## 枢纽主：15 分钟搭门户

前置：国内轻量 VPS（≥2C2G，Debian 12，安全组放行 TCP 22/7000/8443）+ 一个域名
（通配 `*.hub.example.com` 解析到 VPS）。选型参考 [docs/vps-selection.md](docs/vps-selection.md)。

```bash
# 在 VPS 上（root）
git clone https://github.com/StarChen-Cycler/dsh-fleet-plugin.git
cd dsh-fleet-plugin/hub
sudo ./hub-setup.sh --domain example.com --dns tencentcloud --email you@example.com
#   --dns: tencentcloud(DNSPod) | alidns；证书走 DNS-01，无需备案、无需 80 端口

# 脚本会打印：门户密码、DNS 通配记录、验证清单（curl 401/200、端口监听）。
# 把 DNS provider 凭据填进 /etc/caddy/fleet.env 后 systemctl reload caddy，证书自动签发。

# 给一台设备开节点名额（输出一行接入信息，发给节点主）
sudo ./enroll.sh home-pc

# 吊销某台设备（立即踢下线，其余不受影响）
sudo ./revoke.sh home-pc
```

门户地址：`https://hub.example.com:8443/`（`hub.` 前缀 + 你的域名 + 8443）。

## 节点主：10 分钟接入

前置：设备已装 Node.js ≥ 22 与 DSH（新设备从零搭建见
[docs/new-dsh-instance.md](docs/new-dsh-instance.md)）。

```bash
# ① 安装 bundle 插件
dsh plugin --profile web add dsh-fleet-plugin

# ② 接入枢纽（用枢纽主发来的那行信息）
node node-bootstrap.mjs "HUB=hub.example.com:7000 TOKEN=... SLUG=home-pc PORT=6101 URL=https://home-pc.example.com:8443"
#    也可拆开传：--hub hub.example.com:7000 --token ... --slug home-pc --port 6101

# ③ 重启 DSH，用包装命令启动（自动带 --trusted-host，见 docs/trusted-host.md）
dsh-fleet web
```

之后在 DSH **设置 → Fleet 远程接入** 里可以改配置、开关隧道、看状态；或在终端：
`node node-bootstrap.mjs --install-service` 注册开机自启（WinSW/launchd/systemd）。
两者二选一：设置页「由插件管理 frpc」开=插件托管（随 DSH 启停）；关=用自启服务（DSH 不跑隧道也在）。

## 为什么需要 dsh-fleet web（而不是直接 dsh --profile web）

DSH 的 `/api` 信任栅栏只接受回环或 `--trusted-host` 声明的 authority——门户经
`https://<slug>.<域名>:8443` 反代访问节点，不带该参数会全部 403。`dsh-fleet web`
从配置自动推导并加上它；特权方法仍锁回环。详见 [docs/trusted-host.md](docs/trusted-host.md)。

## 目录

```
hub/     — 枢纽脚本（hub-setup.sh、enroll/revoke、DNS 记录、frps/Caddy 模板）
node/    — 节点接入（bootstrap、三平台自启模板、dsh-fleet web 包装）
portal/  — 门户静态页（实例卡片 + 状态轮询 + 点击进入）
plugin/  — DSH bundle Node half（配置路由 + /dsh-status + frpc 托管）
client.js — DSH 设置卡片（Fleet 远程接入）
docs/    — 规格、VPS 选型、新实例搭建、trusted-host、排障、验收记录
tests/   — 零依赖 node:test 单测
```

## 排障

[文档](docs/TROUBLESHOOTING.md) · 常见：隧道不上线（token/端口/镜像）、门户 404、
证书迟迟不签发、GitHub 下载失败。

## License

MIT
