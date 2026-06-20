# YUNA 社团动态博客

燕山大学大学生网络信息协会的社团动态博客系统，基于 Cloudflare Pages + Pages Functions。它面向协会官网场景，而不是通用文档站：主页展示最新动态、部门入口、授课资料、招新信息，后台负责 Markdown 动态、协会成员和名人堂内容维护。

- Cloudflare Pages 托管前台页面、内容页和后台界面。
- Pages Functions 提供文章、鉴权、站点内容和媒体上传 API。
- D1 保存文章元数据、登录会话、协会成员、名人堂和增量备份。
- R2 保存 Markdown 文章正文和后台上传的图片资源。
- Authentik OIDC 负责成员登录和后台访问控制。

## 项目结构

```text
public/                 前台、内容页、后台和静态授课资料
public/content/         协会介绍、部门介绍、授课链接、招新说明
public/activates/       从旧站迁移来的授课资料下载文件
functions/api/          Pages Functions API 路由
functions/_shared/      鉴权、会话、HTTP、OIDC 等共享逻辑
migrations/             D1 数据库迁移
wrangler.toml           Cloudflare 绑定和公开变量
```

文章存储方式：

- D1 保存标题、链接标识、摘要、状态、作者、时间和 R2 object key。
- R2 保存 Markdown 正文，路径为 `posts/{slug}.md`。

## Cloudflare 初始化

安装依赖：

```bash
npm install
```

如需新建资源，创建 D1 数据库后把返回的 database id 写入 `wrangler.toml`：

```bash
npx wrangler d1 create cloudflare_markdown_blog
```

创建 R2 bucket：

```bash
npx wrangler r2 bucket create cloudflare-markdown-blog
```

应用 D1 迁移：

```bash
npm run db:migrate:local
npm run db:migrate
```

当前 `wrangler.toml` 保留了已经配置过的 D1/R2 资源名，避免重新创建 Cloudflare 资源。

## Authentik 配置

在 Authentik 创建 OAuth2/OpenID Provider 和 Application，回调地址固定为：

```text
https://yuna.liugu.cc/auth/callback
```

`wrangler.toml` 中保留 issuer、client id 和回调路径：

```toml
[vars]
PUBLIC_BASE_URL = "https://yuna.liugu.cc"
AUTHENTIK_ISSUER = "https://sso.yuna.welain.com/application/o/yuna-docs/"
AUTHENTIK_CLIENT_ID = "..."
AUTHENTIK_REDIRECT_PATH = "/auth/callback"
ADMIN_IDENTITY_ALLOWLIST = ""
```

`ADMIN_IDENTITY_ALLOWLIST` 预留给以后做本地白名单。当前系统信任 Authentik 侧的应用访问控制：能完成 OIDC 登录并返回 email 或 username 的用户可以进入后台。

本地 secret 放在 `.dev.vars`：

```bash
cp .dev.vars.example .dev.vars
```

然后填写：

```text
AUTHENTIK_CLIENT_SECRET=...
SESSION_SECRET=...
```

生产环境 secret 通过 Wrangler 写入 Pages：

```bash
npx wrangler pages secret put AUTHENTIK_CLIENT_SECRET
npx wrangler pages secret put SESSION_SECRET
npx wrangler pages secret put MIGRATION_TOKEN
```

`SESSION_SECRET` 用来签名会话 Cookie，请使用足够长的随机字符串。

## 本地预览

```bash
npm run dev
```

Open:

```text
http://localhost:8788
http://localhost:8788/admin/
```

首页会显示协会入口、部门导航、授课资料、招新信息和最新动态。通过 Authentik 登录后，首页会显示管理后台入口。后台可以创建、更新、删除 Markdown 动态，并支持状态设置、实时预览、搜索和筛选。

内容链接检查：

```bash
npm run content:check
```

## API

公开接口：

- `GET /api/posts` lists published posts.
- `GET /api/posts/:slug` returns a published post and its Markdown body.
- `GET /api/site/:key` returns structured long-lived content.
- `GET /media/:path` serves uploaded R2 media.

后台接口：

- `GET /api/posts?drafts=1` lists all posts.
- `POST /api/posts` creates a post.
- `PUT /api/posts/:slug` updates metadata and Markdown.
- `DELETE /api/posts/:slug` deletes D1 metadata and the R2 Markdown object.
- `PUT /api/admin/media/:path` uploads an image or binary asset to R2.
- `PUT /api/admin/site/:key` updates long-lived site content and writes an incremental D1 backup row.

## 长期内容

协会成员和名人堂不在仓库里明文维护，它们作为结构化 JSON 记录保存在 D1；每次更新会把旧版本写入 `site_record_backups`。

普通动态走 Markdown 编辑器。协会成员和名人堂使用固定表单，维护者不需要编辑原始 JSON。

图片上传到 R2 并通过 `/media/...` 访问。文章图片从 Markdown 编辑器插入，成员和名人堂头像从各自表单上传。

从旧仓库迁移头像图片到 R2：

```bash
$env:SITE_BASE_URL="https://yuna.liugu.cc"
$env:MIGRATION_TOKEN="same-value-as-pages-secret"
$env:SOURCE_ROOT='D:\System\Desktop\yuna\yuna.team\docs'
npm run media:migrate
```

鉴权接口：

- `GET /api/auth/login`
- `GET /auth/callback`
- `GET /api/auth/logout`
- `GET /api/auth/me`

## 部署

Cloudflare Pages Git 集成建议：

- Build command: 留空或 `npm install`
- Build output directory: `public`
- Functions directory: `functions`

确认 Pages 项目设置中的 D1/R2 绑定与 `wrangler.toml` 一致，或者使用 Wrangler 部署：

```bash
npm run deploy
```

## 后续可加强项

- Replace the tiny browser Markdown renderer with a full CommonMark renderer and sanitizer.
- Add CSRF protection for admin mutation endpoints.
- Add pagination and tags.
- Move sessions to Authentik token introspection if you need centralized logout.
