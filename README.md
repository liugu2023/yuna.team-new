# YUNA 最新动态

燕山大学大学生网络信息协会的动态发布系统，基于 Cloudflare Pages + Pages Functions：

- Cloudflare Pages for static UI
- Pages Functions for API routes
- D1 for post metadata and sessions
- R2 for Markdown article bodies
- Authentik OIDC for admin authentication

## Project Layout

```text
public/                 Static blog and admin UI
functions/api/          Cloudflare Pages Functions API routes
functions/_shared/      Shared auth, session, HTTP, and OIDC helpers
migrations/             D1 migrations
wrangler.toml           Cloudflare bindings and public vars
```

文章存储方式：

- D1 stores title, slug, excerpt, status, author, dates, and the R2 object key.
- R2 stores the Markdown body at `posts/{slug}.md`.

## Cloudflare Setup

Install dependencies:

```bash
npm install
```

Create the D1 database and copy the returned database id into `wrangler.toml`:

```bash
npx wrangler d1 create cloudflare_markdown_blog
```

Create the R2 bucket:

```bash
npx wrangler r2 bucket create cloudflare-markdown-blog
```

Apply the D1 migration:

```bash
npm run db:migrate:local
npm run db:migrate
```

## Authentik Setup

Create an Authentik OAuth2/OpenID Provider and Application.

Use these redirect URIs:

```text
https://yuna.liugu.cc/auth/callback
```

Set the client id and issuer in `wrangler.toml`:

```toml
[vars]
PUBLIC_BASE_URL = "https://yuna.liugu.cc"
AUTHENTIK_ISSUER = "https://sso.yuna.welain.com/application/o/yuna-docs/"
AUTHENTIK_CLIENT_ID = "..."
AUTHENTIK_REDIRECT_PATH = "/auth/callback"
ADMIN_IDENTITY_ALLOWLIST = ""
```

`ADMIN_IDENTITY_ALLOWLIST` is reserved for a local allowlist if you want one later. The current framework trusts Authentik application access control: any user who can complete the Authentik OIDC flow and returns an email or username can enter the admin panel.

Add secrets locally in `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
```

Then edit:

```text
AUTHENTIK_CLIENT_SECRET=...
SESSION_SECRET=...
```

Set production secrets:

```bash
npx wrangler pages secret put AUTHENTIK_CLIENT_SECRET
npx wrangler pages secret put SESSION_SECRET
npx wrangler pages secret put MIGRATION_TOKEN
```

Use a long random value for `SESSION_SECRET`.

## Local Development

```bash
npm run dev
```

Open:

```text
http://localhost:8788
http://localhost:8788/admin/
```

首页导航会先显示成员登录入口。通过 Authentik 登录后，首页才会显示管理后台入口。后台可以创建、更新、发布、转草稿、删除 Markdown 动态，并支持实时预览、搜索和状态筛选。

## API

Public:

- `GET /api/posts` lists published posts.
- `GET /api/posts/:slug` returns a published post and its Markdown body.

Admin:

- `GET /api/posts?drafts=1` lists all posts.
- `POST /api/posts` creates a post.
- `PUT /api/posts/:slug` updates metadata and Markdown.
- `DELETE /api/posts/:slug` deletes D1 metadata and the R2 Markdown object.
- `POST /api/admin/seed` creates sample posts for testing.
- `PUT /api/admin/media/:path` uploads an image or binary asset to R2.
- `PUT /api/admin/site/:key` updates long-lived site content and writes an incremental D1 backup row.

## Long-Lived Content

Members and hall-of-fame content are not stored in this repository. They live in D1 as structured JSON records; every update writes the previous version to `site_record_backups`.

Normal blog/news posts still use the Markdown editor. Members and hall-of-fame use fixed admin forms so maintainers can add cards without editing raw JSON.

Images are uploaded to R2 and served from `/media/...`. The admin page has an upload panel that returns Markdown such as:

```md
![avatar](/media/avatars/example.png)
```

To migrate existing avatar images from the old repository to R2:

```bash
$env:SITE_BASE_URL="https://yuna.liugu.cc"
$env:MIGRATION_TOKEN="same-value-as-pages-secret"
$env:SOURCE_ROOT='D:\System\Desktop\yuna\yuna.team\docs'
npm run media:migrate
```

Auth:

- `GET /api/auth/login`
- `GET /auth/callback`
- `GET /api/auth/logout`
- `GET /api/auth/me`

## Deploy

For Pages Git integration, set:

- Build command: leave empty or `npm install`
- Build output directory: `public`
- Functions directory: `functions`

Make sure the D1 and R2 bindings in `wrangler.toml` are connected in the Pages project settings, or deploy with Wrangler:

```bash
npm run deploy
```

## Next Hardening Steps

- Replace the tiny browser Markdown renderer with a full CommonMark renderer and sanitizer.
- Add CSRF protection for admin mutation endpoints.
- Add pagination and tags.
- Add image uploads to R2 for post assets.
- Move sessions to Authentik token introspection if you need centralized logout.
