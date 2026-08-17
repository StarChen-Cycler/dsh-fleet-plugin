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
- ~~特权方法硬锁回环~~（历史行为）：`host.pickDirectory`、`settings.*`、`credentials.*`、
  `agentPreset.*` 默认只认回环 Host。自 2026-08 起节点片段做了 Host 改写（见下节），
  **通过门户认证后远程可以读写设置与凭据**——这与会话平面同级，因为门户密码本来
  就守护着「指挥 agent 执行任意命令」的能力，风险天花板没有变化。
- 不要对不可信网络声明 `--trusted-host 0.0.0.0` 之类的宽泛条目；只声明你的节点
  authority（精确 `host:port`）。

## WebSocket 认证：Cookie 门闸（已闭环）

浏览器（Chrome/QuarkPC 等）的 WebSocket 握手**不携带** HTTP 认证凭据
（[WHATWG fetch #565](https://github.com/whatwg/fetch/issues/565)），但**会携带同源
Cookie**。节点片段因此这样工作：

1. 用户通过 basic_auth 的任一 REST 请求成功后，Caddy 在响应里
   `Set-Cookie: dshfleet_ws=<随机密钥>; Secure; HttpOnly; SameSite=Lax`。
2. WS 握手是同源请求，浏览器自动附上该 Cookie → Caddy 校验密钥 → 101 放行。
3. 无 Cookie 的升级请求 → 401。密钥存枢纽 `/etc/caddy/fleet.env`（root-only 600），
   轮换 = 改密钥 + `systemctl reload caddy`。

效果：未认证攻击者拿不到任何 WS 流；REST 写操作与特权面仍分别由 basic_auth 与
DSH 栅栏保护；手机端不受 IP 变化影响。

## 特权面解锁：Host 改写（已闭环）

DSH 的 `/api` 栅栏把特权方法（`settings.*`、`credentials.*`、`agentPreset.*` 等）
钉死在**回环 Host 头**上（`isTrustedApiRequest(request, [])` 空信任列表），即使
`--trusted-host` 也不放行——官方注释说这是「等一个真正的认证层」。我们的门户
**就是**认证层（basic_auth + Cookie 门闸 + TLS），所以节点片段在每个
`reverse_proxy` 里做三件事：

```caddy
reverse_proxy 127.0.0.1:${PORT} {
	header_up Host 127.0.0.1:3080   # 回环 authority；端口只是装饰，栅栏只看 hostname
	header_up -Origin               # 浏览器 Origin 是门户域名，与改写后 Host 不匹配会 403
	header_up -Sec-Fetch-Site       # 去掉 Fetch-Metadata，行为确定性
}
```

这与当年 ngrok 的 host-header rewrite 语义完全相同（ngrok 时期设置页远程可用，
正是因为它悄悄改写了 Host）。效果：门户登录一次后，设置/凭据/预设页面远程全部
可读可写，手机与任意浏览器零安装。

**边界**：这把「portal 密码持有者」的能力从会话平面提升到配置平面——但会话平面
本来就能驱动 agent 在主机上执行任意命令，所以实际风险天花板并未抬高。若哪天不想
暴露特权面，删掉这三行 `header_up` + reload 即可回退。

实测（2026-08，home-pc 节点）：带 basic_auth POST `/api/settings.describe` → 200；
伪造 Origin → 仍 200（已剥离）；无凭据 → 401；WS 无 Cookie → 401、带 Cookie → 101。
