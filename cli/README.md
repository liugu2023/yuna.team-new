# yuna CLI

燕山大学大学生网络信息协会（YUNA）的命令行工具：在终端里看招新信息、文章、协会项目和授课计划。运行需要 Node.js 18.17 或更新版本。

本文对应 0.2.0。用 `yuna --version` 查看当前安装版本；npm 安装命令获取最新已发布版本，本地构建方式见下文。

## 使用

```bash
npx -y yuna-team@latest join  # 临时运行最新已发布版本
npm i -g yuna-team@latest     # 全局安装，之后直接使用 yuna
```

```bash
yuna join
yuna posts -n 5 --tag 运维
yuna read 1
yuna read docker-compose-in-lab
yuna projects --network public
yuna lesson --term 2026
yuna open recap
```

| 命令 | 说明 |
| --- | --- |
| `yuna join` | 招新进行中显示报名信息；结束后显示收官情况、统计和后续参与入口 |
| `yuna posts` | 已发布文章列表，支持 `-n` 数量、`--tag` 标签、`--kind article\|knowledge`、`--all` 全部 |
| `yuna read <编号\|slug>` | 阅读文章；编号对应本站最近一次 `posts` 列表，`--web` 用浏览器打开 |
| `yuna projects [关键词]` | 项目目录，支持 `--network public\|internal\|unspecified`、`--status planning\|building\|maintaining\|archived` 和 `--tag` |
| `yuna lesson` | 最新届次课表；支持 `--term`、`--all` 全部届次、`-n` 每届课次上限、`--status planned\|completed\|cancelled` |
| `yuna open <页面\|路径\|地址>` | 在浏览器打开页面，支持 `recap`、`post:<slug>`、`page:<名字>` 等 |

全局参数：

- `--json`：输出 JSON。`open --json` 和 `read --web --json` 只输出地址，不启动浏览器。
- `--base <url>`：指定站点，默认 `https://www.yuna.team`；也可设置 `YUNA_API_BASE`。
- `--proxy <url>`：显式使用 HTTP(S) 代理，例如 `--proxy http://127.0.0.1:7890`。代理初始化或连接失败会报错，不会退回直连。
- `-h, --help` / `-v, --version`：帮助与版本。`yuna <命令> --help` 查看该命令用法。

未知参数、当前命令不支持的选项和冲突选项都会报错，例如 `yuna join --tag 运维`、`yuna posts --all -n 5`。成功退出码为 `0`，用法或接口错误为 `1`；错误写入 stderr。

## 文章编号与筛选

`posts` 默认显示 10 篇，`-n 60` 会跨接口分页读取 60 篇，`--all` 读取全部匹配文章，没有原先的 500 篇上限。`--tag` 对标签做不区分大小写的包含匹配，`--kind` 限定文章类型。

```bash
yuna posts --tag 运维 -n 5
yuna read 1                    # 刚才列表里的第 1 篇
yuna read 1 --tag 运维          # 重新查询当前运维筛选结果的第 1 篇
yuna read 2 --kind knowledge    # 当前资料列表的第 2 篇
yuna read 2026 --slug           # slug 为“2026”的文章，不按编号解释
yuna read 1 --web --json        # 只输出 { slug, url }
```

每次成功获取 `posts` 列表（包括 `--json`）都会保存编号到 slug 的本地快照。之后不带筛选的 `read 1` 使用这份快照，新发布文章不会把已有编号挤到另一篇。再次运行 `posts` 会替换本站快照；空列表也会清空旧编号。

第一次按编号阅读前需要先运行 `posts`。显式传入 `--tag` 或 `--kind` 时，`read` 改为查询当前筛选结果，不使用也不覆盖快照；这些筛选选项只用于编号查询，不能与 slug 阅读混用。正文始终从站点获取，快照不提供离线阅读。

快照按站点 `--base` 隔离，本地预览与线上列表不会互相覆盖。设置 `YUNA_CACHE_DIR` 可指定缓存目录；默认位置为：

| 系统 | 缓存目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%/yuna-team`，未设置时用用户目录下的 `AppData/Local/yuna-team` |
| macOS / Linux | `$XDG_CACHE_HOME/yuna-team`，未设置时用 `~/.cache/yuna-team` |

缓存仅保存站点地址与文章 slug。目录不可写时，`posts` 会提示并显示 slug，此时直接用 `read <slug>` 阅读。

## 招新与授课计划

`join` 与网站读取同一个 `recruitment-status` 开关。只有 `closed: true` 才按结束状态展示收官文案和四项统计，并给出收官、公开课、新成员指南与咨询入口；报名流程及旧报名入口会收起。缺失或损坏的开关默认按进行中处理，网络请求失败则明确报错。

`join --json` 保留 `title`、`lead`、`kpi`、`steps`、`contact`、`actions`、`url`，增加 `closed`、`recruitmentStatus`（`open` / `closed`）、`stats` 和 `recapUrl`。结束时 `kpi`、`steps` 为空数组，`contact` 是收官咨询文案；进行中 `stats` 为空数组，`recapUrl` 为 `null`。

`lesson` 优先按后台顺序展示届次，同序时按数字自然排序，例如第 10 届排在第 9 届前。课件的 `/media/...` 地址会转成完整地址，无标题链接用 URL 代替标题，邮件链接也会保留；普通输出与 JSON 使用相同链接数据。

## 数据来源

CLI 只读站点公开接口，不需要密钥，也不会写入线上数据：

- `GET /api/posts`、`GET /api/posts/:slug`：文章列表与正文。
- `GET /api/site?keys=…`：招新状态与可编辑文案、`association-projects` 项目目录、`lesson-plan` 课表。

招新文案缺失的字段使用网站内置文案。项目和课表没有记录时显示空状态。

网络访问优先使用运行时 `fetch`。遇到直连的连接超时或网络不可达时，GET/HEAD 请求会静默重试一次：等待 200ms，使用 `undici` 将每个地址的尝试时间设为 1000ms、连接超时设为 5 秒；请求和正文读取仍共享原有 15 秒总时限。HTTP 错误、证书错误、DNS 错误和已超时的请求不做这次重试。

CLI 不修改系统 DNS、不绑定固定网卡，也不会自行把 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量作为备用出口。显式 `--proxy` 始终使用该代理，失败就报错；它影响 CLI 的 API 请求，浏览器仍使用自身的网络设置。`undici` 只在直连回退或显式代理时加载。

## 本地开发与测试

以下命令在仓库根目录执行：

```bash
npm ci
npm run cli:build      # 编译到 cli/dist
npm run cli:typecheck
npm run cli:test       # 编译并执行本地回归测试
npm run cli -- --help
```

本地联调先在另一个终端运行 `npm run dev`，再指定站点地址：

```bash
node cli/bin/yuna.mjs join --base http://127.0.0.1:8788
node cli/bin/yuna.mjs posts --base http://127.0.0.1:8788
node cli/bin/yuna.mjs read 1 --base http://127.0.0.1:8788
```

测试使用本地模拟接口覆盖分页、编号快照、招新状态、链接和错误处理，不依赖线上内容。

从 npm 包本地试装：

```bash
cd cli
npm pack                         # prepack 自动编译，产出 yuna-team-0.2.0.tgz
npm i -g ./yuna-team-0.2.0.tgz
yuna --version
npm uninstall -g yuna-team
```

改动源码后重新构建才能运行；`npm pack` 和 `npm publish` 都会通过 `prepack` 自动构建。完整发布流程见仓库中的 `cli/PUBLISHING.md`，该文件不随 npm 包分发。

## 许可

MIT。
