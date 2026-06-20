async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
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
  let listTag = "";
  let quote = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const content = paragraph
      .map((line) => {
        const hasBreak = /\s{2,}$/.test(line);
        return `${inlineMarkdown(escapeHtml(line.trimEnd()))}${hasBreak ? "<br>" : ""}`;
      })
      .join(" ");
    html.push(`<p>${content}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listTag) return;
    html.push(`</${listTag}>`);
    listTag = "";
  }

  function flushQuote() {
    if (quote.length === 0) return;
    html.push(`<blockquote>${quote.map((line) => `<p>${line}</p>`).join("")}</blockquote>`);
    quote = [];
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        flushParagraph();
        flushQuote();
        closeList();
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
      flushQuote();
      continue;
    }

    if (line.trim() === "---") {
      flushParagraph();
      closeList();
      flushQuote();
      html.push("<hr>");
      continue;
    }

    const quoteLine = line.match(/^>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      closeList();
      const content = quoteLine[1].trim();
      const admonitions = {
        "[!NOTE]": "提示",
        "[!IMPORTANT]": "重要",
        "[!WARNING]": "注意",
      };
      quote.push(admonitions[content] ? `<strong>${admonitions[content]}</strong>` : inlineMarkdown(escapeHtml(content)));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      flushQuote();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const unorderedItem = line.match(/^\s*-\s+(.*)$/);
    const orderedItem = line.match(/^\s*\d+\.\s+(.*)$/);
    const listItem = unorderedItem || orderedItem;
    if (listItem) {
      flushParagraph();
      flushQuote();
      const nextTag = unorderedItem ? "ul" : "ol";
      if (listTag && listTag !== nextTag) closeList();
      if (!listTag) {
        html.push(`<${nextTag}>`);
        listTag = nextTag;
      }
      html.push(`<li>${inlineMarkdown(escapeHtml(listItem[1]))}</li>`);
      continue;
    }

    closeList();
    flushQuote();
    paragraph.push(line.trimStart());
  }

  flushParagraph();
  closeList();
  flushQuote();
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
    .replace(/~~(.*?)~~/g, "<del>$1</del>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, label, href) => {
        const safeHref = href.startsWith("http") || href.startsWith("/") || href.startsWith("mailto:")
          ? normalizeInternalHref(href)
          : `/page.html?p=${href.replace(/^\.\//, "").replace(/\.html$/, "").replace(/\.md$/, "")}`;
        const rel = safeHref.startsWith("http") ? ' rel="noreferrer"' : "";
        const target = safeHref.startsWith("http") ? ' target="_blank"' : "";
        return `<a href="${safeHref}"${target}${rel}>${label}</a>`;
      },
    );
}

function normalizeInternalHref(href) {
  if (!href.startsWith("/") || href.startsWith("/page.html") || href.startsWith("/post.html") || href.startsWith("/media/")) {
    return href;
  }

  const legacyPage = href.match(/^\/(about-us|lessons|join-us)\/(.+)\.html$/);
  if (legacyPage) {
    return `/page.html?p=${legacyPage[1]}/${legacyPage[2]}`;
  }

  return href;
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
      if (featureGrid && !admin) {
        featureGrid.innerHTML = renderCampusFallbackCards();
      }
      list.innerHTML = '<p class="empty">暂无文章。</p>';
      return;
    }

    if (featureGrid && !admin) {
      const featuredPosts = data.posts.slice(0, 3);
      featureGrid.innerHTML = featuredPosts
        .map(
          (post, index) => `
            <a class="feature-card${index === 0 ? " is-lead" : ""}" href="/post.html?slug=${encodeURIComponent(post.slug)}">
              <p class="meta">${index === 0 ? "最新" : "动态"} · ${formatDate(post.published_at || post.updated_at)}</p>
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
          <article class="post-card feed-card">
            <p class="meta">${post.status === "published" ? "已发布" : "草稿"} · ${formatDate(post.published_at || post.updated_at)}</p>
            <h2><a href="${admin ? `/admin/?slug=${encodeURIComponent(post.slug)}` : `/post.html?slug=${encodeURIComponent(post.slug)}`}">${escapeHtml(post.title)}</a></h2>
            <p>${escapeHtml(post.excerpt || "")}</p>
          </article>
        `,
      )
      .join("");
  } catch (error) {
    if (featureGrid && !admin) {
      featureGrid.innerHTML = renderCampusFallbackCards();
    }
    list.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function renderCampusFallbackCards() {
  return `
    <a class="feature-card is-lead" href="/page.html?p=about-us/index">
      <p class="meta">协会介绍</p>
      <h2>燕山大学大学生网络信息协会</h2>
      <p>了解协会方向、部门职责和技术社群氛围。</p>
    </a>
    <a class="feature-card" href="/page.html?p=lessons/index">
      <p class="meta">授课资料</p>
      <h2>部门课程整理</h2>
      <p>查看开发、网安、运维、组宣和秘书处课程资料。</p>
    </a>
    <a class="feature-card" href="/page.html?p=join-us/how-to">
      <p class="meta">加入我们</p>
      <h2>招新与面试安排</h2>
      <p>查看报名流程、笔试说明和面试信息。</p>
    </a>
  `;
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

  if (record.key === "members") {
    return renderMembersRecord(record, items);
  }

  return `
    <div class="article-body">
      <h1>${escapeHtml(record.title)}</h1>
      <div class="profile-grid">
        ${items.map(renderProfileCard).join("")}
      </div>
    </div>
  `;
}

function renderMembersRecord(record, items) {
  const terms = [...new Set(items.map((item) => item.term || "未填写届数"))];
  const activeTerm = terms[0];
  return `
    <div class="article-body">
      <h1>${escapeHtml(record.title)}</h1>
      <label class="inline-control">
        届数
        <select data-term-switch>
          ${terms.map((term) => `<option value="${escapeHtml(term)}">${escapeHtml(term)}</option>`).join("")}
        </select>
      </label>
      <div data-term-panels>
        ${terms.map((term) => renderMemberTerm(term, items.filter((item) => (item.term || "未填写届数") === term), term === activeTerm)).join("")}
      </div>
    </div>
  `;
}

function renderMemberTerm(term, items, active) {
  const departments = ["主席团", "开发部", "网络安全部", "运维部", "组宣部", "秘书处"];
  return `
    <section data-term-panel="${escapeHtml(term)}" ${active ? "" : "hidden"}>
      ${departments
        .map((department) => {
          const departmentItems = items.filter((item) => (item.department || "未分组") === department);
          if (!departmentItems.length) return "";
          return `
            <h2>${escapeHtml(department)}</h2>
            <div class="profile-grid">
              ${departmentItems.map(renderProfileCard).join("")}
            </div>
          `;
        })
        .join("")}
    </section>
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

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-term-switch]")) return;
  const term = event.target.value;
  document.querySelectorAll("[data-term-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.termPanel !== term;
  });
});

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
