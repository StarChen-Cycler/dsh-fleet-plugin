# dsh-fleet 枢纽 VPS 选型指南（腾讯云 vs 阿里云）

> 2026-08-17 核实 · 用途：为 dsh-fleet 枢纽（hub-setup.sh 的目标机器）选型。
> 活动价轮换快，**下单前以控制台实价为准**；本页给出入口、当前价格事实与取舍。

## 一句话结论

- **先测试（零成本）**：两平台任一**免费试用 1 个月**，跑完 T1 的「干净 Debian 12 实跑验证」。
- **长期枢纽**：阿里云 **ECS 经济型 e 99 元/年**（续费政策最持久 + 不限流量）。
- **国内拉 GitHub 慢**（frp 下载 / Caddy 编译都依赖 GitHub 与 Go proxy）：腾讯云**香港轻量 99 元/年**。
- **纯图便宜**：腾讯云/阿里云轻量 **38 元/年**（新用户活动价，续费回标价）。

## 腾讯云

| 方案 | 配置 | 价格 | 续费 | 带宽模型 | 备注 |
|---|---|---|---|---|---|
| 免费试用 | 2C2G~4C8G | 0 元 / 1 个月 | — | — | 新用户专享，够验 T1 |
| 轻量（新用户） | 2C2G | 38 元/年 起 | **续费回标价**（约 ¥576/年，同价只保一次） | 固定 4Mbps + 300GB/月 | 可预测，适合短期 |
| 轻量 99 元/年 | 2C2G | 99 元/年 | 同上，续费只保一次 | 固定 4Mbps | 国内长期需盯续费 |
| 香港轻量 | 2C2G | 99 元/年 | 同上 | 境外出口 | GitHub/Go proxy 顺畅 |

**入口**：

- [免费试用专区（官方）](https://cloud.tencent.com/act/free)
- [轻量应用服务器（官方产品页）](https://cloud.tencent.com/product/lighthouse)
- [2026 低价配置清单（第三方比价）](https://www.xymww.com/yu-suan-you-xian-zen-me-mai-yun-fu-wu-qi-2026-nian-teng-xun.html)

## 阿里云

| 方案 | 配置 | 价格 | 续费 | 带宽模型 | 备注 |
|---|---|---|---|---|---|
| 免费试用 | 2C2G | 0 元 / 1 个月 | — | — | 与腾讯试用二选一即可 |
| 轻量 | 2C2G | 38 元/年 | 续费回标价 | **200M 峰值突发**，月流量上限需在控制台确认 | 峰值≠固定，别与腾讯 4M 直接对比 |
| ECS 经济型 e | 2C2G | 99 元/年 | **买完可原价续费 1 年**，政策较持久 | 不限流量 | 长期枢纽首选 |

**入口**：

- [免费试用专区（官方）](https://free.aliyun.com)
- [轻量应用服务器（官方产品页）](https://www.aliyun.com/product/swas)
- [ECS（官方产品页）](https://www.aliyun.com/product/ecs)
- [38/99/199 元怎么选（避坑）](https://developer.aliyun.com/article/1712514)
- [省钱指南：ECS 99 + 轻量 38 + 免费申请](https://developer.aliyun.com/article/1745353)
- [轻量 38 与 ECS 99 的定位区别](https://developer.aliyun.com/article/1734866)

## 下单/开通必做三件事

1. **镜像选 Debian 12**（hub-setup.sh 的目标系统）。
2. **安全组放行**：TCP 22（SSH）、7000（frps）、8443（门户 HTTPS）；其余默认拒绝。
3. **记好到期时间**：试用到期前决定续费还是切换长期方案；续费同价类政策只保一年，续费前再核价。

## 与枢纽需求的对应

- 枢纽是**长期组件**（门户 + frps + Caddy 常驻），不是一次性测试机 → 长期预算按 99 元/年 规划（阿里 ECS 优先，续费稳定）。
- 带宽需求小（流式文本为主），固定 4Mbps（腾讯轻量）完全够用；阿里 200M 峰值是突发模型，注意月流量上限。
- hub-setup.sh 会从 GitHub Releases 下载 frp、用 Go 编译 Caddy——国内网络慢时先试 `GOPROXY=https://goproxy.cn,direct`（脚本已内置回退），仍不行就选香港节点。

## 来源

- 腾讯云 2026 低价清单：<https://www.xymww.com/yu-suan-you-xian-zen-me-mai-yun-fu-wu-qi-2026-nian-teng-xun.html>
- 阿里云 38/99/199 避坑：<https://developer.aliyun.com/article/1712514>
- 阿里云省钱指南（ECS 99 + 轻量 38 + 免费）：<https://developer.aliyun.com/article/1745353>
- 阿里云轻量 38 与 ECS 99 定位区别：<https://developer.aliyun.com/article/1734866>
