# 为什么节点要用 `dsh-fleet web` 而不是直接 `dsh --profile web`

## 症状

节点接入门户后，手机从 `https://<slug>.<域名>:8443/` 打开 DSH 界面，页面能加载，
但会话列表、聊天等 `/api` 请求全部返回 **403**（`transport failure ... HTTP 403`）。

## 根因：DSH 的浏览器信任栅栏

DSH `dsh-client-connection` 对每个 `/api` 请求做三层检查：

1. **Host 头必须可信**：回环（localhost/127.0.0.1/::1/127/8）或
   `dsh --profile web --trusted-host` 声明的 authority（`host` 或 `host:port`）。
2. `Sec-Fetch-Site` 不得为 `cross-site`。
3. `Origin`（如有）必须与 Host 同源。

经门户访问时 Host 是 `<slug>.<域名>:8443`——既不是回环也没被声明 → 403。
该栅栏同时防 DNS-rebinding 攻击，是有意设计；特权方法（设置/凭据/打开文件夹）
在任何情况下仍只接受回环，`--trusted-host` 也放不宽它们。

## 解决：启动时声明门户 authority

```bash
dsh --profile web --trusted-host home-pc.example.com:8443
```

`dsh-fleet web` 包装命令从 `$DSH_HOME/dsh-fleet.json`（或设置页配置）读出
hubUrl/slug，自动推导该 authority 并加上它；无配置时退化为普通 `dsh --profile web`
并给出提示。

## 安全含义（重要）

- 加了 `--trusted-host` 后，**所有能到达该子域的人**（即知道门户密码的人）都能
  会话操作这台 DSH——这是设计目标（远程指挥）。
- **特权方法不受影响**：`host.pickDirectory`、`settings.*`、`credentials.*`、
  `agentPreset.*` 硬锁回环，远程拿不到你的 API key、改不了设置、弹不了系统对话框。
- 不要对不可信网络声明 `--trusted-host 0.0.0.0` 之类的宽泛条目；只声明你的节点
  authority（精确 `host:port`）。
