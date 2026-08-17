# AGENTS.md — dsh-fleet-plugin 项目上下文

Agent（人或 AI）进入本项目先读 `MANIFEST.md`（目的 + 完成标准 + 不变式），再读本文件（执行规则），然后读 `.octie` 任务图（当前步骤状态）。

## 核心规则：Gated Success Pipeline（强制）

本项目整体按 **gated success pipeline** 方法论执行（源自 `gated-success-pipeline-concept.md`：定义精确的目标态 → 依赖链步骤 → 每步硬 gate → 证据留痕 → 第一步 FAIL 即停）。映射到本项目的具体形式：

1. **任务图即流水线**。`.octie` 里每个任务的 `success criteria` 是硬 gate——必须可执行验证、可量化、有证据；`blockers` 是前置 STATUS——上游未 approve（PASS）不得开工；BFS 解锁 = 前置 gate 通过。
2. **Fail loud, fail early, fail precisely**。验证失败必须指明：哪项检查、实测值、阈值。禁止"大概没问题"；禁止静默兜底（silent fallback 是反模式，见概念 §13）。
3. **Evidence over assumption**。结论只能来自执行真实路径：脚本真的跑、curl 真的打、CI 真的绿、面板真的 200。不看文档/命名/记忆来"确认"行为（403 栅栏的教训：文档说能用，实测 403）。
4. **一切留痕**。验证命令与输出写进任务 notes 或 `docs/acceptance-record.md`；脚本打印每步 `PASS`/`FAIL` 行并写日志。
5. **脚本内部同样 gated**。hub-setup 等脚本按编号步骤（01_…NN_）+ `gate` 检查组织：每步先验证前置产物存在/正确，再执行，再 gate 输出；任一步 FAIL 立即退出并指明原因。
6. **每步独立可重跑**。脚本幂等；任务修复后只重跑该任务，不重跑全链。
7. **先小后大**。先跑通最小端到端链路（1 台 hub + 1 台节点，全 gate 绿），再谈扩展（概念 §8 "one sample first"）。
8. **MANIFEST.md 不可变**。加功能、加文档、加任务都不改它；它只随"目的本身改变"修订。

## 关键决策（访谈定稿，见 docs/spec.md）

- 每节点独立 token 可吊销（frps `auth.tokenSource`，一行一 token）。
- DNS：默认打印待加记录；配置了 DNSPod（tencentcloud）/阿里云（alidns）API 密钥则自动建记录。
- DSH 403 栅栏：节点用 `dsh-fleet web` 包装启动（等价 `dsh --profile web --trusted-host <slug域名>`）。
- 门户认证：单密码 basic_auth（bcrypt）；无用户系统。
- 发布：npm + GitHub 双通道；CI 3-OS。
- 安全清单：见 docs/spec.md §6，逐项验证后才允许发布任务完成。

## 目录约定

见 MANIFEST.md「Map」。新增任务先更新 `.octie` 任务图（`octie create`，绝对 `project` 路径），原子校验拒绝多操作描述——一个任务只干一件事。

## 常用命令

```bash
# 任务图（项目路径恒为绝对路径）
octie list --project I:\ai-automation-projects\dsh-fleet-plugin
octie get <id> --project I:\ai-automation-projects\dsh-fleet-plugin

# 脚本语法检查（CI 同款）
bash -n hub/hub-setup.sh
node --check node/node-bootstrap.mjs

# 发布前安全清单核对：docs/spec.md §6 逐项打勾并记录证据
```
