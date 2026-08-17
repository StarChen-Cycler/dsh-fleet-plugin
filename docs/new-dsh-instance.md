# 新设备 / 新服务器从零接入 dsh-fleet（三平台）

目标：一台全新机器 → 装 Node + DSH + 本插件 → 接入枢纽 → 出现在门户。
已装好 DSH 的设备只需 [步骤 4-6](#4-安装-bundle-插件)。

## 1. 安装 Node.js ≥ 22

- **Windows**：[nodejs.org](https://nodejs.org) 下载 LTS 安装包（或 `winget install OpenJS.NodeJS.LTS`）。
- **macOS**：`brew install node@22`。
- **Linux**：`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`。

验证：`node --version` 输出 ≥ v22。

## 2. 安装 DSH（DeepSeek Harness）

按你已有的 DSH 安装方式（npm 全局 / pnpm）。安装后验证：

```bash
dsh --profile web    # 首次跑通，Ctrl+C 停掉（后面用 dsh-fleet web 启动）
```

## 3. 获取接入信息

找枢纽主要一行接入信息（或自己在枢纽上 `sudo ./enroll.sh <你的设备名>`）：

```
HUB=hub.example.com:7000 TOKEN=<32位hex> SLUG=home-pc PORT=6101 URL=https://home-pc.example.com:8443
```

## 4. 安装 bundle 插件

```bash
dsh plugin --profile web add dsh-fleet-plugin
```

## 5. 下载 frpc 并配置隧道

```bash
git clone https://github.com/StarChen-Cycler/dsh-fleet-plugin.git   # 或从 npm 包取脚本
node dsh-fleet-plugin/node/node-bootstrap.mjs "HUB=... TOKEN=... SLUG=... PORT=... URL=..."
```

脚本会：选平台 frpc 构建（GitHub 直连失败自动走 ghfast.top 镜像）→ 解压到
`~/.dsh-fleet/` → 生成 `frpc.toml` → 启动并等「login to server success」。
（PowerShell 解压依赖 Expand-Archive；Linux/macOS 用系统 tar。）

step 06b 还会把**应用内目录选择器**钉进 web 配置的补丁层——远程点「选择工作区」
时打开的是网页内的目录树，而不是弹在宿主机屏幕上的系统对话框（原理与旧节点的
手动写法见 [trusted-host.md](trusted-host.md)「远程选择工作区」节）。已在跑 DSH
的节点重启后生效。

## 6. 启动 DSH（带 trusted-host）

```bash
npx dsh-fleet web    # 或安装全局后直接 dsh-fleet web
```

等价于 `dsh --profile web --trusted-host home-pc.example.com:8443`——没有它，
门户反代过来的请求会被 DSH 信任栅栏 403（原理见 [trusted-host.md](trusted-host.md)）。

## 7. 验证

1. 手机打开 `https://hub.example.com:8443/` → 输门户密码 → 卡片出现「home-pc」且
   CPU/内存/磁盘有数值。
2. 点卡片进入本机 DSH，发一条消息，agent 正常回复。
3. （可选）`node node-bootstrap.mjs --install-service` 注册开机自启——重启后 1 分钟内
   自动恢复。注意与设置页「由插件管理 frpc」二选一。

## 平台备注

| 平台 | 自启 | 注意事项 |
|---|---|---|
| Windows | WinSW（需管理员 PowerShell 跑 --install-service） | frpc 为 .zip（Expand-Archive 解压） |
| macOS | launchd plist（~/Library/LaunchAgents） | — |
| Linux | systemd --user + `loginctl enable-linger`（脚本已做） | 需 systemd 用户会话 |
