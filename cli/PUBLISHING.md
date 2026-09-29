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
- 如果本机需要代理，试一次 `yuna posts --proxy http://127.0.0.1:7890`：应当能取到数据，且全局 node_modules 里会装上 `undici` 这一个依赖。
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

## 三、用 tag 一键发版（CI 已配好）

仓库里已经配好两条流水线，正常发版不用手动敲 `npm publish`：

| 文件 | 触发 | 做什么 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | 推分支 / PR / 手动 | 站点类型检查、样式与脚本自检；CLI 类型检查、编译、冒烟、打包内容校验 |
| `.github/workflows/cli.yml` | 推 `cli-v*` tag / 手动 | 检查 → 发布到 npm → 编译六平台单文件二进制 → 建 GitHub Release |

发一个新版本：

```powershell
# 1) 改版本号（两处，CI 会校验是否一致）
#    cli/package.json 的 "version"
#    cli/src/index.ts 的兜底 VERSION
#    也可以：cd cli; npm version patch --no-git-tag-version

# 2) 本地先自检（检查版本一致、private 已移除）
npm run cli:release:check -- cli-v0.1.1

# 3) 提交并推 tag
git add -A
git commit -m "cli: v0.1.1"
git tag cli-v0.1.1
git push origin master --tags
```

推完在仓库 Actions 页面能看到「CLI 发版」跑起来：npm 上出现新版本，Releases 里出现六个平台的压缩包与 `SHA256SUMS.txt`。

手动触发（Actions → CLI 发版 → Run workflow）只跑检查与二进制编译，**不会**发布、**不会**建 Release，方便先确认产物能编出来。

二进制体积（本地实测，bun 1.4.2）：windows-x64 82.2MB、linux-x64 77.6MB、darwin-arm64 59.4MB；zip 后约 39MB，流水线已压缩后再上传。

## Token 去哪里拿

### NPM_TOKEN（必须，CI 发布用）

1. 打开 https://www.npmjs.com 登录，点右上角头像 → **Access Tokens** → **Generate New Token**。
2. 二选一：
   - **Granular Access Token（推荐）**
     - Name：`yuna-team-ci`
     - Expiration：90 天或自定义（到期前记得换）
     - **Packages and scopes** → Permissions 选 **Read and write**；Packages 选 **All packages**（首次发布时还没有这个包，只能选 All）
     - 必须勾选 **Bypass two-factor authentication (2FA)**，否则 CI 发布会因为要 OTP 而失败
   - **Classic Token** → 类型选 **Automation**（专给 CI，天然跳过 2FA；代价是权限覆盖你账号下的所有包）
3. 点生成后 **token 只显示这一次**，立刻复制。
4. 回到 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**：
   - Name：`NPM_TOKEN`
   - Secret：粘贴刚才那串（`npm_` 开头）
5. 以后换 token 只更新这个同名 secret，不用动 workflow。

### GITHUB_TOKEN（不用手动创建）

Actions 内置，`permissions: contents: write` 就能建 Release、上传资产——`cli.yml` 里已经这么写了。它只对**当前仓库**有效。

### PAT（以后要自动更新 Homebrew tap / Scoop bucket 才需要）

那种场景要往**别的仓库**写文件，内置 token 不够：

1. GitHub → 右上头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
2. Repository access → Only select repositories → 选中目标仓库（例如 `homebrew-yuna`、`scoop-yuna`）。
3. Permissions → **Contents: Read and write**。
4. 生成后存成仓库 secret，例如 `TAP_TOKEN`。

### 别搞混的两个 token

- 站点已有的 **`GITHUB_BACKUP_TOKEN`** 是 Cloudflare Pages 项目的环境变量，给后台同步 Markdown 快照用，跟发版无关，也不是 Actions secret。
- 本指南要的 `NPM_TOKEN` 是 **npm** 的 token（`npm_` 开头），不是 GitHub 的。

### 切换到 Trusted Publisher（以后不再用 token）

npm 的方向是 **OIDC 免 token 发布**：`npm publish` 用 GitHub Actions 的一次性身份令牌换 npm 的临时凭证，不需要长期 token，而且**自带 provenance**（可验证"这个版本确实由该仓库的该 workflow 构建"）。npm 计划 2027 年 1 月取消 bypass-2FA token 直发（[npm roadmap](https://github.com/orgs/community/discussions/208130)），所以这是官方推荐路径。

前置条件（workflow 里都已满足）：

- publish job 声明了 `permissions: id-token: write`
- Node ≥ 22.14（workflow 用 22）
- npm CLI ≥ 11.5.1（workflow 里有 `npm install -g npm@latest`）
- 该包已经成功发布过一次（0.1.0 已发布 ✓）

**第一步：在 npm 上配置**

1. 打开 https://www.npmjs.com/package/yuna-team → 右侧 **Settings** → 找到 **Trusted Publisher** → **Select publisher** → 选 **GitHub Actions**
2. 填四项，必须与 workflow 完全对应：

   | 字段 | 填什么 |
   | --- | --- |
   | Organization or user | `liugu2023` |
   | Repository | `yuna.team-new` |
   | Workflow filename | `cli.yml` ← **只填文件名**，不是 `.github/workflows/cli.yml` |
   | Environment | 留空（workflow 里没有用 environment） |

3. **Allowed actions** 选 `npm publish`，保存

**第二步：删掉 token**

GitHub 仓库 → Settings → Secrets and variables → Actions → 删除 `NPM_TOKEN`。

workflow 已经写成双模式：**有 `NPM_TOKEN` 就用 token，没有就自动走 OIDC**。所以删掉 secret 后不需要改任何代码，下次发版日志里会出现「没有 NPM_TOKEN，按 trusted publishing（OIDC）发布」。

**第三步：验证**

发一个 patch 版本（例如 0.1.1），在 Actions 日志里确认三件事：

- 出现「没有 NPM_TOKEN，按 trusted publishing（OIDC）发布」
- 出现「已从 .npmrc 移除 _authToken 行」
- npm 包页面右侧出现 **Provenance** 标记

**如果 OIDC 失败**（日志报 `ENEEDAUTH` / `Unable to authenticate`）：

- workflow filename 是否**只填了文件名** `cli.yml`；仓库名大小写要一致
- 确认没有残留的 `NODE_AUTH_TOKEN`（双模式下 OIDC 分支不设它；手动加过的话删掉）
- 确认 npm CLI 已升级（日志里 `npm --version` 应 ≥ 11.5.1）
- trusted publisher 配好之前不要删 secret，否则两次发版都会失败

**想退回 token 方式**：把 `NPM_TOKEN` secret 加回来即可，workflow 会自动走 token 分支，无需改代码。

## 四、单文件二进制与其它包管理器

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

## 五、发版检查清单

- [ ] `npm run typecheck`、`npm run cli:build` 通过（CI 也会跑，见 `ci.yml`）
- [ ] `cd cli && npm pack` 后本地 `npm i -g` 实测六个命令
- [ ] `cli/package.json` 版本号与 `src/index.ts` 的兜底 `VERSION` 一致（`npm run cli:release:check` 会校验）
- [ ] `"private": true` 已移除（同一个命令也会校验）
- [ ] `npm publish --dry-run` 文件清单正确（应为 18 个文件，无 `src/`、无 `tsconfig.json`）
- [ ] 打 tag 后 Actions 里「CLI 发版」三个 job 全绿
- [ ] 发布后 `npx -y yuna-team --version` 能跑
- [ ] 官网胶囊的 `data-copy-command` 与实际包名一致
- [ ] GitHub Release 已附六个平台压缩包与 `SHA256SUMS.txt`

## 六、常见错误

| 现象 | 原因 |
| --- | --- |
| `npm publish` 报 `This package has been marked as private` | 忘了删 `cli/package.json` 的 `"private": true`（本地 `npm run cli:release:check` 能提前查出来） |
| CI 里 `npm publish` 报 `EOTP` / 要求一次性密码 | NPM_TOKEN 没勾 **Bypass two-factor authentication**，换成带该选项的 granular token 或 Classic Automation token |
| CI 里 `npm publish` 报 `E_STAGE_REQUIRED`（只能发到暂存区） | token 权限选了 **Read and write (stage only)**；改成 **Read and write**，或改用 Trusted Publisher |
| OIDC 发布报 `ENEEDAUTH` | workflow filename 填成了完整路径、或残留 NODE_AUTH_TOKEN、或 npm CLI 太旧 |
| CI 里 `npm ci` 报 `EALLOWREMOTE` | package-lock.json 里的 `resolved` 指向第三方镜像；应全部是 `registry.npmjs.org` |
| CI 里 `npm publish` 报 401/403 | secret 名字不是 `NPM_TOKEN`，或 token 已过期 |
| CI 自检报 tag 与版本不一致 | tag 写成 `v0.1.1` 了，本项目约定是 `cli-v0.1.1` |
| Release job 报 `Resource not accessible by integration` | 缺 `permissions: contents: write`（workflow 里已写，改坏了才会遇到） |
| 二进制在 macOS 上被 Gatekeeper 拦 | 没做代码签名；主推 npm 渠道，或让用户 `xattr -d com.apple.quarantine` |
| 报 `You do not have permission to publish "yuna"` | 包名被占，本项目用的是 `yuna-team` |
| `npm error E404 ... PUT ... yuna-team` | 还没 `npm login`，或 token 没有 publish 权限 |
| 装完敲 `yuna` 提示找不到命令 | npm 全局 bin 目录不在 PATH：`npm bin -g` 看路径 |
| `npx yuna-team` 跑的是旧的 | npx 有缓存，加 `-y` 或清 `~/.npm/_npx` |
| 页面复制出的命令是旧包名 | 忘了改 `public/index.html` 与 `public/join.html` 的 `data-copy-command` |
