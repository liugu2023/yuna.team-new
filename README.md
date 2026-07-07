# YUNA 协会博客系统

这是燕山大学大学生网络信息协会（YUNA）的协会博客系统。项目部署在 Cloudflare Pages 上，使用 Pages Functions 提供后端接口，D1 保存文章和长期数据，R2 保存图片、PDF 等文件资源，Authentik 负责登录鉴权。

这个仓库只保存网站框架、页面逻辑、样式和数据库迁移脚本；实际文章、固定页面内容、协会成员、名人堂和首页图库等数据都进入 D1。图片、头像、PDF 等二进制资源进入 R2。

## 功能概览

- 首页展示协会头图、最新文章、部门入口和底部相关服务。
- 普通文章使用 Markdown 编辑器维护，正文存入 D1。
- 协会成员按届数、部门、职位结构化维护。
- 名人堂独立维护头像、名称、职位、履历和联系方式。
- 固定页面内容可以从数据库读取和编辑。
- 后台支持数据库导出和强制导入，方便整站数据迁移。
- 图片和授课资料上传直接写入 R2，页面通过 `/media/...` 访问。
- R2 上传支持小文件直传和大文件分片上传。
- 文章或固定 Markdown 页面发生改动后，会自动同步 Markdown 快照到私有 GitHub 仓库。
- Authentik OIDC 登录后进入管理后台。

## 技术栈

- Cloudflare Pages：静态页面托管。
- Cloudflare Pages Functions：接口、鉴权、媒体读取。
- Cloudflare D1：文章 Markdown、站点结构化数据、会话、备份。
- Cloudflare R2：图片、头像、PDF 等二进制资源。
- Authentik：OIDC 登录和用户身份来源。
- TypeScript：Functions 类型检查。
- 原生 HTML/CSS/JavaScript：前台和后台界面。

## 目录结构

```text
public/                 前台页面、后台页面、静态资源
public/admin/           管理后台
public/styles.css       全局样式
public/app.js           前台交互逻辑
functions/              Cloudflare Pages Functions
functions/_shared/      鉴权、会话、D1、R2、HTTP 等共享逻辑
migrations/             D1 数据库迁移脚本
scripts/                旧内容迁移、媒体迁移、内容检查脚本
wrangler.toml           Cloudflare 绑定和公开环境变量
.dev.vars.example       本地 secret 示例
```

## 数据存储规则

D1 存储：

- 文章标题、摘要、状态、作者、发布时间和 Markdown 正文。
- 固定页面 Markdown 内容。
- 协会成员、名人堂、首页图库等长期结构化数据。
- 后台登录会话。
- 站点记录的增量备份。

R2 存储：

- 文章内图片。
- 成员头像、名人堂头像。
- 首页背景图。
- 授课资料、PDF、压缩包等资料文件。

仓库不再保存实际文章内容。重新部署 Pages 不会自动修改 D1 数据，也不会自动执行数据库迁移。

## 本地启动

安装依赖：

```bash
npm install
```

复制本地 secret 示例：

```bash
copy .dev.vars.example .dev.vars
```

在 `.dev.vars` 中填写：

```text
AUTHENTIK_CLIENT_SECRET=Authentik Provider 的 client secret
SESSION_SECRET=至少 32 字节的随机字符串
R2_MIGRATION_TOKEN=仅旧媒体迁移脚本写入 R2 时需要
R2_MIGRATION_PREFIXES=activates
GITHUB_BACKUP_TOKEN=GitHub fine-grained token，仅 Markdown 备份需要
```

初始化本地 D1：

```bash
npm run db:migrate:local
```

启动本地预览：

```bash
npm run dev
```

打开：

```text
http://localhost:8788
http://localhost:8788/admin/
```

`wrangler pages dev` 会同时启动静态页面、Functions、D1 和 R2 绑定。只打开 HTML 文件无法完整预览后台和接口功能。

## Cloudflare 资源

当前绑定名固定为：

```toml
[[d1_databases]]
binding = "BLOG_DB"
database_name = "cloudflare_markdown_blog"

[[r2_buckets]]
binding = "BLOG_BUCKET"
bucket_name = "cloudflare-markdown-blog"
```

如果是新环境，需要先创建 D1 和 R2：

```bash
npx wrangler d1 create cloudflare_markdown_blog
npx wrangler r2 bucket create cloudflare-markdown-blog
```

然后把 D1 返回的 `database_id` 写回 `wrangler.toml`。

线上执行 D1 迁移：

```bash
npm run db:migrate
```

注意：Pages 重新构建不会自动执行 D1 迁移。只要 `migrations/` 新增了脚本，就需要手动执行一次 `npm run db:migrate`。

## 生产环境 Secrets

Cloudflare Pages 项目名以控制台为准。当前线上项目使用过 `yuna-team-new`，设置 secret 时建议显式指定项目名：

```bash
npx wrangler pages secret put AUTHENTIK_CLIENT_SECRET --project-name yuna-team-new
npx wrangler pages secret put SESSION_SECRET --project-name yuna-team-new
npx wrangler pages secret put R2_MIGRATION_TOKEN --project-name yuna-team-new
npx wrangler pages secret put GITHUB_BACKUP_TOKEN --project-name yuna-team-new
```

说明：

- `AUTHENTIK_CLIENT_SECRET`：Authentik OAuth Provider 的客户端密钥。
- `SESSION_SECRET`：用于签名登录会话 Cookie，必须是随机长字符串。
- `R2_MIGRATION_TOKEN`：只用于旧媒体迁移脚本写入 R2，不具备后台管理权限。
- `GITHUB_BACKUP_TOKEN`：写入私有 GitHub 备份仓库的 token。

`wrangler.toml` 中的公开变量：

```toml
PUBLIC_BASE_URL = "https://yuna.liugu.cc"
AUTHENTIK_ISSUER = "https://sso.yuna.welain.com/application/o/yuna-docs/"
AUTHENTIK_CLIENT_ID = "esxw1ynBDm6B6r5dzIdCtBfJ3ifkKVk7WbIRD7Py"
AUTHENTIK_REDIRECT_PATH = "/auth/callback"
SSO_ALLOWED_HOSTS = ""
CONTROL_GROUP = "yuna-docs-edit"
R2_MIGRATION_PREFIXES = "activates"
GITHUB_BACKUP_REPO = ""
GITHUB_BACKUP_BRANCH = "main"
GITHUB_BACKUP_PATH = "yuna-blog"
```

GitHub Markdown 备份配置：

- `GITHUB_BACKUP_REPO`：目标仓库，格式为 `owner/repo`。
- `GITHUB_BACKUP_BRANCH`：目标分支，默认 `main`，需要提前存在。
- `GITHUB_BACKUP_PATH`：写入仓库内的目录前缀，默认 `yuna-blog`。
- `GITHUB_BACKUP_TOKEN`：GitHub fine-grained personal access token，至少需要目标仓库的 `Contents: Read and write` 权限。

保存文章、删除文章、编辑固定 Markdown 页面、导入数据库或迁移旧文章后，系统会在响应返回后自动同步 D1 里的 Markdown 快照到 GitHub。配置缺失时会跳过同步，不影响正常写入。

备份仓库建议使用独立私有仓库，不要把它绑定到 Cloudflare Pages 项目。这个同步只会向 GitHub 写入 Markdown 快照，不会调用 Cloudflare 部署；如果目标仓库本身被 Pages 监听，GitHub 提交仍然会触发 Pages 构建。

## Authentik 配置

Authentik Application slug：

```text
yuna-docs
```

Issuer：

```text
https://sso.yuna.welain.com/application/o/yuna-docs/
```

回调地址默认为：

```text
https://yuna.liugu.cc/auth/callback
```

站点支持通过多个 CNAME 域名访问。把额外域名写进 `SSO_ALLOWED_HOSTS`（逗号分隔，主机名或完整 origin 均可）后，登录会回调到用户实际访问的域名：

```toml
SSO_ALLOWED_HOSTS = "docs.example.com, blog.example.org"
```

同时要把每个域名的回调地址加入 Authentik Provider 的 Redirect URIs，例如 `https://docs.example.com/auth/callback`。不在名单内的域名会退回 `PUBLIC_BASE_URL` 的规范回调地址。

本地开发时，如果需要完整测试登录，也需要在 Authentik Provider 中加入本地回调地址：

```text
http://localhost:8788/auth/callback
```

后台权限规则：

- `CONTROL_GROUP` 是唯一控制权限组。
- 登录用户必须属于 `CONTROL_GROUP` 对应的 Authentik 用户组，才可以进入后台、管理文章、维护成员和名人堂、编辑固定 Markdown 页面、上传后台资源。
- 未登录用户，以及已登录但不在该组内的用户，都没有控制权限。
- `CONTROL_GROUP` 为空时，没有任何登录用户拥有控制权限。

用户组信息会在登录时写入会话。Authentik 侧改组后，用户需要退出并重新登录。

调试权限时，登录后访问：

```text
/api/auth/me
```

返回里的 `user.groups` 是 Authentik 通过 `groups` scope 返回并写入会话的用户组，`authz.controlGroupMatched` 会显示当前配置的组名是否命中。

## 部署

方式一：通过 Cloudflare Pages 连接 Git 仓库。

- 构建命令：可以留空，或使用 `npm install`。
- 输出目录：`public`。
- Functions 目录：`functions`。
- D1 绑定名：`BLOG_DB`。
- R2 绑定名：`BLOG_BUCKET`。

方式二：使用 Wrangler 手动部署：

```bash
npm run deploy
```

部署前确认：

```bash
npm run typecheck
npm run db:migrate
```

## 管理后台

后台地址：

```text
/admin/
```

当前后台包含：

- 文章管理：创建、编辑、发布、保存草稿、删除文章。
- 协会成员：按届数、部门、职位维护成员。
- 名人堂：维护头像、名称、职位、履历和联系方式。
- 站点维护：手动同步 Markdown 备份、导出数据库、强制导入数据库、维护首页图库。
- 文章编辑器：上传图片和附件资料，并自动插入 Markdown 链接。

数据库导出会生成完整 JSON 备份。数据库导入会以导入内容为准强制覆盖对应数据，操作前建议先导出一份当前数据。

资料文件保存在 R2。文章编辑器上传附件时，8MB 以内走普通上传，超过 8MB 自动按 8MB 分片上传并在 R2 合并。

## 数据迁移

旧 Markdown 固定页面迁移到 D1：

```powershell
$env:PUBLIC_BASE_URL="https://yuna.liugu.cc"
$env:ADMIN_SESSION_COOKIE="登录后台后的 yuna_session Cookie 值"
$env:CONTENT_SOURCE_REF="旧内容所在的 git ref，例如 9e4fd12^"
npm run db:migrate-pages
```

旧动态文章迁移到 D1：

```powershell
$env:PUBLIC_BASE_URL="https://yuna.liugu.cc"
$env:ADMIN_SESSION_COOKIE="登录后台后的 yuna_session Cookie 值"
npm run db:migrate-posts
```

旧授课资料、PDF、压缩包等文件迁移到 R2：

```powershell
$env:SITE_BASE_URL="https://yuna.liugu.cc"
$env:R2_MIGRATION_TOKEN="与 Cloudflare Pages 中一致的 R2_MIGRATION_TOKEN"
$env:SOURCE_ROOT="D:\System\Desktop\yuna\yuna.team\docs"
npm run media:migrate
```

`media:migrate` 只迁移旧站 `public/activates` 下的授课资料。小文件直接上传，大文件自动使用 R2 multipart 分片上传。`R2_MIGRATION_TOKEN` 只允许写入 `R2_MIGRATION_PREFIXES` 配置的媒体前缀，默认是 `activates`。

这些迁移脚本只用于旧内容搬迁，日常写文章和传图片直接在后台完成。

## 常用命令

```bash
npm run dev               # 本地启动 Pages + Functions
npm run deploy            # 部署到 Cloudflare Pages
npm run db:migrate:local  # 本地 D1 迁移
npm run db:migrate        # 线上 D1 迁移
npm run typecheck         # TypeScript 类型检查
npm run content:check     # 检查内容链接
npm run db:migrate-pages  # 旧固定页面迁移到 D1
npm run db:migrate-posts  # 旧文章迁移到 D1
npm run media:migrate     # 旧媒体文件迁移到 R2
```

## 接口概览

公开接口：

- `GET /api/posts`：获取已发布文章列表。
- `GET /api/posts/:slug`：获取文章详情和 Markdown 正文。
- `GET /api/site/:key`：获取固定页面或结构化站点记录。
- `GET /media/:path`：读取 R2 媒体文件。

鉴权接口：

- `GET /api/auth/login`：跳转 Authentik 登录。
- `GET /auth/callback`：OIDC 回调。
- `POST /api/auth/logout`：退出登录。
- `GET /api/auth/me`：获取当前登录用户。

后台接口：

- `POST /api/posts`：创建文章。
- `PUT /api/posts/:slug`：更新文章。
- `DELETE /api/posts/:slug`：删除文章。
- `PUT /api/admin/media/:path`：上传媒体到 R2。
- `POST /api/admin/uploads/init`：初始化 R2 分片上传。
- `PUT /api/admin/uploads/part`：上传一个 R2 分片。
- `POST /api/admin/uploads/complete`：完成 R2 分片上传。
- `POST /api/admin/uploads/abort`：取消 R2 分片上传。
- `POST /api/admin/github-sync`：手动同步 D1 Markdown 快照到 GitHub。
- `PUT /api/admin/site/:key`：更新站点记录。
- `GET /api/admin/export?download=1`：导出数据库数据。
- `POST /api/admin/import`：导入数据库数据。

## 安全说明

- 不要把 `AUTHENTIK_CLIENT_SECRET`、`SESSION_SECRET`、`R2_MIGRATION_TOKEN`、`GITHUB_BACKUP_TOKEN` 提交进仓库。
- `SESSION_SECRET` 修改后，已有登录会话会失效。
- R2 文件通过后端接口输出，非图片类型会按下载文件处理。
- 联系方式链接会限制协议，避免写入危险链接。
- 数据库导入是覆盖型操作，执行前先确认导入文件来源可信。
- 公开接口不输出成员登录邮箱：文章的 `author_email`、站点记录的 `updated_by` 只保留在数据库和管理端导出里。
- 所有写请求（POST/PUT/DELETE）在中间件统一校验 Origin 头，跨站请求直接拒绝；无 Origin 的脚本客户端仍需各接口自身的鉴权。
- `public/_headers` 下发全站安全响应头（CSP、X-Frame-Options、HSTS 等），只覆盖静态资源；接口响应的安全头在代码中单独设置。
- 文章阅读计数按浏览器 Cookie 去重（30 分钟内同一篇不重复累计），计数写入在响应后异步执行。
