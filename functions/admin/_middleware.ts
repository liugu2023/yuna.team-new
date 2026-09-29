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
    <meta name="robots" content="noindex" />
    <title>无访问权限 · 燕山大学大学生网络信息协会</title>
    <link rel="icon" href="/images/logo.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles/tokens.css" />
    <link rel="stylesheet" href="/styles/base.css" />
    <link rel="stylesheet" href="/styles/components.css" />
    <link rel="stylesheet" href="/styles/layout.css" />
    <link rel="stylesheet" href="/styles/fx.css" />
    <link rel="stylesheet" href="/styles/pages/login.css" />
    <script>document.documentElement.classList.add("js");</script>
  </head>
  <body class="page-403">
    <a class="skip-link" href="#content">跳到正文</a>
    <header class="topbar">
      <div class="shell topbar-inner">
        <a class="brand" href="/"><img src="/images/logo.svg" alt="" /><span>YUNA.BLOG</span></a>
        <nav class="nav" aria-label="站点导航">
          <a href="/">首页</a>
          <a href="/articles.html">文章列表</a>
          <a href="https://docs.yuna.team/" target="_blank" rel="noopener">知识库</a>
          <a href="/lesson-plan.html">授课计划</a>
          <a href="/projects.html">协会项目</a>
          <a href="/team.html">关于协会</a>
          <span data-user-nav data-login-label="后台入口"><a href="/admin-login.html">后台入口</a></span>
        </nav>
      </div>
    </header>
    <main class="login-stage forbidden-stage" id="content">
      <div class="fx-dots login-dots" aria-hidden="true"></div>
      <div class="fx-glow login-glow-a" aria-hidden="true"></div>
      <div class="login-center">
        <section class="forbidden-card reveal is-scale">
          <p class="forbidden-code" aria-hidden="true">403</p>
          <h1>这扇门暂时没为你打开</h1>
          <p class="lead">你已经登录，但当前账号还没有后台管理权限。如果这是误会，请联系管理员分配对应的项目角色，然后退出重新登录。</p>
          <div class="forbidden-actions">
            <a class="btn primary" href="/">返回首页<span class="arrow" aria-hidden="true"></span></a>
            <a class="btn secondary" href="/admin-login.html">回到后台入口</a>
          </div>
        </section>
      </div>
    </main>
    <footer class="site-footer">
      <div class="shell site-footer-main">
        <div class="site-footer-brand">
          <a class="brand" href="/"><img src="/images/logo.svg" alt="" /><span>YUNA.BLOG</span></a>
          <p>燕山大学大学生网络信息协会。学习、实践、分享，把技术热情变成看得见的作品。</p>
        </div>
        <nav class="site-footer-nav" aria-label="页脚导航">
          <div>
            <h2>内容</h2>
            <a href="/articles.html">文章列表</a>
            <a href="https://docs.yuna.team/" target="_blank" rel="noopener">知识库</a>
            <a href="/lesson-plan.html">授课计划</a>
          </div>
          <div>
            <h2>协会</h2>
            <a href="/team.html">关于协会</a>
            <a href="/departments.html">部门介绍</a>
            <a href="/join.html">加入我们</a>
          </div>
          <div>
            <h2>部门</h2>
            <a href="/department-dev.html">开发部</a>
            <a href="/department-ops.html">运维部</a>
            <a href="/department-publicity.html">组宣部</a>
            <a href="/department-security.html">网络安全部</a>
          </div>
        </nav>
      </div>
      <div class="shell footer">
        <span>YUNA.ADMIN · 无访问权限</span>
        <span>成员权限校验</span>
      </div>
    </footer>
    <script src="/js/core.js"></script>
    <script src="/js/markdown.js"></script>
    <script src="/js/nav.js"></script>
    <script src="/js/footer.js"></script>
    <script>
      window.blog.renderUserNav();
    </script>
    <script src="/yuna-ui.js"></script>
  </body>
</html>`;
}
