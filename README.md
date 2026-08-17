# dsh-fleet-plugin

> 把你的 DeepSeek Harness 实例变成可远程指挥的舰队节点。

**dsh-fleet-plugin** 是 DeepSeek Harness 的 bundle 插件 + 配套枢纽脚本：任何装了本插件的设备
（Windows / Linux / macOS）接入一个 Web 门户后，你就能从手机浏览器打开一个域名，看到所有
在线实例及其资源状态，点击进入任一实例的 DSH 界面直接指挥 agent。

设计是 **canonical 且 generic** 的——两种角色用同一套脚本，没有特殊身份：

| 角色 | 你做什么 | 得到什么 |
|---|---|---|
| **枢纽主（hub）** | 在你有域名的 VPS 上跑 `hub-setup.sh` | 一个门户入口 + 节点签发/吊销能力；你的枢纽可以只服务你自己，也可以给朋友开节点名额 |
| **节点主（node）** | 在设备上装本插件 + 跑接入脚本 | 设备出现在枢纽门户上，可被远程指挥 |
| **自建者** | 就是枢纽主角色，用自己的域名再跑一遍 | 自己的门户 |

> ⚠️ 正在开发中。当前仓库为骨架 + 枢纽脚本；完整用法文档与插件随任务图推进合入。
> 技术调研背景见 `docs/dsh-fleet-portal.md`（本仓库镜像上游调研稿）。

## 安全边界（设计原则）

- 门户入口 = 部署级单密码（bcrypt），密码即最高权限——DSH Web UI 能执行任意命令。
- 节点零公网入站：隧道由节点主动外连枢纽。
- DSH 特权方法（设置/凭据/打开文件夹）永远只允许本机回环，远程只能会话操作。

## 目录

```
hub/     — 枢纽脚本（hub-setup.sh、enroll/revoke、frps/Caddy 模板）
node/    — 节点接入（bootstrap、三平台自启模板）
portal/  — 门户静态页
plugin/  — DSH bundle（Node half + client half）
docs/    — 文档与验收记录
```

## License

MIT
