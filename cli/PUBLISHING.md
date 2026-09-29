# 本地测试与发布指南

从零到"别人能 `npx yuna-team join`"的完整步骤。命令都在仓库根目录执行，除非另外说明。

## 一、本地测试

### 1. 直接跑源码（最快，改完即测）

```powershell
npm install          # 第一次，或在依赖变化后
npm run cli:build    # tsc 编译到 cli/dist
node cli/bin/yuna.mjs join
```

想连本地预览而不是线上站点：

```powershell
npm run dev          # 另开一个终端，站点跑在 http://127.0.0.1:8788
node cli/bin/yuna.mjs join --base http://127.0.0.1:8788
# 或者设一次环境变量，后面都不用带 --base
$env:YUNA_API_BASE = "http://127.0.0.1:8788"
node cli/bin/yuna.mjs projects
```

### 2. 模拟"装完之后"的样子（推荐，发布前必做）

`npm pack` 会打出真正要上传的那个压缩包，`npm i -g` 装它——和用户拿到的东西完全一致。

```powershell
cd cli
npm pack                              # 产出 yuna-team-0.1.0.tgz
npm i -g .\yuna-team-0.1.0.tgz        # 全局装，之后任何目录都能敲 yuna
yuna --version
yuna join
yuna posts -n 3
yuna read docker-compose-in-lab
yuna projects
yuna lesson -n 2
yuna open projects
```

验证完卸载：

```powershell
npm uninstall -g yuna-team
Remove-Item .\yuna-team-0.1.0.tgz     # 别把这个文件提交进仓库
```

### 3. `npm link`（改代码时更省事）

```powershell
cd cli
npm link            # 全局出现 yuna，指向当前目录
yuna join           # 注意：改完 TS 要重新 npm run cli:build
npm unlink -g yuna-team
```

### 本地测试要点

- 检查 `yuna --version`、`yuna`（无参数，应打印帮助并返回 1）、`yuna posts --nope`（应报中文错误并返回 1）。
- 建议在真终端里试，而不是只看重定向输出：颜色、折行、`fx-caret` 那些只在 TTY 下才生效。
- 试一下管道：`yuna posts | Select-Object -First 3`（Linux/macOS 是 `| head -3`），不应该报 EPIPE。
- Windows 上新开一个终端再敲 `yuna`，确认 PATH 生效。

## 二、发布到 npm

包名 `yuna-team`（`yuna` 与 `yuna-cli` 已被占用），命令名 `yuna`。不带 scope，所以**不需要建组织**。

1. 注册/登录 npm 账号，并在账号设置里开启 2FA：
   ```powershell
   npm login          # 或 npm login --auth-type=web
   npm whoami
   ```
2. 再确认一次名字没被抢：
   ```powershell
   npm view yuna-team     # 期望 404 Not Found
   ```
3. 去掉 `cli/package.json` 里的 `"private": true`（保留它的话 `npm publish` 会直接拒绝，这是故意的保险）。
4. 对齐版本号：`cli/package.json` 的 `version` 与 `cli/src/index.ts` 里的兜底 `VERSION`（正常情况下 `bin/yuna.mjs` 会读 package.json，兜底值只在编译成单文件二进制时用）。
5. 先干跑一遍，确认要上传的文件清单：
   ```powershell
   cd cli
   npm publish --dry-run
   ```
   期望 17 个文件：`bin/`、`dist/`、`package.json`、`README.md`、`LICENSE`；**不应包含** `src/`、`tsconfig.json`。
6. 正式发布：
   ```powershell
   npm run cli:build          # 确保 dist 是最新的（在仓库根执行）
   cd cli
   npm publish                # 未加 scope 的包默认 public
   ```
7. 立刻验证：
   ```powershell
   npm view yuna-team version
   npx -y yuna-team join
   ```
8. 以后发版：改版本号 → `npm publish`。推荐：
   ```powershell
   cd cli
   npm version patch          # 或 minor / major，会自动改 package.json
   ```
   注意：仓库根目录的 `yuna-team-blog` 是 `private`，**不要在根目录 publish**。

### 发布后记得同步官网

首页与加入页的胶囊复制的是 `npx -y yuna-team join`。包名如果以后变了，改这两处 `data-copy-command` 即可：

```text
public/index.html   public/join.html      （搜索 data-copy-command）
```

## 三、单文件二进制与其它包管理器

npm 只解决"装了 Node 的人"。其余渠道都要先有单文件二进制：

```powershell
bun build --compile --target=bun-windows-x64 --outfile dist/yuna-windows-x64.exe cli/bin/yuna.mjs
```

`--target` 可换 `bun-darwin-arm64` / `bun-linux-x64` 等，一次矩阵编译出六个平台，发布到 GitHub Release 并附 SHA256。

按成本从低到高：

| 渠道 | 用户怎么装 | 要做什么 |
| --- | --- | --- |
| GitHub Release | 下载即用 | 打 tag，CI 上传二进制与 SHA256 |
| Scoop（Windows） | `scoop bucket add yuna https://github.com/<org>/scoop-yuna` | 建 `scoop-yuna` 仓库，写 `bucket/yuna.json`（版本、URL、hash） |
| Homebrew（mac/Linux） | `brew install <org>/yuna/yuna` | 建 `homebrew-yuna` 仓库，写 `Formula/yuna.rb` |
| AUR（Arch） | `yay -S yuna-bin` | AUR 账号 + SSH key，写 `PKGBUILD`；每次发版改 `pkgver` 和校验和 |
| Docker / GHCR | `docker run ghcr.io/<org>/yuna join` | 一个几行的 Dockerfile + workflow |
| winget（Windows 官方） | `winget install yuna-team.yuna` | PR 到 microsoft/winget-pkgs：`exe` 稳定下载地址 + SHA256 + 清单，人工审核数天 |
| Chocolatey | `choco install yuna` | 社区审核，同样要安装包与校验和 |
| apt / rpm 官方源 | — | 没有官方入口，必须自建并托管签名仓库，成本最高，建议最后考虑 |

Homebrew 官方 core 需要项目有一定知名度（star/用户量），社团项目一般过不了，用自建 tap 就行。

### 自动发版（可选，等 npm 走顺了再加）

在 `.github/workflows/release.yml` 里做三件事即可：推 tag → `npm ci && npm run cli:build` → `npm publish`（用 `NPM_TOKEN` secret）+ 编译六平台二进制并挂到 Release。二进制挂上去之后，Homebrew/Scoop/winget 的清单才有东西可指。

## 四、发版检查清单

- [ ] `npm run typecheck`、`npm run cli:build` 通过
- [ ] `cd cli && npm pack` 后本地 `npm i -g` 实测六个命令
- [ ] `cli/package.json` 版本号与 `src/index.ts` 的兜底 `VERSION` 一致
- [ ] `"private": true` 已移除
- [ ] `npm publish --dry-run` 文件清单正确（无 `src/`、无 `tsconfig.json`）
- [ ] 发布后 `npx -y yuna-team --version` 能跑
- [ ] 官网胶囊的 `data-copy-command` 与实际包名一致
- [ ] 需要二进制渠道时，GitHub Release 已附六个平台产物与 SHA256

## 五、常见错误

| 现象 | 原因 |
| --- | --- |
| `npm publish` 报 `This package has been marked as private` | 忘了删 `cli/package.json` 的 `"private": true` |
| 报 `You do not have permission to publish "yuna"` | 包名被占，本项目用的是 `yuna-team` |
| `npm error E404 ... PUT ... yuna-team` | 还没 `npm login`，或 token 没有 publish 权限 |
| 装完敲 `yuna` 提示找不到命令 | npm 全局 bin 目录不在 PATH：`npm bin -g` 看路径 |
| `npx yuna-team` 跑的是旧的 | npx 有缓存，加 `-y` 或清 `~/.npm/_npx` |
| 页面复制出的命令是旧包名 | 忘了改 `public/index.html` 与 `public/join.html` 的 `data-copy-command` |
