// 文章：列表、标签筛选、分页、作者署名与文章详情页。依赖 core.js、markdown.js。

const LIST_PAGE_SIZE = 10;
// 首页只展示最近几篇，完整列表去文章页。
const HOME_LIST_SIZE = 6;

function hasPostEditAfterPublish(post) {
  const published = timestampValue(post?.published_at);
  const updated = timestampValue(post?.updated_at);
  return Boolean(published && updated && updated > published + 1000);
}

function postTimeParts(post) {
  const parts = [];
  if (post?.published_at) {
    parts.push(`发布 ${formatDay(post.published_at)}`);
    if (hasPostEditAfterPublish(post)) {
      parts.push(`更新 ${formatDay(post.updated_at)}`);
    }
    return parts;
  }
  if (post?.updated_at) return [`更新 ${formatDay(post.updated_at)}`];
  return ["未发布"];
}

function postTimeText(post) {
  return postTimeParts(post).join(" · ");
}

function postTimeMetaHtml(post) {
  return postTimeParts(post).map((part) => `<span>${escapeHtml(part)}</span>`).join("");
}

function postTag(post) {
  return postTagList(post).join("、");
}

function postTagList(post) {
  return splitPostTags(post?.tag);
}

// 旧标签同义映射：线上早期文章用「网安部」，统一归到「网络安全部」，筛选与链接都按新名处理。
const TAG_ALIASES = { "网安部": "网络安全部" };

function canonicalTag(tag) {
  const value = String(tag || "").trim();
  return TAG_ALIASES[value] || value;
}

function splitPostTags(value) {
  const seen = new Set();
  const tags = String(value || "")
    .split(",")
    .map(canonicalTag)
    .filter(Boolean)
    .filter((tag) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
  return tags.length ? tags : ["未分类"];
}

function postTagsHtml(post) {
  return postTagList(post).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
}

function postTagsDataValue(post) {
  return postTagList(post).map(encodeURIComponent).join(",");
}

function parsePostTagsDataValue(value) {
  return String(value || "")
    .split(",")
    .filter(Boolean)
    .map((tag) => decodeURIComponent(tag));
}

function postTags(posts) {
  const seen = new Set();
  const tags = [];
  for (const post of posts) {
    for (const tag of postTagList(post)) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function postTagCounts(posts) {
  const counts = new Map();
  for (const post of posts) {
    for (const tag of postTagList(post)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag, "zh-CN"));
}

function postCoverUrl(post) {
  return safeDisplayAssetUrl(post?.cover_url);
}

function currentPageFromUrl(param = "page") {
  const parsed = Number(new URLSearchParams(location.search).get(param) || "1");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function setPageParam(param, page) {
  const url = new URL(location.href);
  if (page > 1) {
    url.searchParams.set(param, String(page));
  } else {
    url.searchParams.delete(param);
  }
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function renderPagination(container, { page, total, pageParam = "page", onPage }) {
  if (!container) return;
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <button class="btn secondary compact" type="button" data-page-prev ${page <= 1 ? "disabled" : ""}>上一页</button>
    <span class="pagination-info">第 ${page} / ${totalPages} 页</span>
    <button class="btn secondary compact" type="button" data-page-next ${page >= totalPages ? "disabled" : ""}>下一页</button>
  `;
  container.querySelector("[data-page-prev]")?.addEventListener("click", () => {
    const next = Math.max(1, page - 1);
    setPageParam(pageParam, next);
    onPage?.(next);
  });
  container.querySelector("[data-page-next]")?.addEventListener("click", () => {
    const next = Math.min(totalPages, page + 1);
    setPageParam(pageParam, next);
    onPage?.(next);
  });
}

function safeAuthorUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    return url.hostname ? url.href : "";
  } catch {
    return "";
  }
}

function authorInitials(name) {
  return (String(name || "Y").trim() || "Y").slice(0, 2).toUpperCase();
}

function authorIdentityHtml(post, { prefix = "" } = {}) {
  const name = String(post?.author_name || "").trim();
  if (!name) return "";
  const avatar = safeDisplayAssetUrl(post?.author_avatar);
  const href = safeAuthorUrl(post?.author_url);
  const avatarHtml = `<span class="author-avatar"><span>${escapeHtml(authorInitials(name))}</span>${avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-author-avatar-image>` : ""}</span>`;
  const content = `${avatarHtml}<span>${escapeHtml(prefix)}${escapeHtml(name)}</span>`;
  return href
    ? `<a class="author-chip" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${content}</a>`
    : `<span class="author-chip">${content}</span>`;
}

function postAuthors(post) {
  const authors = [];
  const primaryName = String(post?.author_name || "").trim();
  if (primaryName) {
    authors.push({
      author_name: primaryName,
      author_url: post?.author_url || "",
      author_avatar: post?.author_avatar || "",
    });
  }
  const coauthors = Array.isArray(post?.coauthors) ? post.coauthors : [];
  for (const author of coauthors) {
    const name = String(author?.name || "").trim();
    if (!name) continue;
    authors.push({
      author_name: name,
      author_url: author?.url || "",
      author_avatar: author?.avatar || "",
    });
  }
  return authors;
}

function authorsIdentityHtml(post, options = {}) {
  return postAuthors(post).map((author) => authorIdentityHtml(author, options)).join("");
}

function postAuthorNames(post) {
  return postAuthors(post).map((author) => author.author_name).join(" ");
}

function bindAuthorAvatarFallbacks(root = document) {
  root.querySelectorAll?.("[data-author-avatar-image]").forEach((image) => {
    image.addEventListener("error", () => image.remove(), { once: true });
  });
}

async function renderPostList({ admin = false } = {}) {
  const lists = Array.from(document.querySelectorAll("[data-post-list]"));
  const featureGrid = document.querySelector("[data-feature-grid]");
  if (!lists.length) return;

  try {
    const data = await fetchJson(`/api/posts${admin ? "?drafts=1" : ""}`);
    if (!admin) renderHomePostTabs(data.posts);
    if (!admin) renderHomeCounts(data.posts);
    if (featureGrid && !admin && data.posts.length) {
      const featuredPosts = data.posts.slice(0, 3);
      featureGrid.innerHTML = featuredPosts
        .map(
          (post, index) => `
            <a class="resource-card reveal visible${index === 0 ? " is-lead" : ""}" href="/post.html?slug=${encodeURIComponent(post.slug)}">
              <p class="meta">${index === 0 ? "最新" : "动态"} · ${postTimeText(post)} · ${formatViews(post.view_count)}</p>
              <h2>${escapeHtml(post.title)}</h2>
              <p>${escapeHtml(post.excerpt || "")}</p>
            </a>
          `,
        )
        .join("");
    }

    if (!data.posts.length && featureGrid && !admin) featureGrid.innerHTML = "";
    if (!admin) renderPostTagStats(data.posts);
    if (!admin) renderArticleTagFilter(data.posts);
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

// 首页数字行：[data-home-count="posts|views"] 写入 data-count，由 yuna-ui.js 的计数器在进入视口时滚动到目标值。
function renderHomeCounts(posts) {
  const nodes = document.querySelectorAll("[data-home-count]");
  if (!nodes.length) return;
  const published = posts.filter((post) => !post.status || post.status === "published");
  const values = {
    posts: published.length,
    views: published.reduce((sum, post) => sum + viewCount(post.view_count), 0),
  };
  nodes.forEach((node) => {
    const value = values[node.dataset.homeCount];
    if (Number.isFinite(value)) node.dataset.count = String(value);
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

    const selectedTag = canonicalTag(new URLSearchParams(location.search).get("tag"));
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

function renderArticleTagFilter(posts) {
  const select = document.querySelector("[data-article-tag]");
  if (!select) return;

  const tags = postTags(posts);
  const urlTag = canonicalTag(new URLSearchParams(location.search).get("tag"));
  const selected = tags.includes(urlTag) ? urlTag : "all";
  select.innerHTML = [
    '<option value="all">全部标签</option>',
    ...tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`),
  ].join("");
  select.value = selected;

  // 标签胶囊：可见的筛选入口，点击时改写隐藏的 select 并触发 change，筛选逻辑仍只认 select。
  const chips = document.querySelector("[data-article-tag-chips]");
  if (!chips) return;
  const counts = new Map(postTagCounts(posts).map(({ tag, count }) => [tag, count]));
  const chipHtml = (value, label, count) => `
    <button class="filter-chip${value === selected ? " is-active" : ""}" type="button" data-article-tag-chip="${escapeHtml(value)}" aria-pressed="${value === selected}">
      ${escapeHtml(label)}<span>${count.toLocaleString("zh-CN")}</span>
    </button>`;
  chips.innerHTML = [
    chipHtml("all", "全部", posts.length),
    ...tags.map((tag) => chipHtml(tag, tag, counts.get(tag) || 0)),
  ].join("");
  chips.querySelectorAll("[data-article-tag-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      select.value = chip.dataset.articleTagChip || "all";
      select.dispatchEvent(new Event("change"));
    });
  });
}

function syncArticleTagChips(selectedTag) {
  document.querySelectorAll("[data-article-tag-chip]").forEach((chip) => {
    const active = (chip.dataset.articleTagChip || "all") === (selectedTag || "all");
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
}

function renderPostListInto(list, posts, admin) {
  const mode = list.dataset.postListMode || (admin ? "admin" : "cards");
  if (!posts.length) {
    list.innerHTML = '<p class="empty-state">暂无文章。</p>';
    return;
  }

  if (mode === "compact") {
    // 热门栏严格按阅读量取前 3，阅读量相同按发布时间靠新优先；与主列表重复也照常展示。
    const hotPosts = [...posts]
      .sort((left, right) => {
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
            <span>${formatViews(post.view_count)} · ${postTimeText(post)}</span>
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
      : posts.filter((post) => postTagList(post).includes(selectedTag));

    if (!homePosts.length) {
      list.innerHTML = `<p class="empty-state">暂无${selectedTag === "all" ? "" : escapeHtml(selectedTag)}文章。</p>`;
      return;
    }

    list.innerHTML = homePosts
      .slice(0, HOME_LIST_SIZE)
      .map(
        (post) => `
          <article class="card reveal visible">
            <div class="meta">${postTimeMetaHtml(post)}${post.status === "published" ? "" : "<span>草稿</span>"}<span>${formatViews(post.view_count)}</span></div>
            <h2><a href="/post.html?slug=${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
            <p>${escapeHtml(post.excerpt || "")}</p>
            <div class="card-footer">
              <div class="contact-row">${postTagsHtml(post)}</div>
              <a class="read-more" href="/post.html?slug=${encodeURIComponent(post.slug)}">阅读全文 →</a>
            </div>
          </article>
        `,
      )
      .join("");
    return;
  }

  list.innerHTML = posts
    .map((post) => {
      const href = admin ? `/admin/?slug=${encodeURIComponent(post.slug)}` : `/post.html?slug=${encodeURIComponent(post.slug)}`;
      const cover = postCoverUrl(post);
      // 没有封面时用第一个标签生成一块浅色占位封面，保证卡片网格比例统一。
      const coverHtml = cover
        ? `<div class="article-cover"><img src="${escapeHtml(cover)}" alt="" loading="lazy"></div>`
        : `<div class="article-cover is-placeholder" aria-hidden="true"><span>${escapeHtml(postTagList(post)[0])}</span></div>`;
      // 卡片上的作者只展示、不跳转（整卡是一个链接）。
      const authors = postAuthors(post).map((author) => authorIdentityHtml({ ...author, author_url: "" })).join("");
      return `
        <article class="card article-card spotlight reveal visible" data-article-card data-status="${escapeHtml(post.status)}" data-tags="${escapeHtml(postTagsDataValue(post))}" data-search="${escapeHtml(`${post.title} ${postTag(post)} ${post.excerpt || ""} ${postAuthorNames(post)}`.toLowerCase())}">
          ${coverHtml}
          <div class="article-head">
            <div class="meta">${postTimeMetaHtml(post)}${admin ? `<span>${post.status === "published" ? "已发布" : "草稿"}</span>` : ""}<span>${formatViews(post.view_count)}</span></div>
          </div>
          <h2><a href="${href}">${escapeHtml(post.title)}</a></h2>
          <p>${escapeHtml(post.excerpt || "")}</p>
          <div class="contact-row">${postTagsHtml(post)}</div>
          <div class="card-footer">
            ${authors ? `<div class="article-card-authors author-collection">${authors}</div>` : ""}
            <a class="read-more" href="${href}" tabindex="-1" aria-hidden="true">阅读全文<span class="arrow" aria-hidden="true"></span></a>
          </div>
        </article>
      `;
    })
    .join("");
  bindAuthorAvatarFallbacks(list);
}

function bindArticleFilters() {
  const cards = Array.from(document.querySelectorAll("[data-article-card]"));
  if (!cards.length) return;

  const search = document.querySelector("[data-article-search]");
  const tagSelect = document.querySelector("[data-article-tag]");
  const empty = document.querySelector("[data-article-empty]");
  const pagination = document.querySelector("[data-article-pagination]");
  const filter = () => {
    const keyword = (search?.value || "").trim().toLowerCase();
    const selectedTag = tagSelect?.value && tagSelect.value !== "all" ? tagSelect.value : "";
    const matches = cards.filter((card) => {
      const haystack = card.dataset.search || card.textContent.toLowerCase();
      const tags = parsePostTagsDataValue(card.dataset.tags);
      return (!keyword || haystack.includes(keyword)) && (!selectedTag || tags.includes(selectedTag));
    });
    const totalPages = Math.max(1, Math.ceil(matches.length / LIST_PAGE_SIZE));
    const page = Math.min(currentPageFromUrl(), totalPages);
    const start = (page - 1) * LIST_PAGE_SIZE;
    const pageCards = new Set(matches.slice(start, start + LIST_PAGE_SIZE));
    cards.forEach((card) => {
      card.hidden = !pageCards.has(card);
    });
    document.querySelectorAll("[data-post-tag-stats] a").forEach((link) => {
      const tag = canonicalTag(new URL(link.href, location.href).searchParams.get("tag"));
      link.classList.toggle("active", Boolean(selectedTag) && tag === selectedTag);
    });
    if (empty) empty.hidden = matches.length > 0;
    syncArticleTagChips(selectedTag);
    const countNode = document.querySelector("[data-article-count]");
    if (countNode) {
      countNode.textContent = keyword || selectedTag
        ? `找到 ${matches.length.toLocaleString("zh-CN")} 篇`
        : `共 ${cards.length.toLocaleString("zh-CN")} 篇`;
    }
    renderPagination(pagination, {
      page,
      total: matches.length,
      onPage: filter,
    });
  };

  if (search && !search.dataset.boundArticleFilter) {
    search.dataset.boundArticleFilter = "1";
    search.addEventListener("input", () => {
      setPageParam("page", 1);
      filter();
    });
  }
  if (tagSelect && !tagSelect.dataset.boundArticleFilter) {
    tagSelect.dataset.boundArticleFilter = "1";
    tagSelect.addEventListener("change", () => {
      const url = new URL(location.href);
      if (tagSelect.value && tagSelect.value !== "all") {
        url.searchParams.set("tag", tagSelect.value);
      } else {
        url.searchParams.delete("tag");
      }
      url.searchParams.delete("page");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      filter();
    });
  }
  filter();
}

// 标题 id / “#” 锚点 / 代码块头栏见 markdown.js 的 enhanceArticleBody；目录取最高两级（通常是 h2 / h3）。
function renderArticleToc(article) {
  const toc = document.querySelector("[data-article-toc]");
  const list = toc?.querySelector("[data-article-toc-list]");

  enhanceArticleBody(article);
  const allHeadings = Array.from(article.children).filter((node) => node.matches("h1, h2, h3, h4"));

  if (!toc || !list) return;
  const levels = allHeadings.map((heading) => Number(heading.tagName.slice(1)));
  const topLevel = Math.min(...levels);
  const headings = allHeadings.filter((heading) => Number(heading.tagName.slice(1)) <= topLevel + 1);
  if (headings.length < 2) {
    toc.hidden = true;
    list.innerHTML = "";
    return;
  }

  list.innerHTML = headings
    .map((heading) => {
      const label = Array.from(heading.childNodes)
        .filter((node) => !(node instanceof Element && node.classList.contains("heading-anchor")))
        .map((node) => node.textContent)
        .join("")
        .trim();
      const subheading = Number(heading.tagName.slice(1)) > topLevel ? " is-subheading" : "";
      return `<a class="article-toc-link${subheading}" href="#${escapeHtml(heading.id)}">${escapeHtml(label)}</a>`;
    })
    .join("");
  toc.hidden = false;
  trackArticleTocActive(headings, list);
}

// 目录当前节高亮：取视口上方 30% 线以上的最后一个标题。
function trackArticleTocActive(headings, list) {
  const links = new Map(Array.from(list.querySelectorAll(".article-toc-link")).map((link) => [link.getAttribute("href")?.slice(1), link]));
  let current = "";
  let frame = 0;
  const update = () => {
    frame = 0;
    const line = innerHeight * 0.3;
    let active = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top - line <= 0) active = heading;
      else break;
    }
    if (!active || active.id === current) return;
    current = active.id;
    links.forEach((link, id) => {
      const on = id === current;
      link.classList.toggle("is-active", on);
      if (on) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    // 目录很长时让当前项留在目录可视区内（只滚目录自身，不动页面）。
    const activeLink = links.get(current);
    if (activeLink && list.scrollHeight > list.clientHeight) {
      const top = activeLink.offsetTop - list.clientHeight / 2;
      list.scrollTop = Math.max(0, top);
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  update();
}

// 中文按每分钟约 400 字、英文按 200 词估算，至少 1 分钟。
function articleReadingMinutes(markdown) {
  const text = String(markdown || "").replace(/```[\s\S]*?```/g, " ");
  const han = (text.match(/[一-鿿]/g) || []).length;
  const words = (text.replace(/[一-鿿]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.round(han / 400 + words / 200));
}

// 上一篇 / 下一篇：按文章列表接口的顺序（新到旧）取相邻两篇，失败时静默隐藏。
async function renderArticlePager(slug) {
  const pager = document.querySelector("[data-article-pager]");
  if (!pager) return;
  try {
    const data = await fetchJson("/api/posts");
    const posts = (data.posts || []).filter((post) => !post.status || post.status === "published");
    const index = posts.findIndex((post) => post.slug === slug);
    if (index < 0) return;
    const newer = posts[index - 1];
    const older = posts[index + 1];
    const item = (post, label, cls) => post
      ? `<a class="article-pager-link ${cls}" href="/post.html?slug=${encodeURIComponent(post.slug)}"><span>${label}</span><strong>${escapeHtml(post.title)}</strong></a>`
      : `<span class="article-pager-link ${cls} is-empty" aria-hidden="true"></span>`;
    if (!newer && !older) return;
    pager.innerHTML = item(older, "上一篇", "is-prev") + item(newer, "下一篇", "is-next");
    pager.hidden = false;
  } catch {
    pager.hidden = true;
  }
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
    const publishedDate = data.post.published_at ? formatDay(data.post.published_at) : "未发布";
    const updatedDate = formatDay(data.post.updated_at || data.post.published_at);
    const views = formatViews(data.post.view_count);
    const authors = postAuthors(data.post);
    const editorName = String(data.post.editor_name || "").trim();
    const editedAfterPublish = hasPostEditAfterPublish(data.post);
    const heroTitle = document.querySelector("[data-article-hero-title]");
    const heroLead = document.querySelector("[data-article-hero-lead]");
    const published = document.querySelector("[data-article-published]");
    const updated = document.querySelector("[data-article-updated]");
    const updatedRow = document.querySelector("[data-article-updated-row]");
    const viewNode = document.querySelector("[data-article-views]");
    const authorNode = document.querySelector("[data-article-author]");
    const authorRow = document.querySelector("[data-article-author-row]");
    const tagNode = document.querySelector("[data-article-tag]");
    if (heroTitle) heroTitle.textContent = data.post.title;
    if (heroLead) heroLead.textContent = data.post.excerpt || "协会文章与学习记录。";
    if (published) published.textContent = publishedDate;
    if (updated) updated.textContent = editedAfterPublish && editorName ? `${updatedDate} · ${editorName}` : updatedDate;
    if (updatedRow) updatedRow.hidden = !editedAfterPublish;
    if (viewNode) viewNode.textContent = views;
    if (authorNode) {
      authorNode.classList.add("author-collection");
      authorNode.innerHTML = authorsIdentityHtml(data.post);
    }
    if (authorRow) authorRow.hidden = authors.length === 0;
    if (tagNode) tagNode.innerHTML = `<span class="contact-row">${postTagsHtml(data.post)}</span>`;
    const minutes = articleReadingMinutes(data.markdown);
    const heroTags = document.querySelector("[data-article-hero-tags]");
    if (heroTags) {
      heroTags.innerHTML = postTagList(data.post)
        .map((tag) => `<a class="tag" href="/articles.html?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`)
        .join("");
    }
    const heroMeta = document.querySelector("[data-article-hero-meta]");
    if (heroMeta) {
      const authorsHtml = authors.length ? `<span class="article-byline-authors author-collection">${authorsIdentityHtml(data.post)}</span>` : "";
      heroMeta.innerHTML = `
        ${authorsHtml}
        <span class="article-byline-facts">
          <span>${escapeHtml(publishedDate)}</span>
          <span>约 ${minutes} 分钟读完</span>
          <span>${escapeHtml(views)}</span>
        </span>`;
      heroMeta.hidden = false;
    }
    const readingNode = document.querySelector("[data-article-reading]");
    if (readingNode) readingNode.textContent = `约 ${minutes} 分钟`;
    const coverNode = document.querySelector("[data-article-cover]");
    const coverUrl = postCoverUrl(data.post);
    if (coverNode && coverUrl) {
      coverNode.innerHTML = `<img src="${escapeHtml(coverUrl)}" alt="" decoding="async">`;
      coverNode.hidden = false;
      coverNode.querySelector("img")?.addEventListener("error", () => { coverNode.hidden = true; }, { once: true });
    }
    document.querySelectorAll("[data-article-edit]").forEach((link) => {
      link.setAttribute("href", `/admin/?slug=${encodeURIComponent(data.post.slug || slug)}`);
    });
    window.blog.renderAdminOnlyActions?.();
    article.innerHTML = `
      ${markdownToHtml(stripDuplicateLeadingTitle(data.markdown, data.post.title))}
    `;
    renderArticleToc(article);
    bindAuthorAvatarFallbacks(document);
    renderArticlePager(data.post.slug || slug);
    // 带 #锚点 打开时，正文是异步渲染的，渲染完再定位一次。
    if (location.hash.length > 1) {
      try {
        document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
      } catch {
        // 非法的 hash 编码，忽略。
      }
    }
  } catch (error) {
    article.innerHTML = `<p class="empty-state error">${escapeHtml(error.message)}</p>`;
  }
}

Object.assign(window.blog, {
  postTimeText,
  postTag,
  postTagsHtml,
  safeAuthorUrl,
  authorIdentityHtml,
  postAuthors,
  authorsIdentityHtml,
  bindAuthorAvatarFallbacks,
  renderPostList,
  renderPost,
});
