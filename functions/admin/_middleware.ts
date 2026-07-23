import { getSession, isAllowedAdmin } from "../_shared/session";
import type { Env } from "../_shared/types";

export const onRequest: PagesFunction<Env> = async ({ env, request, next }) => {
  const session = await getSession(env, request);

  // 未登录才跳登录。已登录但无权限不能再跳登录，否则会和回调形成无限循环。
  if (!session) {
    const currentUrl = new URL(request.url);
    const url = new URL("/api/auth/login", request.url);
    url.searchParams.set("return_to", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
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
    <a class="skip-link" href="#content">跳到主要内容</a>
    <div class="scroll-progress" id="scrollProgress"></div>
    <div class="cursor-ring" id="cursorRing"></div>
    <div class="cursor-glow" id="cursorGlow"></div>
    <canvas class="particle-canvas" id="particleCanvas"></canvas>
    <div class="aurora-layer"></div>
    <header class="topbar">
      <div class="shell topbar-inner">
        <a class="brand magnetic" href="/"><span>YUNA.ADMIN</span></a>
        <nav class="nav" aria-label="站点导航">
          <a href="/">首页</a>
          <a href="/articles.html">文章列表</a>
          <a href="https://docs.yuna.team/">知识库</a>
          <a href="/team.html">关于协会</a>
          <span data-user-nav data-login-label="后台入口"><a href="/admin-login.html">后台入口</a></span>
        </nav>
      </div>
    </header>
    <div class="page-wrap">
      <div class="hero-bg" id="heroBg"></div>
      <div class="mist-top"></div>
      <div class="mist-bottom"></div>
      <div class="grid-overlay"></div>
      <section class="shell page-hero">
        <div class="reveal">
          <p class="eyebrow">Access Denied</p>
          <h1>403 · 没有后台管理权限。</h1>
          <p class="lead">你已登录，但当前账号没有配置的 Zitadel 项目角色。后台管理仅对 CONTROL_GROUP 对应角色开放。</p>
          <div class="hero-actions">
            <a class="btn primary magnetic" href="/">返回首页</a>
            <a class="btn secondary magnetic" href="/admin-login.html">后台入口</a>
          </div>
        </div>
        <div class="page-visual reveal" aria-hidden="true">
          <div class="tech-sweep"></div>
          <div class="logo-holo-grid"></div>
          <div class="scanlines"></div>
          <div class="tech-web"></div>
          <div class="visual-lines"></div>
          <span class="pulse-ring p1"></span>
          <span class="pulse-ring p2"></span>
          <span class="pulse-ring p3"></span>
          <span class="ring r1"></span>
          <span class="ring r2"></span>
          <div class="visual-orb"><img src="/images/logo.svg" alt="YUNA" /></div>
          <span class="tech-pill pill-a">Admin</span>
          <span class="tech-pill pill-b">Access</span>
          <span class="tech-pill pill-c">Denied</span>
          <div class="data-stream"><span>YUNA · ADMIN ACCESS · CONTROL GROUP ·</span><span>IDENTITY · PERMISSION · AUDIT ·</span></div>
        </div>
      </section>
    </div>
    <main class="main page-main" id="content">
      <section class="shell">
        <article class="article-body reveal">
          <h2>权限说明</h2>
          <p>如果你认为这是误判，请联系管理员为账号分配对应的 Zitadel 项目角色，然后退出并重新登录。</p>
        </article>
      </section>
    </main>
    <footer class="shell footer"><span>YUNA.ADMIN · 无访问权限</span><span>成员权限校验</span></footer>
    <script src="/app.js"></script>
    <script>
      window.blog.renderUserNav();
    </script>
    <script src="/yuna-ui.js"></script>
  </body>
</html>`;
}
