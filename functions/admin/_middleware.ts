import { getSession, isAllowedAdmin } from "../_shared/session";
import type { Env } from "../_shared/types";

export const onRequest: PagesFunction<Env> = async ({ env, request, next }) => {
  const session = await getSession(env, request);

  // 未登录才跳登录。已登录但无权限不能再跳登录，否则会和回调形成无限循环。
  if (!session) {
    const url = new URL("/api/auth/login", request.url);
    return Response.redirect(url.toString(), 302);
  }

  if (!isAllowedAdmin(env, session)) {
    return new Response(forbiddenPage(), {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return next();
};

function forbiddenPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>无访问权限 · 燕山大学大学生网络信息协会</title>
    <link rel="icon" href="/logo.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header class="topbar">
      <div class="shell">
        <a class="brand" href="/"><img src="/logo.svg" alt="YUNA" />YUNA</a>
        <nav class="nav">
          <span data-user-nav><a class="nav-link nav-login" href="/api/auth/login">成员登录</a></span>
        </nav>
      </div>
    </header>
    <main class="page">
      <div class="shell">
        <article class="article">
          <h1>403 · 没有后台管理权限</h1>
          <p class="meta">你已登录，但当前账号不在控制组中。</p>
          <p>后台管理仅对控制组（CONTROL_GROUP）成员开放。如果你认为这是误判，请联系管理员把你的账号加入该组。</p>
          <p>
            <a class="hero-link" href="/">返回首页</a>
          </p>
        </article>
      </div>
    </main>
    <footer class="site-footer">
      <div class="footer-inner">
        <div>
          <strong>YUNA</strong>
          <span>燕山大学大学生网络信息协会</span>
        </div>
      </div>
    </footer>
    <script src="/app.js"></script>
    <script>
      window.blog.renderUserNav();
    </script>
  </body>
</html>`;
}
