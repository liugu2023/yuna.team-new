# CLI 本地验证与发布

包名为 `yuna-team`，安装后的命令名为 `yuna`。本文以 **0.2.0** 为例。以下命令默认在仓库根目录执行；本地构建、打包和创建本地 tag 不会发布 npm 包。

## 本地验证

```powershell
npm ci
npm run cli:typecheck
npm run cli:test
npm run cli:release:check -- cli-v0.2.0
```

`cli:test` 先编译，再用本地模拟 API 执行回归测试，覆盖分页、筛选编号、本地缓存、招新开关、课件链接、终端输出和错误处理。`cli:release:check` 检查包版本、二进制兜底版本、tag 以及实际 npm 文件清单。

包中需要包含 `package.json`、`bin/yuna.mjs`、编译后的 `dist/`、`README.md` 和 `LICENSE`；源码、测试、配置、开发说明和本地数据不应进入包。检查按必要文件与排除项判断，不依赖固定文件数量。

联调本地网站，在另一个终端运行 `npm run dev`，然后：

```powershell
node cli/bin/yuna.mjs join --base http://127.0.0.1:8788
node cli/bin/yuna.mjs posts -n 5 --tag 运维 --base http://127.0.0.1:8788
node cli/bin/yuna.mjs read 1 --base http://127.0.0.1:8788
node cli/bin/yuna.mjs lesson --all --base http://127.0.0.1:8788
```

也可在当前终端设置 `$env:YUNA_API_BASE = "http://127.0.0.1:8788"`，省去后续命令的 `--base`。文章编号缓存按站点隔离；用 `$env:YUNA_CACHE_DIR = "$PWD/.ui-notes/cli-cache"` 可将本次测试的快照放到指定目录。

检查本地安装包：

```powershell
cd cli
npm pack
npm i -g .\yuna-team-0.2.0.tgz
yuna --version
yuna --help
yuna open home --json
npm uninstall -g yuna-team
```

`prepack` 会在 `npm pack` 和 `npm publish` 前自动编译，避免分发旧的 `dist`。全局试装会更改本机的 `yuna` 安装；日常开发直接运行 `node cli/bin/yuna.mjs` 即可。

## CI 与手动构建

| 工作流 | 触发 | 行为 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | 分支推送、PR、手动 | 网站检查；Windows / Linux 上的 CLI 检查与回归测试，以及最低 Node 版本验证 |
| `.github/workflows/cli.yml` | 推送 `cli-v*` tag | 检查、npm 发布、六平台二进制构建、GitHub Release |
| `.github/workflows/cli.yml` | Actions 手动运行 | 检查与二进制构建，保存 `yuna-cli-binaries` artifact；不发布 npm 或创建 Release |

想先看发布产物，可在 Actions → **CLI 发版** → **Run workflow** 选择分支。成功后从该次运行的 Artifacts 下载压缩包和 `SHA256SUMS.txt`。

二进制覆盖 Windows、macOS、Linux 的 x64 与 arm64。CI 会运行 Linux x64 产物的冒烟检查；其他平台产物由交叉编译生成，运行验证需要对应平台。二进制内置运行时，用户无需另装 Node。

## 发布认证

工作流支持两种 npm 认证方式：存在仓库 secret `NPM_TOKEN` 时使用 token；没有时使用 Trusted Publisher（OIDC）。GitHub Release 使用 Actions 自带的 `GITHUB_TOKEN`，不需要另建 GitHub PAT。

### Trusted Publisher / OIDC

在 npm 的 `yuna-team` 包设置中配置 GitHub Actions Trusted Publisher：

| 字段 | 值 |
| --- | --- |
| Organization or user | `liugu2023` |
| Repository | `yuna.team-new` |
| Workflow filename | `cli.yml`，只填文件名 |
| Environment | 留空，与当前工作流一致 |
| Allowed actions | 勾选 **Allow npm publish**，允许直接发布 |

`npm stage publish` 默认被允许，但当前工作流执行的是直接 `npm publish`，必须额外勾选 **Allow npm publish**。否则即使 provenance 签名成功，也会收到 `403 OIDC permission denied for this action`。

`cli/package.json` 的 `repository.url` 也必须匹配此仓库，当前为 `git+https://github.com/liugu2023/yuna.team-new.git`，workspace 目录为 `cli`；发版自检会核对仓库字段。详见 [npm 官方 Trusted Publisher 配置说明](https://docs.npmjs.com/trusted-publishers/)。

配置完成后，移除仓库的 `NPM_TOKEN` secret，下次 tag 发布就会进入 OIDC 分支。工作流已经设置 `id-token: write`、Node 22 和新版 npm，并在 OIDC 分支清除临时 `.npmrc` 中的 token 和旧版 `always-auth` 配置，避免干扰身份认证。

### NPM_TOKEN

如果使用 token，在 npm 创建对 `yuna-team` 有发布权限的 granular access token，并存入 GitHub 仓库 Settings → Secrets and variables → Actions，名称为 `NPM_TOKEN`。

token 应具备该包的 **Read and write** 权限；仅有 stage 权限不能执行当前工作流中的直接发布。无人值守发布还需满足 npm 账号与包的 2FA 策略，使用允许发布且可绕过交互式 2FA 的 token。设置适当有效期并按期更新；无需给其他包授予权限。

认证未配置完成前先使用手动构建验证；它不需要 npm 发布权限。

## 发布 0.2.0

先同步以下版本信息：

- `cli/package.json` 的 `version`。
- `cli/src/index.ts` 的 `VERSION`，用于单文件二进制兜底。
- 根目录 `package-lock.json` 中的 CLI workspace 版本。

运行本地检查并提交、推送版本改动。确认 npm 认证已配置后，推送与版本完全一致的 tag：

```powershell
npm run cli:test
npm run cli:release:check -- cli-v0.2.0
git tag -a cli-v0.2.0 -m "yuna CLI 0.2.0"
git push --atomic origin master cli-v0.2.0
```

若本地 tag 已创建，跳过 `git tag`，可用 `git show --no-patch cli-v0.2.0` 检查其提交。`--atomic` 会一起推送分支与指定 tag，避免只更新一部分；它不会推送其他本地 tag。

推送 tag 会实际触发 npm 发布和 GitHub Release。正常情况下，npm 发布成功后才继续二进制构建；该版本已存在时跳过 npm 发布，继续生成 Release 产物。npm 已发布版本不能覆盖，代码有变化时应使用新版本号。版本说明见 [CHANGELOG.md](CHANGELOG.md)。

若选择手动发布 npm 包，在已登录且有发布权限的本机执行：

```powershell
cd cli
npm login
npm publish --dry-run
npm publish
```

手动 npm 发布只上传 npm 包，不会生成 GitHub Release。仓库根包是网站 workspace，不是发布目标；所有 `npm publish` 命令都在 `cli/` 目录执行。

完成发布后验证具体版本：

```powershell
npm view yuna-team@0.2.0 version
npx -y yuna-team@0.2.0 --version
npx -y yuna-team@0.2.0 open home --json
```

同时确认 GitHub Release 包含六个平台压缩包及 `SHA256SUMS.txt`。`npx` 的 `-y` 只是接受安装提示；验证特定版本应显式写 `@0.2.0`，验证最新已发布版本使用 `@latest`。

## 常见问题

| 现象 | 排查方向 |
| --- | --- |
| `read 1` 提示没有列表 | 对同一个 `--base` 先运行 `posts`，或直接按 slug 阅读；检查 `YUNA_CACHE_DIR` 是否改变 |
| 代理失败 | 检查 `--proxy` 的 HTTP(S) 地址和代理服务；CLI 会报错退出，不会自动直连 |
| OIDC 报 `ENEEDAUTH` | 检查 npm Trusted Publisher 的仓库、`cli.yml` 文件名、environment 是否匹配，及是否残留 token 配置 |
| token 发布报 `EOTP` | token 或包的 2FA 策略不允许无人值守发布；检查权限或改用 OIDC |
| token 发布报 `E_STAGE_REQUIRED` | token 仅有 stage 权限，无法直接发布 |
| npm 发布报 401 / 403 | 检查 token 有效期、`yuna-team` 写权限或 npm Trusted Publisher 配置 |
| 自检报 tag 不一致 | tag 必须是 `cli-v` 加 `cli/package.json` 的完整版本号 |
| 打包缺少编译文件 | 检查 `prepack` 是否被 `--ignore-scripts` 跳过；先运行 `npm run cli:build` |
| Release 没有生成 | 手动运行只留 artifact；tag 发布需通过检查与 npm 发布阶段，Release job 需要 `contents: write` |
| 全局安装后找不到 `yuna` | 用 `npm prefix -g` 检查全局安装前缀，并确认对应命令目录在 PATH 中 |
| `npx` 版本不符合预期 | 显式使用 `yuna-team@0.2.0` 或 `yuna-team@latest`，`-y` 不负责刷新缓存 |

目前分发渠道是 npm 和 GitHub Release；Homebrew、Scoop、winget 等渠道尚未接入。
