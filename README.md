# Cloudflare Markdown Blog

A Cloudflare Pages + Pages Functions blog framework using:

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

Posts are split intentionally:

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
ADMIN_EMAIL_ALLOWLIST = "admin@example.com"
```

`ADMIN_EMAIL_ALLOWLIST` is optional. If it is empty, any Authentik user with a verified OIDC email can enter the admin panel. For production, set it to a comma-separated list of admin emails.

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

The admin page redirects through Authentik. After login, it can create, update, publish, and delete Markdown posts.

## API

Public:

- `GET /api/posts` lists published posts.
- `GET /api/posts/:slug` returns a published post and its Markdown body.

Admin:

- `GET /api/posts?drafts=1` lists all posts.
- `POST /api/posts` creates a post.
- `PUT /api/posts/:slug` updates metadata and Markdown.
- `DELETE /api/posts/:slug` deletes D1 metadata and the R2 Markdown object.

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
