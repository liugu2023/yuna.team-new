async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

let currentUserPromise;
const DIRECT_MEDIA_UPLOAD_LIMIT = 8 * 1024 * 1024;
const HOME_NOTICE_KEY = "homepage-notice";
const DEFAULT_HOME_NOTICE = {
  title: "协会公告",
  markdown: "招新答疑开放中，欢迎同学了解开发、安全、运维和组宣方向。",
};

async function currentUser() {
  if (!currentUserPromise) {
    currentUserPromise = fetchJson("/api/auth/me").catch((error) => {
      currentUserPromise = null;
      throw error;
    });
  }
  return currentUserPromise;
}

function formatDate(value) {
  if (!value) return "未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间无效";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function viewCount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function formatViews(value) {
  return `${viewCount(value).toLocaleString("zh-CN")} 次阅读`;
}

function postTag(post) {
  const tag = String(post?.tag || "").trim();
  return tag || "未分类";
}

function postTags(posts) {
  const seen = new Set();
  const tags = [];
  for (const post of posts) {
    const tag = postTag(post);
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function postTagCounts(posts) {
  const counts = new Map();
  for (const post of posts) {
    const tag = postTag(post);
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag, "zh-CN"));
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

  const markdownAsset = href.split(/[?#]/, 1)[0].match(/^\/(.+)\.md$/i);
  if (markdownAsset) {
    return `/media/${markdownAsset[1]}.md`;
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

// 只允许安全协议的链接，阻断 javascript:/data: 等点击型 XSS。
// 后台填入的成员/名人堂联系方式会经过这里再渲染。
function safeLinkUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") || raw.startsWith("#")) return raw;
  if (/^(https?:|mailto:)/i.test(raw)) return raw;
  return "";
}

async function renderPostList({ admin = false } = {}) {
  const lists = Array.from(document.querySelectorAll("[data-post-list]"));
  const featureGrid = document.querySelector("[data-feature-grid]");
  if (!lists.length) return;

  try {
    const data = await fetchJson(`/api/posts${admin ? "?drafts=1" : ""}`);
    if (!admin) renderHomePostTabs(data.posts);
    if (featureGrid && !admin && data.posts.length) {
      const featuredPosts = data.posts.slice(0, 3);
      featureGrid.innerHTML = featuredPosts
        .map(
          (post, index) => `
            <a class="resource-card reveal visible${index === 0 ? " is-lead" : ""}" href="/post.html?slug=${encodeURIComponent(post.slug)}">
              <span class="flash"></span>
              <p class="meta">${index === 0 ? "最新" : "动态"} · ${formatDate(post.published_at || post.updated_at)} · ${formatViews(post.view_count)}</p>
              <h2>${escapeHtml(post.title)}</h2>
              <p>${escapeHtml(post.excerpt || "")}</p>
            </a>
          `,
        )
        .join("");
    }

    if (!data.posts.length && featureGrid && !admin) featureGrid.innerHTML = "";
    if (!admin) renderPostTagStats(data.posts);
    lists.forEach((list) => renderPostListInto(list, data.posts, admin));
    bindArticleFilters();
  } catch (error) {
    if (featureGrid && !admin) featureGrid.innerHTML = "";
    lists.forEach((list) => {
      list.innerHTML = `<p class="empty-state error">${escapeHtml(error.message)}</p>`;
    });
    renderPostTagStats([]);
  }
}

function renderHomePostTabs(posts) {
  const tabs = document.querySelector("[data-home-post-tabs]");
  if (!tabs) return;

  const tags = postTags(posts);
  const selected = tags.includes(tabs.dataset.selectedTag) ? tabs.dataset.selectedTag : "all";
  tabs.dataset.selectedTag = selected;
  tabs.innerHTML = [
    `<button class="tab${selected === "all" ? " active" : ""}" type="button" data-home-post-tag="all">全部文章</button>`,
    ...tags.map((tag) => (
      `<button class="tab${selected === tag ? " active" : ""}" type="button" data-home-post-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
    )),
  ].join("");

  tabs.querySelectorAll("[data-home-post-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      tabs.dataset.selectedTag = button.dataset.homePostTag || "all";
      tabs.querySelectorAll("[data-home-post-tag]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      document.querySelectorAll('[data-post-list][data-post-list-mode="home"]').forEach((list) => {
        renderPostListInto(list, posts, false);
      });
    });
  });
}

function selectedHomePostTag() {
  return document.querySelector("[data-home-post-tabs]")?.dataset.selectedTag || "all";
}

function renderPostTagStats(posts) {
  const lists = document.querySelectorAll("[data-post-tag-stats]");
  if (!lists.length) return;

  const tagCounts = postTagCounts(posts);
  lists.forEach((list) => {
    if (!tagCounts.length) {
      list.innerHTML = '<p class="empty-state">暂无标签。</p>';
      return;
    }

    const selectedTag = new URLSearchParams(location.search).get("tag") || "";
    list.innerHTML = tagCounts
      .map(({ tag, count }) => {
        const active = selectedTag === tag ? ' class="active"' : "";
        return `
          <a href="/articles.html?tag=${encodeURIComponent(tag)}"${active}>
            ${escapeHtml(tag)}
            <span>${count.toLocaleString("zh-CN")} 篇</span>
          </a>
        `;
      })
      .join("");
  });
}

function renderPostListInto(list, posts, admin) {
  const mode = list.dataset.postListMode || (admin ? "admin" : "cards");
  if (!posts.length) {
    list.innerHTML = '<p class="empty-state">暂无文章。</p>';
    return;
  }

  if (mode === "compact") {
    const hotPosts = [...posts].sort((left, right) => {
      const views = viewCount(right.view_count) - viewCount(left.view_count);
      if (views) return views;
      return new Date(right.published_at || right.updated_at || 0) - new Date(left.published_at || left.updated_at || 0);
    });

    list.innerHTML = hotPosts
      .slice(0, 3)
      .map(
        (post) => `
          <a href="/post.html?slug=${encodeURIComponent(post.slug)}">
            ${escapeHtml(post.title)}
            <span>${formatViews(post.view_count)} · ${formatDate(post.published_at || post.updated_at)}</span>
          </a>
        `,
      )
      .join("");
    return;
  }

  if (mode === "home") {
    const selectedTag = selectedHomePostTag();
    const homePosts = selectedTag === "all"
      ? posts
      : posts.filter((post) => postTag(post) === selectedTag);

    if (!homePosts.length) {
      list.innerHTML = `<p class="empty-state">暂无${selectedTag === "all" ? "" : escapeHtml(selectedTag)}文章。</p>`;
      return;
    }

    list.innerHTML = homePosts
      .slice(0, 3)
      .map(
        (post) => `
          <article class="card reveal visible">
            <span class="flash"></span>
            <div class="meta"><span>${formatDate(post.published_at || post.updated_at)}</span><span>${post.status === "published" ? "已发布" : "草稿"}</span><span>${formatViews(post.view_count)}</span></div>
            <h2><a href="/post.html?slug=${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
            <p>${escapeHtml(post.excerpt || "")}</p>
            <div class="card-footer">
              <span class="tag">${escapeHtml(postTag(post))}</span>
              <a class="read-more" href="/post.html?slug=${encodeURIComponent(post.slug)}">阅读全文 →</a>
            </div>
          </article>
        `,
      )
      .join("");
    return;
  }

  list.innerHTML = posts
    .map(
      (post) => `
        <article class="card article-card reveal visible" data-article-card data-status="${escapeHtml(post.status)}" data-tag="${escapeHtml(postTag(post))}">
          <span class="flash"></span>
          <div class="article-cover"></div>
          <div class="article-head">
            <div class="meta"><span>${formatDate(post.published_at || post.updated_at)}</span><span>${post.status === "published" ? "已发布" : "草稿"}</span><span>${formatViews(post.view_count)}</span></div>
            <span class="tag">${post.status === "published" ? "已发布" : "草稿"}</span>
          </div>
          <h2><a href="${admin ? `/admin/?slug=${encodeURIComponent(post.slug)}` : `/post.html?slug=${encodeURIComponent(post.slug)}`}">${escapeHtml(post.title)}</a></h2>
          <p>${escapeHtml(post.excerpt || "")}</p>
          <div class="card-footer">
            <a class="read-more" href="${admin ? `/admin/?slug=${encodeURIComponent(post.slug)}` : `/post.html?slug=${encodeURIComponent(post.slug)}`}">阅读全文 →</a>
            <span class="tag">${escapeHtml(postTag(post))}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function bindArticleFilters() {
  const cards = Array.from(document.querySelectorAll("[data-article-card]"));
  if (!cards.length) return;

  const search = document.querySelector("[data-article-search]");
  const status = document.querySelector("[data-article-status]");
  const empty = document.querySelector("[data-article-empty]");
  const selectedTag = new URLSearchParams(location.search).get("tag") || "";
  const filter = () => {
    const keyword = (search?.value || "").trim().toLowerCase();
    const statusValue = status?.value || "all";
    let visible = 0;
    cards.forEach((card) => {
      const matchesText = !keyword || card.textContent.toLowerCase().includes(keyword);
      const matchesStatus = statusValue === "all" || card.dataset.status === statusValue;
      const matchesTag = !selectedTag || card.dataset.tag === selectedTag;
      const show = matchesText && matchesStatus && matchesTag;
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (empty) empty.hidden = visible > 0;
  };

  if (search && !search.dataset.boundArticleFilter) {
    search.dataset.boundArticleFilter = "1";
    search.addEventListener("input", filter);
  }
  if (status && !status.dataset.boundArticleFilter) {
    status.dataset.boundArticleFilter = "1";
    status.addEventListener("change", filter);
  }
  filter();
}

async function renderHomeHero() {
  const hero = document.querySelector("[data-home-hero]");
  if (!hero) return;

  try {
    const data = await fetchJson("/api/site/homepage-gallery");
    const items = JSON.parse(data.record.content || "[]");
    if (!Array.isArray(items) || !items.length) return;

    const active = items.find((item) => item.active) || items[0];
    if (!active?.url) return;

    const target = hero.querySelector(".hero-bg") || hero;
    target.style.backgroundImage = `url("${normalizeAssetUrl(active.url)}")`;
    hero.classList.add("has-background");
  } catch {
    hero.classList.remove("has-background");
  }
}

async function renderHomeNotice() {
  const card = document.querySelector("[data-home-notice]");
  if (!card) return;

  const noticeState = { ...DEFAULT_HOME_NOTICE };
  try {
    const data = await fetchJson(`/api/site/${HOME_NOTICE_KEY}`);
    if (data.record?.kind === "markdown") {
      noticeState.title = data.record.title || DEFAULT_HOME_NOTICE.title;
      noticeState.markdown = data.record.content || DEFAULT_HOME_NOTICE.markdown;
    }
  } catch {
    // Missing records are fine: the homepage keeps the built-in default notice.
  }

  renderHomeNoticeCard(card, noticeState);
  await attachHomeNoticeEditor(card, noticeState);
}

function renderHomeNoticeCard(card, noticeState) {
  const title = card.querySelector("[data-home-notice-title]");
  const content = card.querySelector("[data-home-notice-content]");
  if (title) title.textContent = noticeState.title || DEFAULT_HOME_NOTICE.title;
  if (content) content.innerHTML = markdownToHtml(noticeState.markdown || DEFAULT_HOME_NOTICE.markdown);
}

async function attachHomeNoticeEditor(card, noticeState) {
  let me;
  try {
    me = await currentUser();
  } catch {
    return;
  }
  if (!me.admin) return;

  const actions = card.querySelector("[data-home-notice-actions]");
  if (!actions) return;

  actions.hidden = false;
  actions.innerHTML = '<button type="button" class="btn secondary" data-edit-home-notice>编辑公告</button>';
  actions.querySelector("[data-edit-home-notice]").addEventListener("click", () => {
    openStaticPageEditor(
      {
        page: HOME_NOTICE_KEY,
        title: noticeState.title,
        markdown: noticeState.markdown,
        editorTitle: "编辑协会公告",
        editorHelper: "保存后会更新首页右侧公告。",
        uploadScope: `site/${HOME_NOTICE_KEY}`,
        save: ({ title, markdown }) => saveSiteMarkdownRecord(HOME_NOTICE_KEY, title, markdown),
      },
      (nextState) => {
        noticeState.title = nextState.title;
        noticeState.markdown = nextState.markdown;
        renderHomeNoticeCard(card, noticeState);
      },
    );
  });
}

function saveSiteMarkdownRecord(key, title, markdown) {
  return fetchJson(`/api/admin/site/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      kind: "markdown",
      content: markdown,
    }),
  });
}

function saveSiteJsonRecord(key, title, content) {
  return fetchJson(`/api/admin/site/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      kind: "json",
      content: JSON.stringify(content),
    }),
  });
}

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

async function renderEditableBlocks() {
  const blocks = Array.from(document.querySelectorAll("[data-editable-block]"));
  if (!blocks.length) return;

  await Promise.all(blocks.map(loadEditableBlockRecord));
  await attachEditableBlockEditors(blocks);
}

async function loadEditableBlockRecord(block) {
  const key = block.dataset.editableBlock;
  if (!key || block.dataset.editableLoaded) return;
  block.classList.add("editable-block");

  try {
    const data = await fetchJson(`/api/site/${encodeURIComponent(key)}`);
    if (data.record?.kind !== "json") return;
    const content = JSON.parse(data.record.content || "{}");
    applyEditableBlockState(block, content);
  } catch {
    // Missing records keep the built-in HTML copy until an admin saves them.
  } finally {
    block.dataset.editableLoaded = "1";
  }
}

async function attachEditableBlockEditors(blocks) {
  let me;
  try {
    me = await currentUser();
  } catch {
    return;
  }
  if (!me.admin && !me.contentEditor) return;

  blocks.forEach((block) => {
    if (block.dataset.editableBound) return;
    block.dataset.editableBound = "1";
    block.classList.add("editable-block");

    const actions = document.createElement("div");
    actions.className = "editable-block-actions";
    actions.innerHTML = '<button type="button" class="btn secondary" data-edit-block>编辑文案</button>';
    block.append(actions);
    actions.querySelector("[data-edit-block]").addEventListener("click", () => {
      openEditableBlockEditor(block);
    });
  });
}

function applyEditableBlockState(block, state) {
  const fields = state.fields && typeof state.fields === "object" ? state.fields : {};
  Object.entries(fields).forEach(([name, value]) => {
    editableBlockNodes(block, `[data-block-field="${name}"]`).forEach((node) => {
      setEditableText(node, value);
    });
  });

  if (Array.isArray(state.tags)) {
    const tags = editableBlockNodes(block, "[data-block-tags]")[0];
    if (tags) {
      tags.innerHTML = state.tags
        .filter((tag) => String(tag || "").trim())
        .map((tag) => `<span class="tag">${escapeHtml(String(tag).trim())}</span>`)
        .join("");
    }
  }

  if (Array.isArray(state.rows)) {
    const rows = editableBlockNodes(block, "[data-block-rows]")[0];
    if (rows) {
      rows.innerHTML = state.rows
        .filter((row) => String(row?.label || row?.value || "").trim())
        .map(
          (row) => `
            <div class="pipeline-row" data-block-row>
              <strong>${escapeHtml(String(row.label || "").trim())}</strong>
              <span>${escapeHtml(String(row.value || "").trim())}</span>
            </div>
          `,
        )
        .join("");
    }
  }

  if (Array.isArray(state.links)) {
    const links = editableBlockNodes(block, "[data-block-links]")[0];
    if (links) {
      links.innerHTML = state.links
        .filter((link) => String(link?.label || link?.href || "").trim())
        .map((link) => {
          const href = safeLinkUrl(link.href) || "#";
          return `<a href="${escapeHtml(href)}">${escapeHtml(String(link.label || href).trim())}</a>`;
        })
        .join("");
    }
  }
}

function collectEditableBlockState(block) {
  const fields = {};
  const fieldMeta = [];
  editableBlockNodes(block, "[data-block-field]").forEach((node) => {
    const name = node.dataset.blockField;
    if (!name || fields[name] !== undefined) return;
    fields[name] = getEditableText(node);
    fieldMeta.push({
      name,
      label: node.dataset.blockLabel || editableFieldLabel(name),
      multiline: node.dataset.blockMultiline === "breaks" || node.tagName === "P",
    });
  });

  const tagNode = editableBlockNodes(block, "[data-block-tags]")[0];
  const tags = tagNode
    ? Array.from(tagNode.querySelectorAll(".tag")).map((tag) => tag.textContent.trim()).filter(Boolean)
    : null;

  const rowNode = editableBlockNodes(block, "[data-block-rows]")[0];
  const rows = rowNode
    ? Array.from(rowNode.querySelectorAll("[data-block-row]")).map((row) => ({
        label: row.querySelector("strong")?.textContent.trim() || "",
        value: row.querySelector("span")?.textContent.trim() || "",
      }))
    : null;

  const linkNode = editableBlockNodes(block, "[data-block-links]")[0];
  const links = linkNode
    ? Array.from(linkNode.querySelectorAll("a")).map((link) => ({
        label: link.textContent.trim(),
        href: link.getAttribute("href") || "",
      }))
    : null;

  return { fields, fieldMeta, tags, rows, links };
}

function editableBlockNodes(block, selector) {
  return Array.from(block.querySelectorAll(selector)).filter((node) => node.closest("[data-editable-block]") === block);
}

function editableFieldLabel(name) {
  const labels = {
    eyebrow: "眉标",
    title: "标题",
    lead: "说明",
    body: "正文",
    meta: "补充说明",
  };
  return labels[name] || name;
}

function getEditableText(node) {
  if ("value" in node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA")) {
    return String(node.value || "").trim();
  }
  const value = node.dataset.blockMultiline === "breaks" ? node.innerText : node.textContent;
  return value.replace(/\n{3,}/g, "\n\n").trim();
}

function setEditableText(node, value) {
  const text = String(value || "");
  if ("value" in node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA")) {
    node.value = text;
    return;
  }
  if (node.dataset.blockMultiline === "breaks") {
    node.innerHTML = text.split("\n").map((line) => escapeHtml(line)).join("<br>");
    return;
  }
  node.textContent = text;
}

function openEditableBlockEditor(block) {
  const key = block.dataset.editableBlock;
  if (!key) return;

  const modal = ensureEditableBlockModal();
  const heading = modal.querySelector("[data-block-editor-heading]");
  const fieldsContainer = modal.querySelector("[data-block-editor-fields]");
  const tagsGroup = modal.querySelector("[data-block-editor-tags-group]");
  const tagsInput = modal.querySelector("[data-block-editor-tags]");
  const rowsGroup = modal.querySelector("[data-block-editor-rows-group]");
  const rowsInput = modal.querySelector("[data-block-editor-rows]");
  const linksGroup = modal.querySelector("[data-block-editor-links-group]");
  const linksInput = modal.querySelector("[data-block-editor-links]");
  const message = modal.querySelector("[data-block-editor-message]");
  const state = collectEditableBlockState(block);

  heading.textContent = block.dataset.editableTitle || "编辑文案";
  fieldsContainer.innerHTML = state.fieldMeta
    .map(
      (field) => `
        <label>
          ${escapeHtml(field.label)}
          <textarea class="admin-input" data-block-editor-field="${escapeHtml(field.name)}" rows="${field.multiline ? 4 : 2}">${escapeHtml(state.fields[field.name] || "")}</textarea>
        </label>
      `,
    )
    .join("");

  tagsGroup.hidden = !state.tags;
  tagsInput.value = state.tags ? state.tags.join("\n") : "";
  rowsGroup.hidden = !state.rows;
  rowsInput.value = state.rows ? state.rows.map((row) => `${row.label}：${row.value}`).join("\n") : "";
  linksGroup.hidden = !state.links;
  linksInput.value = state.links ? state.links.map((link) => `${link.label}：${link.href}`).join("\n") : "";
  message.textContent = "";
  modal.hidden = false;
  document.body.classList.add("modal-open");

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  };

  modal.querySelector("[data-block-editor-close]").onclick = close;
  modal.querySelector("[data-block-editor-save]").onclick = async () => {
    const nextState = { fields: {} };
    fieldsContainer.querySelectorAll("[data-block-editor-field]").forEach((input) => {
      nextState.fields[input.dataset.blockEditorField] = input.value.trim();
    });
    if (!tagsGroup.hidden) {
      nextState.tags = tagsInput.value.split("\n").map((tag) => tag.trim()).filter(Boolean);
    }
    if (!rowsGroup.hidden) {
      nextState.rows = rowsInput.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/[：:]/);
          const label = parts.shift()?.trim() || "";
          return { label, value: parts.join("：").trim() };
        });
    }
    if (!linksGroup.hidden) {
      nextState.links = linksInput.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/[：:]/);
          const label = parts.shift()?.trim() || "";
          return { label, href: parts.join(":").trim() };
        });
    }

    message.textContent = "正在保存...";
    try {
      const title = block.dataset.editableTitle || nextState.fields.title || key;
      await saveSiteJsonRecord(key, title, nextState);
      applyEditableBlockState(block, nextState);
      message.textContent = "已保存";
      close();
    } catch (error) {
      message.textContent = error.message;
    }
  };
}

function ensureEditableBlockModal() {
  let modal = document.querySelector("[data-block-editor-modal]");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.dataset.blockEditorModal = "";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="文案编辑器">
      <div class="modal-head">
        <div>
          <h2 data-block-editor-heading>编辑文案</h2>
          <p class="meta">保存后写入 D1 数据库，并保留增量备份。</p>
        </div>
        <button type="button" class="icon-button" data-block-editor-close aria-label="关闭编辑器">×</button>
      </div>
      <div class="modal-body">
        <section class="editor-shell admin-form">
          <div data-block-editor-fields></div>
          <label data-block-editor-tags-group>
            标签（每行一个）
            <textarea class="admin-input" data-block-editor-tags rows="4"></textarea>
          </label>
          <label data-block-editor-rows-group>
            分项内容（每行一个，格式：标题：内容）
            <textarea class="admin-input" data-block-editor-rows rows="6"></textarea>
          </label>
          <label data-block-editor-links-group>
            链接列表（每行一个，格式：标题：链接）
            <textarea class="admin-input" data-block-editor-links rows="5"></textarea>
          </label>
          <div class="editor-actions">
            <button type="button" class="btn primary" data-block-editor-save>保存文案</button>
          </div>
          <p class="meta" data-block-editor-message></p>
        </section>
      </div>
    </div>
  `;
  document.body.append(modal);
  return modal;
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
    return '<a class="nav-link nav-admin" href="/admin/">管理后台</a><a class="nav-link nav-logout" href="#" data-logout>退出登录</a>';
  }
  if (me.authenticated) return '<a class="nav-link nav-logout" href="#" data-logout>退出登录</a>';
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
    const date = formatDate(data.post.published_at || data.post.updated_at);
    const views = formatViews(data.post.view_count);
    const heroTitle = document.querySelector("[data-article-hero-title]");
    const heroLead = document.querySelector("[data-article-hero-lead]");
    const updated = document.querySelector("[data-article-updated]");
    const viewNode = document.querySelector("[data-article-views]");
    if (heroTitle) heroTitle.textContent = data.post.title;
    if (heroLead) heroLead.textContent = data.post.excerpt || "协会文章与学习记录。";
    if (updated) updated.textContent = date;
    if (viewNode) viewNode.textContent = views;
    article.innerHTML = `
      <div class="meta"><span>${date}</span><span>${data.post.status === "published" ? "已发布" : "草稿"}</span><span>${escapeHtml(postTag(data.post))}</span><span>${views}</span></div>
      <h2>${escapeHtml(data.post.title)}</h2>
      ${data.post.excerpt ? `<p>${escapeHtml(data.post.excerpt)}</p>` : ""}
      ${markdownToHtml(data.markdown)}
    `;
  } catch (error) {
    article.innerHTML = `<p class="empty-state error">${escapeHtml(error.message)}</p>`;
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

  const staticPage = resolveStaticMarkdownPage(params);
  if (!staticPage) {
    container.innerHTML = '<div class="article-body"><p class="empty-state error">页面路径无效。</p></div>';
    return;
  }

  try {
    const data = await fetchJson(pageApiPath(staticPage.key));
    const markdown = data.page.content || "";
    if (!markdown) throw new Error("页面不存在");

    const title = firstHeading(markdown) || data.page.title || staticPage.defaultTitle;
    document.title = `${title} · 燕山大学大学生网络信息协会`;
    updateStaticPageHero(title, staticPage.key);
    container.innerHTML = `<div class="article-body">${markdownToHtml(markdown)}</div>`;
    await attachStaticPageEditor(container, {
      page: staticPage.key,
      title,
      markdown,
    });
  } catch (error) {
    updateStaticPageHero(staticPage.defaultTitle, staticPage.key);
    container.innerHTML = `<div class="article-body"><p class="empty-state error">${escapeHtml(error.message)}</p></div>`;
    await attachStaticPageEditor(container, {
      page: staticPage.key,
      title: staticPage.defaultTitle,
      markdown: `# ${staticPage.defaultTitle}\n\n`,
    });
  }
}

function updateStaticPageHero(title, key) {
  const heroTitle = document.querySelector("[data-page-hero-title]");
  const heroEyebrow = document.querySelector("[data-page-hero-eyebrow]");
  const heroLead = document.querySelector("[data-page-hero-lead]");
  if (heroTitle) heroTitle.textContent = `${title}。`;
  if (heroEyebrow) heroEyebrow.textContent = key.includes("about-us") ? "About YUNA" : "Knowledge Base";
  if (heroLead) heroLead.textContent = pageHeroLead(key);
}

function pageHeroLead(key) {
  if (key.includes("about-us")) return "了解协会方向、部门职责、成员故事和长期沉淀的校园技术实践。";
  if (key.includes("join-us")) return "这里整理招新流程、方向说明和参与方式，方便新同学快速找到入口。";
  if (key.includes("contact-us")) return "这里整理协会联系方式、社群入口和活动沟通方式。";
  if (key.includes("services")) return "这里整理协会维护的常用服务、资料归档和站点入口。";
  return "这里整理授课资料、招新流程、联系方式和协会常用服务，方便新成员从一页开始了解方向与路径。";
}

function resolveStaticMarkdownPage(params) {
  const asset = params.get("asset");
  if (asset) {
    const decoded = decodeURIComponent(asset).replace(/\.md$/i, "").replace(/^\/+|\/+$/g, "");
    if (!isSafeMarkdownPath(decoded)) return null;
    return {
      key: `asset/${utf8Hex(decoded)}`,
      defaultTitle: decoded.split("/").pop() || "资料页面",
    };
  }

  const page = params.get("p") || "about-us/index";
  if (!isSafeMarkdownPath(page)) return null;
  return {
    key: page,
    defaultTitle: pageTitleFromPath(page),
  };
}

function isSafeMarkdownPath(path) {
  return Boolean(path) && !path.includes("..") && /^[\w/\-\u4e00-\u9fa5\uff00-\uffef]+$/.test(path);
}

function pageTitleFromPath(path) {
  const titles = {
    "about-us/index": "关于我们",
    "services/index": "相关服务",
    "lessons/index": "授课链接",
    "join-us/how-to": "加入我们",
    "contact-us/index": "联系我们",
  };
  return titles[path] || path.split("/").pop() || "页面";
}

async function renderSiteRecord(container, key) {
  if (!/^[a-z0-9_-]+$/i.test(key)) {
    container.innerHTML = '<div class="article-body"><p class="empty-state error">内容标识无效。</p></div>';
    return;
  }

  try {
    const data = await fetchJson(`/api/site/${key}`);
    document.title = `${data.record.title} · 燕山大学大学生网络信息协会`;
    updateStaticPageHero(data.record.title, key);
    container.innerHTML =
      data.record.kind === "json"
        ? renderStructuredRecord(data.record)
        : `<div class="article-body">${markdownToHtml(data.record.content)}</div>`;
  } catch (error) {
    container.innerHTML = `<div class="article-body"><p class="empty-state error">${escapeHtml(error.message)}</p></div>`;
  }
}

function renderStructuredRecord(record) {
  let items;
  try {
    items = JSON.parse(record.content || "[]");
  } catch {
    return '<div class="article-body"><p class="empty-state error">内容数据格式有误。</p></div>';
  }
  if (!Array.isArray(items) || !items.length) return '<div class="article-body"><p class="empty-state">暂无内容。</p></div>';

  if (record.key === "members") {
    return renderMembersRecord(record, items);
  }

  return `
    <div class="article-body">
      <h1>${escapeHtml(record.title)}</h1>
      <div class="member-grid refined-member-grid">
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
      <label class="field-lite inline-control">
        <span>届数</span>
        <select class="select-input" data-term-switch>
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
            <div class="member-grid refined-member-grid">
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
  const avatarText = (item.name || item.title || "Y").slice(0, 2).toUpperCase();
  return `
    <article class="member-card refined-member-card reveal visible">
      <span class="flash"></span>
      <div class="member-card-top">
        ${
          item.avatar
            ? `<img class="avatar image-avatar" src="${normalizeAssetUrl(escapeHtml(item.avatar))}" alt="${escapeHtml(item.name || "")}" loading="lazy">`
            : `<div class="avatar">${escapeHtml(avatarText)}</div>`
        }
        <span class="tag">${escapeHtml(item.department || item.title || "YUNA")}</span>
      </div>
      <h3>${escapeHtml(item.name || "")}</h3>
      ${item.title ? `<p class="meta">${escapeHtml(item.title)}</p>` : ""}
      ${item.desc ? `<p>${escapeHtml(item.desc)}</p>` : ""}
      ${
        links.length
          ? `<div class="member-actions">${links
              .map((link) => {
                const href = safeLinkUrl(link.url);
                if (!href) return "";
                return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label || link.url)}</a>`;
              })
              .filter(Boolean)
              .join("")}</div>`
          : ""
      }
    </article>
  `;
}

async function attachStaticPageEditor(container, pageState) {
  let me;
  try {
    me = await currentUser();
  } catch {
    return;
  }
  if (!me.contentEditor) return;

  const toolbar = document.createElement("div");
  toolbar.className = "article-actions";
  toolbar.innerHTML = '<button type="button" class="btn secondary" data-edit-static-page>编辑页面</button>';
  container.prepend(toolbar);

  toolbar.querySelector("[data-edit-static-page]").addEventListener("click", () => {
    openStaticPageEditor(pageState, (nextState) => {
      pageState.title = nextState.title;
      pageState.markdown = nextState.markdown;
      document.title = `${nextState.title} · 燕山大学大学生网络信息协会`;
      const body = container.matches(".article-body") ? container : container.querySelector(".article-body");
      if (body) {
        body.innerHTML = markdownToHtml(nextState.markdown);
      } else {
        container.innerHTML = `<div class="article-body">${markdownToHtml(nextState.markdown)}</div>`;
        attachStaticPageEditor(container, pageState);
      }
    });
  });
}

function openStaticPageEditor(pageState, onSaved) {
  const modal = ensureStaticPageEditorModal();
  const heading = modal.querySelector("[data-page-editor-heading]");
  const helper = modal.querySelector("[data-page-editor-helper]");
  const titleInput = modal.querySelector("[data-page-editor-title]");
  const markdownInput = modal.querySelector("[data-page-editor-markdown]");
  const message = modal.querySelector("[data-page-editor-message]");

  if (heading) heading.textContent = pageState.editorTitle || "编辑页面";
  if (helper) helper.textContent = pageState.editorHelper || "保存后写入 D1 数据库。";
  titleInput.value = pageState.title || firstHeading(pageState.markdown) || "";
  markdownInput.value = pageState.markdown || "";
  message.textContent = "";
  modal.hidden = false;
  document.body.classList.add("modal-open");
  markdownInput.focus();

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  };

  modal.querySelector("[data-page-editor-close]").onclick = close;
  modal.querySelector("[data-page-editor-save]").onclick = async () => {
    const markdown = markdownInput.value;
    const title = titleInput.value.trim() || firstHeading(markdown) || "页面";
    message.textContent = "正在保存...";

    try {
      if (pageState.save) {
        await pageState.save({ title, markdown });
      } else {
        await fetchJson(pageApiPath(pageState.page), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            content: markdown,
          }),
        });
      }
      message.textContent = "已保存";
      onSaved({ title, markdown });
      close();
    } catch (error) {
      message.textContent = error.message;
    }
  };

  modal.querySelector("[data-page-editor-upload]").onclick = async () => {
    const fileInput = modal.querySelector("[data-page-editor-image]");
    const file = fileInput.files?.[0];
    if (!file) {
      message.textContent = "请选择图片";
      return;
    }
    try {
      await insertStaticPageImage(pageState.uploadScope || pageState.page, markdownInput, file, message);
      fileInput.value = "";
    } catch (error) {
      message.textContent = error.message;
    }
  };

  markdownInput.onpaste = async (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    try {
      for (const file of files) {
        await insertStaticPageImage(pageState.uploadScope || pageState.page, markdownInput, file, message);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  };

  markdownInput.ondragover = (event) => {
    event.preventDefault();
    markdownInput.classList.add("is-dragover");
  };
  markdownInput.ondragleave = () => markdownInput.classList.remove("is-dragover");
  markdownInput.ondrop = async (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    markdownInput.classList.remove("is-dragover");
    try {
      for (const file of files) {
        await insertStaticPageImage(pageState.uploadScope || pageState.page, markdownInput, file, message);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  };
}

function ensureStaticPageEditorModal() {
  let modal = document.querySelector("[data-page-editor-modal]");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.dataset.pageEditorModal = "";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="页面编辑器">
      <div class="modal-head">
        <div>
          <h2 data-page-editor-heading>编辑页面</h2>
          <p class="meta" data-page-editor-helper>保存后写入 D1 数据库。</p>
        </div>
        <button type="button" class="icon-button" data-page-editor-close aria-label="关闭编辑器">×</button>
      </div>
      <div class="modal-body">
        <section class="editor-shell admin-form">
          <label>
            标题
            <input class="admin-input" data-page-editor-title placeholder="页面标题" />
          </label>
          <label>
            Markdown 内容（可粘贴或拖拽图片）
            <textarea class="admin-input" data-page-editor-markdown placeholder="# 页面标题"></textarea>
          </label>
          <div class="inline-uploader">
            <label>
              图片
              <input class="admin-input" data-page-editor-image type="file" accept="image/*" />
            </label>
            <button type="button" class="btn secondary" data-page-editor-upload>上传</button>
          </div>
          <div class="editor-actions">
            <button type="button" class="btn primary" data-page-editor-save>保存页面</button>
          </div>
          <p class="meta" data-page-editor-message></p>
        </section>
      </div>
    </div>
  `;
  document.body.append(modal);
  return modal;
}

async function insertStaticPageImage(page, textarea, file, message) {
  message.textContent = "正在上传图片...";
  const filename = uploadFilename(file.name);
  const mediaPath = `pages/${page}/${Date.now()}-${filename}`;
  const data = await uploadContentMedia(file, mediaPath, (loaded, total) => {
    message.textContent = `正在上传图片... ${uploadPercent(loaded, total)}`;
  });

  insertAtCursor(textarea, `![${filename}](${data.url})`);
  message.textContent = "图片已上传";
}

async function uploadContentMedia(file, path, onProgress) {
  if (file.size <= DIRECT_MEDIA_UPLOAD_LIMIT) {
    const response = await fetch(`/api/content/media/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `上传失败：${response.status}`);
    onProgress?.(file.size, file.size);
    return data;
  }

  return uploadMultipartContentMedia(file, path, onProgress);
}

async function uploadMultipartContentMedia(file, path, onProgress) {
  const init = await fetchJson("/api/content/uploads/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    }),
  });

  const parts = [];
  const partSize = init.partSize || DIRECT_MEDIA_UPLOAD_LIMIT;
  let uploaded = 0;

  try {
    for (let offset = 0, partNumber = 1; offset < file.size; offset += partSize, partNumber += 1) {
      const chunk = file.slice(offset, Math.min(file.size, offset + partSize));
      const response = await fetch(
        `/api/content/uploads/part?path=${encodeURIComponent(path)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`,
        {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: chunk,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `分片上传失败：${response.status}`);
      parts.push(data);
      uploaded += chunk.size;
      onProgress?.(uploaded, file.size);
    }

    return fetchJson("/api/content/uploads/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        uploadId: init.uploadId,
        parts,
      }),
    });
  } catch (error) {
    await fetchJson("/api/content/uploads/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        uploadId: init.uploadId,
      }),
    }).catch(() => {});
    throw error;
  }
}

function uploadPercent(loaded, total) {
  if (!total) return "0%";
  return `${Math.min(100, Math.round((loaded / total) * 100))}%`;
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || start;
  const prefix = textarea.value.slice(0, start);
  const suffix = textarea.value.slice(end);
  const needsLeadingBreak = prefix && !prefix.endsWith("\n") ? "\n" : "";
  const insert = `${needsLeadingBreak}${text}\n`;
  textarea.value = `${prefix}${insert}${suffix}`;
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + insert.length;
}

function uploadFilename(name) {
  const fallback = "image.png";
  return (name || fallback)
    .replace(/[\\/:*?"<>|#%&{}$!`'@+=]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96) || fallback;
}

function pageApiPath(page) {
  return `/api/pages/${page.split("/").map(encodeURIComponent).join("/")}`;
}

function utf8Hex(value) {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
  formatViews,
  escapeHtml,
  markdownToHtml,
  normalizeAssetUrl,
  renderPostList,
  renderHomeHero,
  renderHomeNotice,
  renderPost,
  renderUserNav,
  renderAdminOnlyActions,
  renderEditableBlocks,
  renderStaticPage,
};
