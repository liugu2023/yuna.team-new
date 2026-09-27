// 顶栏登录态、备用账密登录、仅管理员可见的操作，以及全站退出登录。依赖 core.js。

async function renderUserNav() {
  const navs = document.querySelectorAll("[data-user-nav]");
  if (!navs.length) return;

  try {
    const me = await currentUser();
    navs.forEach((nav) => {
      nav.innerHTML = nav.hasAttribute("data-side-nav")
        ? decorateSideNav(userNavHtml(nav, me))
        : userNavHtml(nav, me);
    });
  } catch {
    navs.forEach((nav) => {
      const html = guestNavHtml(nav);
      nav.innerHTML = nav.hasAttribute("data-side-nav") ? decorateSideNav(html) : html;
    });
  }
}

// 备用账密登录(SSO 网关故障时的兜底):提交到 /api/auth/password-login,
// 成功后与 OIDC 登录一样持有会话 Cookie,直接进后台。
function initFallbackLogin() {
  const form = document.querySelector("[data-fallback-login]");
  if (!form) return;
  const message = form.querySelector("[data-fallback-message]");
  const submit = form.querySelector("[data-fallback-submit]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) return;

    if (submit) submit.disabled = true;
    if (message) {
      message.hidden = true;
      message.textContent = "";
    }
    try {
      await fetchJson("/api/auth/password-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      window.location.href = "/admin/";
    } catch (error) {
      if (message) {
        message.textContent = error.message || "登录失败，请稍后再试。";
        message.hidden = false;
      }
      if (submit) submit.disabled = false;
    }
  });
}

async function renderAdminOnlyActions() {
  const nodes = document.querySelectorAll("[data-admin-only]");
  if (!nodes.length) return;

  try {
    const me = await currentUser();
    nodes.forEach((node) => {
      node.hidden = !me.admin;
    });
  } catch {
    nodes.forEach((node) => {
      node.hidden = true;
    });
  }
}

function userNavHtml(nav, me) {
  if (me.admin) {
    return '<a class="nav-link nav-admin" href="/admin/">管理后台</a><button type="button" class="nav-link nav-logout" data-logout>退出登录</button>';
  }
  if (me.authenticated) return '<button type="button" class="nav-link nav-logout" data-logout>退出登录</button>';
  return guestNavHtml(nav);
}

function guestNavHtml(nav) {
  const label = nav.dataset.loginLabel || "成员登录";
  const href = nav.dataset.loginHref || (label === "后台入口" ? "/admin-login.html" : loginHref());
  return `<a class="nav-link nav-login" href="${href}">${escapeHtml(label)}</a>`;
}

function loginHref() {
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return `/api/auth/login?return_to=${encodeURIComponent(returnTo || "/")}`;
}

function decorateSideNav(html) {
  return html.replaceAll('class="nav-link ', 'class="side-link ');
}

// 登出通过 POST 提交，配合后端只接受 POST 的 /api/auth/logout，防 CSRF 强制登出。
async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    location.href = "/";
  }
}

document.addEventListener("click", (event) => {
  const trigger = event.target instanceof Element ? event.target.closest("[data-logout]") : null;
  if (!trigger) return;
  event.preventDefault();
  logout();
});

Object.assign(window.blog, {
  renderUserNav,
  initFallbackLogin,
  renderAdminOnlyActions,
});
