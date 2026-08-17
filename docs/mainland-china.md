# 国内节点部署指南（Mainland China Hub）

> 前提：hub-setup.sh 同时支持两种 TLS 模式——`http`（HTTP-01，适合香港/境外）与
> `tencentcloud`/`alidns`（DNS-01，适合国内）。本页说明国内的额外配置与合规注意。
> 选型与价格见 [vps-selection.md](vps-selection.md)。

## 为什么国内要 DNS-01

- 未备案域名对外提供 Web 服务，80/443 端口会被运营商拦截；DNS-01 只在 8443 提供
  HTTPS，不依赖 80。
- DNS-01 能签发**通配证书**（`*.你的域名`），节点子域 `slug.域名` 自动被同一张证书
  覆盖，enroll 时无需再签发。
- 所以国内部署**不需要**开放 TCP 80，安全组只需 22 / 7000 / 8443。

## 与香港部署的差异（一张表）

| 项 | 香港（`--dns http`） | 国内（`--dns tencentcloud` 或 `alidns`） |
|---|---|---|
| TLS 签发 | HTTP-01，需开放 TCP 80 | DNS-01，无需 80 |
| 通配证书 | ❌ 不支持（已自动去掉通配兜底块） | ✅ 支持 |
| DNS API 密钥 | 不需要 | **需要**：DNSPod（TENCENT_SECRET_ID/KEY）或阿里云（ALIYUN_ACCESS_KEY_ID/SECRET） |
| 安全组 | 22/7000/8443/80 | 22/7000/8443 |
| GitHub 访问 | 直连通常可用 | 已内置镜像兜底（frp→ghfast.top，Caddy 编译→goproxy.cn，节点 frpc→ghfast.top），无需干预 |
| 合规 | 无备案约束 | 高位端口对外 Web 属政策灰区；正式商用建议 ICP 备案（2-4 周）后换 443 |

## 国内部署步骤（在标准流程上多两步）

```bash
# ① 买一台国内轻量（Debian 12 / Ubuntu 22.04+），安全组放行 22/7000/8443
# ② 域名通配 DNS 指向 VPS：
#    hub.你的域名   A  <VPS-IP>
#    *.你的域名     A  <VPS-IP>

# ③ 跑枢纽脚本——与香港的唯一区别是 --dns 参数：
sudo ./hub-setup.sh --domain 你的域名 --dns tencentcloud --email you@example.com
#   阿里云域名用 --dns alidns

# ④ 多出的两步：把 DNS API 密钥写进 /etc/caddy/fleet.env（root-only 600）：
#    TENCENT_SECRET_ID=...
#    TENCENT_SECRET_KEY=...
#    （阿里云：ALIYUN_ACCESS_KEY_ID=... / ALIYUN_ACCESS_KEY_SECRET=...）
sudo systemctl reload caddy     # Caddy 自动完成 DNS-01 通配证书签发

# ⑤ 之后的 enroll / 节点接入与香港完全一致；enroll 的 DNS 子域记录也会自动创建
#    （凭证已配好时），不再打印手动记录。
```

## 为什么凭证放在 fleet.env

- DNS 凭证只被 Caddy 进程读取（systemd `EnvironmentFile`），600 权限；
- 节点侧、门户页、frps 都接触不到它们；
- 轮换：改文件 → `systemctl reload caddy`。

## 故障排查

- 证书迟迟不发：`journalctl -u caddy -n 30` 看 acme 报错——多数是通配记录未生效
  或密钥权限/账号问题（见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)）。
- 节点下载慢：bootstrap 已自动切 ghfast.top；仍失败见 TROUBLESHOOTING「GitHub 下载失败」。
