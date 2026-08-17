# Security — hardening checklist and evidence

Every item below is an invariant from MANIFEST.md §Invariants or spec §6.
Status legend: ✅ 已实现并有证据 · 🔶 已实现，运行时证据待实测（VPS/节点）.

| # | 项 | 机制 | 证据 |
|---|---|---|---|
| 1 | 节点零公网入站 | frpc 主动外连枢纽（7000），节点不开任何入站端口 | 设计即如此；frpc.toml 无 server 段 🔶 |
| 2 | DSH 特权方法锁回环 | 不提供任何放宽手段；`--trusted-host` 只放行会话面 | DSH 官方栅栏语义（PRIVILEGED_METHODS 硬锁回环，实测于 octie 项目）✅ |
| 3 | 门户单密码 bcrypt | hub-setup 生成随机 24 位密码 + `caddy hash-password` bcrypt | hub-setup 06 步 gate 校验哈希前缀 `$2a$/$2b$`；明文只存 /etc/caddy/fleet.pw（600）✅ |
| 4 | frps 凭据浏览器不可见 | dashboard 只绑 127.0.0.1；Caddy /fleet/api/* 服务端注入 Authorization | caddy-00-base.caddy.tpl `header_up Authorization` + hub-setup gate 03c 🔶 |
| 5 | /dsh-status 无凭据 | 只返回 node/system 指标；token 不进 payload | 单测断言：序列化输出不含 token ✅ |
| 6 | 每节点独立 token 可吊销 | frps `auth.tokenSource` 一行一 token；enroll 追加、revoke 删行并 API reload | enroll.sh/revoke.sh 实现 + bash -n ✅（运行时隔离性 🔶） |
| 7 | 配置接口脱敏 | GET /api/dsh-fleet/config 返回 `****后4位`；POST 中红值不落盘 | 单测：脱敏值 POST 后原 token 保持不变 ✅ |
| 8 | 错误配置响亮失败 | bootstrap/插件/枢纽脚本全部 gated：无 token/坏 slug/坏端口 → 400/FAIL 并指明原因 | bootstrap 实测 FAIL 01a/06 精确报错 ✅；插件坏 slug 400 单测 ✅ |
| 9 | 控制链路加密 | frps `transport.tls.force` / frpc `transport.tls.enable` | 模板字段 + hub-setup gate 03b ✅ |
| 10 | 状态端点防滥用 | 无任何写操作；CORS 仅 `*`（内容无私密） | 单测断言响应头 ✅ |

## 已知边界（写出来，不假装不存在）

- **密码即最高权限**：basic_auth 后的门户 = 节点 DSH = 任意命令执行。无用户系统、
  无二次认证（本期非目标，扩展点留给 caddy-security OAuth）。
- **`--trusted-host` 的信任面**：声明了节点 authority 后，任何持有门户密码的人都可
  会话操作该节点——这是功能本身；特权方法不受影响。
- **Caddy 片段里的 bcrypt 哈希**：hash 本身可公开（bcrypt 盐化）；fleet.pw（明文）与
  fleet.env（DNS/仪表盘凭据）为 root-only 600，泄露即需全量轮换。
- **frpc token 在节点端落盘**（~/.dsh-fleet/frpc.toml 600、$DSH_HOME/dsh-fleet.json）：
  节点文件权限守住即可；吊销在枢纽侧生效（tokenSource 删行）。

## 运行时实测清单（VPS/节点就绪后逐项记录到 docs/acceptance-record.md）

- [ ] 错误密码 401、正确密码 200（curl 记录）
- [ ] 浏览器 DevTools：/fleet/api/* 请求头不含 frps 凭据
- [ ] revoke 后节点立即离线、其余节点零中断
- [ ] 插件托管 frpc 被杀后按退避重启（≤5s 首退避）
- [ ] 重启节点设备 1 分钟内自动恢复
