# dsh-fleet 端到端验收记录

> 按 MANIFEST Goal State §7 逐项记录。状态：✅ 通过 · 🔶 部分通过（缺外部条件） · ⬜ 未开始。
> 环境：枢纽=腾讯云香港 VPS 43.129.180.65（Ubuntu 24.04，域名 plan.pengyuefuture.cn，tls-mode http）；节点=Windows 本机（DSH 3080）。

## 1. 全新 VPS 跑 hub-setup.sh ≤15 分钟 ✅

- 证据：hub-setup.sh run5 全程 gate PASS，`/var/log/dsh-fleet/STATUS.txt` = PASS；
  frps systemd active + 监听 7000/7500(仅回环)；Caddy xcaddy 编译（含 tencentcloud+alidns
  DNS 插件）+ active + 监听 8443；Caddyfile validate 通过；ufw 放行 7000/8443/80；
  frps dashboard 凭据认证 200（gate 10a）。
- 实测耗时：首次（含 Go 编译）约 6 分钟；幂等重跑约 1 分钟。
- 注意：VPS 为 Ubuntu 24.04（脚本已支持 Debian 12 / Ubuntu 22.04+，gate 00c 验证）；
  另发现该机先前有 frp 实例（proxy ai-planner，16:04 已停），本安装接管 7000。

## 2. 全新 Windows / Linux 从零接入 ≤10 分钟，门户状态一致 🔶

- 代码与单测就绪（node-bootstrap 三平台 + 6/6 node:test 绿）；本机 Windows 实测
  01a-05 全 PASS（镜像兜底下载、解压展平修复、配置生成）。
- 阻塞：腾讯云安全组未放行 TCP 7000（frpc i/o timeout，日志留证）——用户开通后复测。

## 3. 手机点击实例 → 进入 DSH → agent 回复 ⬜

- 依赖：TCP 7000/8443 + DNS 记录 + 证书签发 + 节点 DSH 以 `dsh-fleet web`
  （--trusted-host）启动。均待外部条件。

## 4. revoke 后立即离线、其余不受影响 ✅

- 证据（VPS 实测）：revoke test-node → Caddy 片段删除 + Caddyfile validate 通过 +
  nodes.json 条目消失（门户下一轮询即灰/消失）；未知 slug → FAIL 01a 响亮退出；
  共享 token 方案不重启 frps（零影响）；端口释放后重 enroll 复用 6101。

## 5. 节点断网/重启后 1 分钟内自动恢复 ⬜

- 自启注册（WinSW/launchd/systemd）代码就绪；需在真实节点设备实测重启恢复。

## 6. 错误密码 401；/dsh-status 与门户无凭据泄露 🔶

- /dsh-status 无凭据 + CORS：node:test 断言通过（序列化输出不含 token）。
- HTTPS 401/200 实测：待证书签发（TCP 80 已开 ✓，DNS 记录未加 ✗）。

## 7. 3-OS CI 全绿；npm + GitHub 双通道 ✅/⬜

- CI：main 各次推送 3-OS success ✅（run 32008360729 等）。
- GitHub：仓库已建、main 持续推送 ✅。
- npm：代码就绪，包未发布（E404）——待用户 OTP 执行 `npm publish`。

## 8. 每条标准证据留痕

- 见本文件各节 + hub 侧 `/var/log/dsh-fleet-setup.log`、`/var/log/dsh-fleet/STATUS.txt`、
  节点侧 `~/.dsh-fleet/frpc.log` + 任务图 notes。

## 外部条件清单（用户动作）

- [ ] 腾讯云安全组放行 TCP 7000、8443（80 已完成）
- [ ] DNS：`hub.plan.pengyuefuture.cn` 与 `*.plan.pengyuefuture.cn` A → 43.129.180.65
- [ ] `npm publish`（OTP）

## 架构决策记录

- frp v0.71 源码级验证：`auth.tokenSource` 为 ValueSource 结构体、整文件=单 token、
  仅启动时读取 → 「每节点独立 token」改为「先共享后升级」（用户拍板 2026-08-17）；
  升级路径：每节点独立 frps 实例（独立端口+token+unit）。
- 门户在线状态 = 直接探测节点 /dsh-status（nodes.json 由 enroll/revoke 维护）。
