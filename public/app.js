async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function formatDate(value) {
  if (!value) return "未发布";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

function markdownToHtml(markdown) {
  const lines = stripFrontmatter(markdown).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inCode = false;
  let paragraph = [];
  let inList = false;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineMarkdown(escapeHtml(paragraph.join(" ")))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!inList) return;
    html.push("</ul>");
    inList = false;
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        flushParagraph();
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    if (line.trim() === "---") {
      flushParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(escapeHtml(listItem[1]))}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function inlineMarkdown(html) {
  return html
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
      const safeSrc = normalizeAssetUrl(src);
      return `<img src="${safeSrc}" alt="${alt}" loading="lazy">`;
    })
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, label, href) => {
        const safeHref = href.startsWith("http") || href.startsWith("/") || href.startsWith("mailto:")
          ? href
          : `/page.html?p=${href.replace(/^\.\//, "").replace(/\.html$/, "").replace(/\.md$/, "")}`;
        const rel = safeHref.startsWith("http") ? ' rel="noreferrer"' : "";
        const target = safeHref.startsWith("http") ? ' target="_blank"' : "";
        return `<a href="${safeHref}"${target}${rel}>${label}</a>`;
      },
    );
}

function normalizeAssetUrl(value) {
  if (value.startsWith("http") || value.startsWith("/media/") || value.startsWith("/logo")) {
    return value;
  }
  if (value.startsWith("/avatars/")) return value.replace("/avatars/", "/media/avatars/");
  return value;
}

async function renderPostList({ admin = false } = {}) {
  const list = document.querySelector("[data-post-list]");
  const featureGrid = document.querySelector("[data-feature-grid]");
  if (!list) return;

  try {
    const data = await fetchJson(`/api/posts${admin ? "?drafts=1" : ""}`);
    if (!data.posts.length) {
      list.innerHTML = '<p class="empty">暂无文章。</p>';
      return;
    }

    if (featureGrid && !admin) {
      featureGrid.innerHTML = data.posts
        .slice(0, 3)
        .map(
          (post) => `
            <a class="feature-card" href="/post.html?slug=${post.slug}">
              <p class="meta">${formatDate(post.published_at || post.updated_at)}</p>
              <h2>${escapeHtml(post.title)}</h2>
              <p>${escapeHtml(post.excerpt || "")}</p>
            </a>
          `,
        )
        .join("");
    }

    list.innerHTML = data.posts
      .map(
        (post) => `
          <article class="post-card">
            <p class="meta">${post.status === "published" ? "已发布" : "草稿"} · ${formatDate(post.published_at || post.updated_at)}</p>
            <h2><a href="${admin ? `/admin/?slug=${post.slug}` : `/post.html?slug=${post.slug}`}">${escapeHtml(post.title)}</a></h2>
            <p>${escapeHtml(post.excerpt || "")}</p>
          </article>
        `,
      )
      .join("");
  } catch (error) {
    list.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function renderUserNav() {
  const navs = document.querySelectorAll("[data-user-nav]");
  if (!navs.length) return;

  try {
    const me = await fetchJson("/api/auth/me");
    const html = me.admin
      ? '<a href="/admin/">管理后台</a><a href="/api/auth/logout">退出登录</a>'
      : '<a href="/api/auth/login">成员登录</a>';
    navs.forEach((nav) => {
      nav.innerHTML = nav.hasAttribute("data-side-nav")
        ? decorateSideNav(html)
        : html;
    });
  } catch {
    navs.forEach((nav) => {
      const html = '<a href="/api/auth/login">成员登录</a>';
      nav.innerHTML = nav.hasAttribute("data-side-nav") ? decorateSideNav(html) : html;
    });
  }
}

function decorateSideNav(html) {
  return html.replaceAll("<a ", '<a class="side-link" ');
}

async function renderPost() {
  const article = document.querySelector("[data-article]");
  if (!article) return;

  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) {
    article.innerHTML = '<p class="error">缺少文章链接标识。</p>';
    return;
  }

  try {
    const data = await fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
    document.title = `${data.post.title} · 燕山大学大学生网络信息协会`;
    article.innerHTML = `
      <p class="meta">${formatDate(data.post.published_at || data.post.updated_at)}</p>
      <h1>${escapeHtml(data.post.title)}</h1>
      <div class="article-body">${markdownToHtml(data.markdown)}</div>
    `;
  } catch (error) {
    article.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function renderStaticPage() {
  const container = document.querySelector("[data-static-page]");
  if (!container) return;

  const params = new URLSearchParams(location.search);
  const recordKey = params.get("record");
  if (recordKey) {
    await renderSiteRecord(container, recordKey);
    return;
  }

  const page = params.get("p") || "about-us/index";
  if (!/^[a-z0-9/_-]+$/i.test(page)) {
    container.innerHTML = '<p class="error">页面路径无效。</p>';
    return;
  }

  try {
    const response = await fetch(`/content/${page}.md`);
    if (!response.ok) throw new Error("页面不存在");
    const markdown = await response.text();
    const title = firstHeading(markdown) || "页面";
    document.title = `${title} · 燕山大学大学生网络信息协会`;
    container.innerHTML = `<div class="article-body">${markdownToHtml(markdown)}</div>`;
  } catch (error) {
    container.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function renderSiteRecord(container, key) {
  if (!/^[a-z0-9_-]+$/i.test(key)) {
    container.innerHTML = '<p class="error">内容标识无效。</p>';
    return;
  }

  try {
    const data = await fetchJson(`/api/site/${key}`);
    document.title = `${data.record.title} · 燕山大学大学生网络信息协会`;
    container.innerHTML =
      data.record.kind === "json"
        ? renderStructuredRecord(data.record)
        : `<div class="article-body">${markdownToHtml(data.record.content)}</div>`;
  } catch (error) {
    container.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function renderStructuredRecord(record) {
  const items = JSON.parse(record.content || "[]");
  if (!items.length) return '<p class="empty">暂无内容。</p>';

  const groups = new Map();
  for (const item of items) {
    const group = item.group || "未分组";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }

  return `
    <div class="article-body">
      <h1>${escapeHtml(record.title)}</h1>
      ${Array.from(groups.entries())
        .map(
          ([group, groupItems]) => `
            <h2>${escapeHtml(group)}</h2>
            <div class="profile-grid">
              ${groupItems.map(renderProfileCard).join("")}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderProfileCard(item) {
  const links = Array.isArray(item.links) ? item.links : [];
  return `
    <article class="profile-card">
      ${item.avatar ? `<img src="${normalizeAssetUrl(escapeHtml(item.avatar))}" alt="${escapeHtml(item.name)}" loading="lazy">` : ""}
      <div>
        <h3>${escapeHtml(item.name || "")}</h3>
        ${item.title ? `<p class="meta">${escapeHtml(item.title)}</p>` : ""}
        ${item.desc ? `<p>${escapeHtml(item.desc)}</p>` : ""}
        ${
          links.length
            ? `<p>${links
                .map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label || link.url)}</a>`)
                .join(" · ")}</p>`
            : ""
        }
      </div>
    </article>
  `;
}

function firstHeading(markdown) {
  const match = stripFrontmatter(markdown).match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

window.blog = {
  fetchJson,
  formatDate,
  escapeHtml,
  markdownToHtml,
  renderPostList,
  renderPost,
  renderUserNav,
  renderStaticPage,
};
