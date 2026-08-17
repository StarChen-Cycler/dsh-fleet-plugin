# dsh-fleet-plugin — 需求规格（访谈后定稿 v1.0）

> 2026-08-17 · 基于上游调研稿（dsh-fleet-portal，frp/Caddy/VPS 可行性层），经 interview 技能访谈后定稿。
> 本文件是需求来源；执行规则见 AGENTS.md（gated pipeline），不可变清单见 MANIFEST.md。

## 1. 执行摘要

**dsh-fleet-plugin**：一个可装进 DeepSeek Harness 的 bundle + 配套枢纽脚本，让任意设备（Windows/Linux/macOS）上的 DSH 实例接入一个 Web 门户——手机打开一个域名，看到所有在线实例及连接状态/资源信息，点击进入该实例的 DSH 界面直接指挥 agent。

设计 canonical 且 generic：枢纽脚本对任何用户是一等公民；任何人可自建枢纽（自己的 VPS + 域名），也可以接入他人共享的枢纽（对方分配子域与凭据）。"我搭一个中枢大家用"只是 generic 枢纽的一个实例。

独立 git 仓库 + npm 发布（双通道，参照 octie-cli 路径）。

## 2. 用户故事

1. 作为枢纽主，我在一台国内轻量 VPS 上运行一条脚本，得到 `https://hub.example.com:8443` 门户，设一个入口密码。
2. 作为节点主，我在任意 Windows/Linux/macOS 设备上装好 DSH 后：安装本 bundle → 从枢纽领取接入凭据 → 跑接入脚本 → 重启 DSH，设备出现在门户上。
3. 作为用户，我在手机浏览器打开门户域名 → 输入密码 → 看到实例列表（名称/系统/CPU/内存/磁盘/在线状态）→ 点击进入某实例的 DSH 界面，正常会话操作。
4. 作为枢纽主，我执行一条命令吊销某台设备的接入凭据，该设备立即失去隧道，其余设备不受影响。
5. 作为自建者，我用自己的域名和 VPS 再跑一遍枢纽脚本，得到自己的门户。

## 3. 已定决策（访谈结论）

| 议题 | 决策 |
|---|---|
| 仓库/包名 | `dsh-fleet-plugin`（git repo + npm 包同名） |
| 发布渠道 | npm + GitHub 双通道，CI 3 系统（ubuntu/windows/macos） |
| 枢纽形态 | 域名 + DNS-01 通配证书（Caddy + Let's Encrypt），高位端口 8443 |
| 门户认证 | 部署级单密码 basic_auth（bcrypt），无用户系统；安全加固见 §6 |
| DSH 403 栅栏 | 节点以**包装启动命令**运行：`dsh-fleet web`（等价 `dsh --profile web --trusted-host <slug域名>`）；文档写明原因；特权方法保持回环锁定 |
| 节点凭据 | **每节点独立 token 可吊销**（frps `auth.tokenSource` 文件，一行一 token） |
| DNS 自动化 | 两者都要：默认打印待加记录由枢纽主手动添加；配置了 DNSPod/阿里云 API 密钥则自动建通配与节点子域 |
| 角色 | 共享枢纽 + 各自自建都支持（同一套脚本，无单用户专用逻辑） |
| 支持平台 | Windows / Linux / macOS（frpc 官方三平台二进制） |
| 执行方法 | **Gated Success Pipeline**（见 AGENTS.md）——任务图即流水线，criteria 即 gate |
| 非目标 | 多用户体系、节点间互访、跨节点调度、官方认证层替代（预留扩展点） |

## 4. 架构

```
手机浏览器 ──HTTPS/basic_auth──▶ Caddy :8443（枢纽 VPS）
                                  ├─ 门户静态页（实例列表 + 状态轮询 + 点击进入）
                                  ├─ 反代 <slug>.hub.example.com → 127.0.0.1:<节点端口>
                                  └─ 反代 frps dashboard（仅回环 + 服务端注入凭据）
                                        │
frps :7000（tokenSource 每节点凭据 + 控制链路 TLS）◀──frpc 出站（节点主动外连，零入站）
                                        │
节点（Win/Linux/macOS）：dsh-fleet-plugin（frpc 托管 + /dsh-status 指标端点 + 设置卡片）
                        + dsh-fleet web 包装启动（--trusted-host）
```

## 5. 交付物清单

1. **`hub-setup.sh`**：VPS 上一条命令装 frps（tokenSource + TLS）+ systemd + Caddy（DNS-01 通配证书 + basic_auth + 门户页 + dashboard 反代）。gated：每步 PASS/FAIL。
2. **门户页**：静态 HTML/JS，实例卡片（名称/slug/OS/CPU/内存/磁盘/在线）+ 点击进入节点 DSH；状态经 `/dsh-status` 轮询。
3. **`hub enroll/revoke`**：签发/吊销每节点 token；分配 slug；生成（或打印）DNS 子域记录。
4. **`node-bootstrap`（三平台）**：下载 frpc → 生成配置（token/slug/端口）→ 注册开机自启（WinSW / launchd plist / systemd --user）→ 立即启动。
5. **dsh-fleet bundle Node half**：settings 命名空间 `dsh-fleet`（hubUrl/token/slug/enabled 等）；frpc spawn 托管与退避重启；`/dsh-status` 指标端点（不泄露凭据）。
6. **bundle client half**：设置页卡片（配置 + frpc/隧道状态 + 启停开关）；「打开门户」入口。
7. **文档**：README（双角色快速上手）、新设备/新 DSH 实例接入步骤、`dsh-fleet web` 包装命令说明、TROUBLESHOOTING。
8. **测试与 CI**：Node half 单测 + 3-OS CI；安全加固清单（§6）逐项验证。

## 6. 安全加固（明确要求）

- 全站 basic_auth（bcrypt，建议 ≥20 位随机密码；文档给轮换命令）。
- 浏览器↔Caddy 全程 HTTPS（TLS 1.2+，DNS-01 通配证书）。
- frpc↔frps 控制链路 `transport.tls`；每节点独立 token，可单独吊销。
- frps dashboard 只绑 127.0.0.1；浏览器永不接触 frps 凭据（Caddy 服务端注入）。
- 节点零公网入站；DSH 特权方法（settings/credentials/agentPreset/打开文件夹）保持回环锁定——远程只能会话操作，碰不到密钥与桌面。
- `/dsh-status` 只返回非敏感指标；门户页无凭据与会话数据。
- 明示风险：DSH Web UI = 任意命令执行，入口密码即最高权限；文档显著位置警示。

## 7. 验收标准（= MANIFEST Goal State）

- [ ] 全新 VPS 跑 `hub-setup.sh` ≤15 分钟得到可登录门户（手机无安装）。
- [ ] 一台全新 Windows、一台全新 Linux 从零接入 ≤10 分钟，出现在门户且状态与任务管理器一致（±5%）。
- [ ] 手机点击实例卡片 → 进入该实例 DSH → 发消息 agent 正常回复（`--trusted-host` 路径）。
- [ ] `revoke <slug>` 后该设备立即离线，其余节点不受影响。
- [ ] 节点断网/重启后 1 分钟内自动恢复。
- [ ] 错误密码 401；`/dsh-status` 与门户页不泄露任何凭据/会话数据。
- [ ] 3-OS CI 全绿；npm 与 GitHub 双通道可安装。
