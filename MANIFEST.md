# MANIFEST — dsh-fleet-plugin（不可变根清单）

> 本文件定义项目的**目的**与**完成标准**，是任何 agent/人类了解本项目的入口。
> **它不随功能增改**：新增特性写入文档与任务，绝不写进这里。只有当目的本身改变时才会修订——那是一个罕见的、显式的事件。

## Purpose

把 DeepSeek Harness 变成可远程指挥的舰队：任何用户都能在**自己的 VPS + 自己的域名**上跑同一套脚本，得到自己的门户；任何设备（Windows / Linux / macOS）装本 bundle 后经每节点独立凭据接入门户，手机浏览器打开一个域名即可查看全部在线实例及资源状态并进入任一实例指挥 agent。

设计必须是 **canonical 且 generic**：枢纽脚本对任何人是一等公民；"我搭一个给大家用的中枢"只是 generic 枢纽的一个实例，代码中不存在任何单用户专用逻辑。

## Goal State（完成标准——逐条可验证）

1. 全新 VPS 跑 `hub-setup.sh` ≤15 分钟得到可登录门户（手机零安装）。
2. 全新 Windows 与全新 Linux 各一台，从零接入 ≤10 分钟，出现在门户且状态与任务管理器一致（±5%）。
3. 手机点击实例卡片 → 进入该实例 DSH → 发消息 agent 正常回复（`--trusted-host` 包装启动路径）。
4. `revoke <slug>` 后该设备立即离线，其余节点不受影响。
5. 节点断网/重启后 1 分钟内自动恢复。
6. 错误密码 401；`/dsh-status` 与门户页不泄露任何凭据/会话数据。
7. 3-OS CI 全绿；npm 与 GitHub 双通道可安装。
8. 每条标准的证据留痕在验收记录（docs/acceptance-record.md），不是口述。

## Invariants（永不可违反）

1. 节点零公网入站——隧道只能由节点主动外连枢纽。
2. DSH 特权方法（设置/凭据/打开文件夹）永远只允许本机回环；远程只能会话操作。
3. 门户入口 = 部署级单密码（bcrypt）；密码即最高权限。
4. frps 凭据（dashboard、节点 token）只存在于枢纽侧文件，浏览器永远不可见。
5. `/dsh-status` 只返回非敏感指标。
6. 每节点独立 token，可单独吊销。
7. **Gated pipeline 规则**：任何一步不得在未验证上游输出的情况下执行；验证失败必须响亮、精确、留痕；禁止静默兜底（详见 AGENTS.md）。
8. 支持 Windows / Linux / macOS 三平台，代码不引入单平台假设。

## Map（到哪里找什么）

```
hub/     — 枢纽脚本与模板（hub-setup.sh、enroll/revoke、frps/Caddy 模板）
node/    — 节点接入（bootstrap、三平台自启模板）
portal/  — 门户静态页
plugin/  — DSH bundle（Node half + client half）
docs/    — 规格、文档、验收记录（spec.md / acceptance-record.md / TROUBLESHOOTING.md）
.octie/  — 任务图（本地，不入库）：流水线的步骤注册表；每个任务的 criteria 即 gate，blockers 即前置 STATUS
AGENTS.md — 项目上下文与执行规则
```

## 证据在哪里

每个完成标准的实测证据存放在 `docs/acceptance-record.md` 与各任务 notes/日志中；本文件只声明"完成意味着什么"，不存放证据。
