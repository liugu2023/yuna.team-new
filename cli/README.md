# yuna CLI

燕山大学大学生网络信息协会（YUNA）的命令行工具：在终端里看招新信息、文章、协会项目和授课计划。

站点的首页与加入页上那句 `yuna join --with curiosity` 不再只是装饰——点它会复制真正的安装命令。

## 使用

```bash
npx -y @yuna-team/cli join     # 不安装，直接用
npm i -g @yuna-team/cli        # 或全局安装，之后直接敲 yuna
```

```text
$ yuna join
$ yuna posts -n 5 --tag 运维
$ yuna read docker-compose-in-lab
$ yuna projects --network public
$ yuna lesson --term 2026
$ yuna open projects
```

| 命令 | 说明 |
| --- | --- |
| `yuna join` | 招新与加入信息（时间、对象、答疑、流程、报名链接） |
| `yuna posts` | 已发布文章列表，`-n` 数量、`--tag` 标签、`--kind article\|knowledge`、`--all` 全部 |
| `yuna read <slug>` | 在终端读一篇文章（Markdown 渲染），`--web` 改用浏览器打开 |
| `yuna projects [关键词]` | 协会项目目录，`--network`、`--status`、`--tag` 筛选 |
| `yuna lesson` | 授课计划，`--term` 指定届次、`-n` 限制课次、`--all` 全部届次、`--status` 状态 |
| `yuna open <页面\|路径\|地址>` | 在浏览器打开页面；支持 `post:<slug>`、`page:<名字>` |

全局参数：

- `--json`：以 JSON 输出，便于脚本处理（`open --json` 只输出地址、不打开浏览器）。
- `--base <url>`：指定站点地址，默认 `https://www.yuna.team`；也可以用环境变量 `YUNA_API_BASE`。
- `-h, --help` / `-v, --version`。
- 退出码：`0` 成功，`1` 用法错误或接口错误；接口错误信息直接来自站点的 `{ error }` 字段。

## 数据来源

只读站点的公开接口，**不需要任何密钥，也不会写入线上数据**：

- `GET /api/posts`、`GET /api/posts/:slug`：文章列表与正文。
- `GET /api/site?keys=…`：站点记录。`association-projects`（项目）、`lesson-plan`（授课计划）是 JSON 记录；`join` 页面的可编辑块也在里面。

记录缺失或字段为空时，`yuna join` 会退回 `public/join.html` 里的内置文案，和前端行为一致；项目记录为空时输出与网页相同的空状态文案。

## 开发

```bash
npm run cli:build      # tsc 编译到 cli/dist
npm run cli:typecheck  # 只做类型检查
npm run cli -- posts   # 编译后直接跑
```

本地联调（先把站点跑起来：`npm run dev`）：

```bash
npm run cli:build
node cli/bin/yuna.mjs join --base http://127.0.0.1:8788
# 或
YUNA_API_BASE=http://127.0.0.1:8788 node cli/bin/yuna.mjs projects
```

代码结构：

```text
cli/
  bin/yuna.mjs        入口（读 package.json 里的版本号）
  src/index.ts        命令表、帮助、错误处理
  src/args.ts         util.parseArgs 解析，未知参数直接报错
  src/api.ts          公开接口客户端（零依赖，用内置 fetch）
  src/ui.ts           颜色、中英混排宽度、折行（含中文避头尾）、对齐
  src/markdown.ts     终端 Markdown 渲染（标题/列表/引用/代码块/表格/提示块）
  src/commands/*.ts   六个命令，各自独立
```

运行时零依赖（只用 Node 内置模块 + 全局 `fetch`），所以包很小，也容易编译成单文件二进制。

## 发布清单

1. 去掉 `cli/package.json` 里的 `"private": true`。
2. 确认 npm 上的组织名/包名（`yuna` 与 `yuna-cli` 已被占用，所以用 scope，命令名仍是 `yuna`）。
3. 版本号同时改 `cli/package.json` 与 `src/index.ts` 的兜底 `VERSION`（`bin/yuna.mjs` 优先读 package.json，二进制里读不到才用兜底值）。
4. 单文件二进制（Homebrew / Scoop / winget 用）：
   ```bash
   bun build --compile --outfile yuna cli/bin/yuna.mjs
   ```
5. 六个平台矩阵（win/mac/linux × x64/arm64）由 CI 产出并挂到 GitHub Release，再用各自仓库的清单指向它。

## 许可

MIT
