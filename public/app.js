async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json().catch(() => ({})) : {};
  const text = isJson ? "" : await response.text().catch(() => "");
  if (!response.ok) {
    throw httpError(data.error || readableHttpError(text) || `请求失败：${response.status}`, response.status);
  }
  if (!isJson) throw httpError(`接口返回了非 JSON 响应：${response.status}`, response.status);
  return data;
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isNotFoundError(error) {
  return error?.status === 404 || error?.message === "内容不存在";
}

function readableHttpError(text) {
  const clean = String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, 160) : "";
}

let currentUserPromise;
const DIRECT_MEDIA_UPLOAD_LIMIT = 8 * 1024 * 1024;
const LIST_PAGE_SIZE = 10;
const HOME_NOTICE_KEY = "homepage-notice";
const FRIEND_LINKS_KEY = "friend-links";
const FOOTER_COPY_PREFIX = "footer";
const DEFAULT_HOME_NOTICE = {
  title: "协会公告",
  markdown: "招新答疑开放中，欢迎同学了解开发、安全、运维和组宣方向。",
};
const DEFAULT_FRIEND_LINKS = {
  title: "友情链接",
  links: [
    { label: "燕山大学", href: "https://www.ysu.edu.cn/", icon: "" },
  ],
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

// 站点文案读取带批处理：同一轮任务里发起的 key 合并成一次 /api/site?keys=… 请求，
// 避免每个可编辑块各打一次接口。行为与逐个请求一致：命中返回 { record }，缺失按 404 抛错。
const siteRecordPending = new Map();
let siteRecordFlushScheduled = false;

function fetchSiteRecord(key) {
  let entry = siteRecordPending.get(key);
  if (entry) return entry.promise;

  entry = {};
  entry.promise = new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
  });
  siteRecordPending.set(key, entry);

  if (!siteRecordFlushScheduled) {
    siteRecordFlushScheduled = true;
    setTimeout(flushSiteRecordBatch, 0);
  }
  return entry.promise;
}

async function flushSiteRecordBatch() {
  siteRecordFlushScheduled = false;
  const batch = new Map(siteRecordPending);
  siteRecordPending.clear();
  if (!batch.size) return;

  const keys = Array.from(batch.keys());
  try {
    const data = await fetchJson(`/api/site?keys=${encodeURIComponent(keys.join(","))}`);
    for (const [key, entry] of batch) {
      const record = data.records?.[key];
      if (record) {
        entry.resolve({ record });
      } else {
        entry.reject(httpError("内容不存在", 404));
      }
    }
  } catch (error) {
    for (const entry of batch.values()) entry.reject(error);
  }
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
    hourCycle: "h23",
  }).format(date);
}

// 面向访客的日期只到“天”，具体时刻留给后台展示。
function formatDay(value) {
  if (!value) return "未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间无效";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function viewCount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function formatViews(value) {
  return `${viewCount(value).toLocaleString("zh-CN")} 次阅读`;
}

function timestampValue(value) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

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

function splitPostTags(value) {
  const seen = new Set();
  const tags = String(value || "")
    .split(",")
    .map((tag) => tag.trim())
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
  let customBlock = null;

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

  function flushCustomBlock() {
    if (!customBlock) return;
    const type = customBlock.type;
    const title = customBlock.title || customBlockTitle(type);
    const body = markdownToHtml(customBlock.lines.join("\n"));
    html.push(`<div class="custom-block ${type}"><p class="custom-block-title">${inlineMarkdown(escapeHtml(title))}</p>${body}</div>`);
    customBlock = null;
  }

  for (const line of lines) {
    if (customBlock) {
      const trimmed = line.trim();
      if (!customBlock.inCode && trimmed === ":::") {
        flushCustomBlock();
        continue;
      }
      if (trimmed.startsWith("```")) customBlock.inCode = !customBlock.inCode;
      customBlock.lines.push(line);
      continue;
    }

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

    const customBlockStart = line.trim().match(/^:::\s*(tip|info|note|warning|danger)(?:\s+(.*))?$/i);
    if (customBlockStart) {
      flushParagraph();
      closeList();
      flushQuote();
      customBlock = {
        type: customBlockStart[1].toLowerCase(),
        title: (customBlockStart[2] || "").trim(),
        lines: [],
        inCode: false,
      };
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
  flushCustomBlock();
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

function customBlockTitle(type) {
  const titles = {
    tip: "TIP",
    info: "INFO",
    note: "NOTE",
    warning: "WARNING",
    danger: "DANGER",
  };
  return titles[type] || type.toUpperCase();
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function inlineMarkdown(html) {
  // 先把行内代码抽成占位符，避免代码里的 * [ ] ( ) 被当成强调或链接语法。
  const codeSpans = [];
  const withPlaceholders = html.replace(/`([^`]+)`/g, (_match, code) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  // URL 部分允许一层成对括号，兼容历史内容里未编码的 "file (1).pdf" 类链接。
  const rendered = withPlaceholders
    .replace(/&lt;a\s+([\s\S]*?)&gt;([\s\S]*?)&lt;\/a&gt;/gi, renderSafeHtmlAnchor)
    .replace(/!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+)\)/g, (_match, alt, src) => {
      const safeSrc = normalizeAssetUrl(src);
      return `<img src="${safeSrc}" alt="${alt}" loading="lazy">`;
    })
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.*?)~~/g, "<del>$1</del>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)/g,
      (_match, label, href) => {
        const safeHref = href.startsWith("http") || href.startsWith("/") || href.startsWith("mailto:")
          ? normalizeInternalHref(href)
          : `/page.html?p=${href.replace(/^\.\//, "").replace(/\.html$/, "").replace(/\.md$/, "")}`;
        const rel = safeHref.startsWith("http") ? ' rel="noreferrer"' : "";
        const target = safeHref.startsWith("http") ? ' target="_blank"' : "";
        return `<a href="${safeHref}"${target}${rel}>${label}</a>`;
      },
    );

  return rendered.replace(/\u0000(\d+)\u0000/g, (_match, index) => codeSpans[Number(index)]);
}

function renderSafeHtmlAnchor(_match, rawAttrs, label) {
  const attrs = parseEscapedHtmlAttributes(rawAttrs);
  const href = safeLinkUrl(attrs.href || "");
  if (!href) return label;

  const normalizedHref = normalizeInternalHref(href);
  const classes = String(attrs.class || "")
    .split(/\s+/)
    .filter((name) => name === "link-button")
    .join(" ");
  const classAttr = classes ? ` class="${classes}"` : "";
  const target = attrs.target === "_blank" || normalizedHref.startsWith("http") ? ' target="_blank"' : "";
  const rel = target ? ' rel="noopener noreferrer"' : "";
  const ariaLabel = attrs["aria-label"] ? ` aria-label="${escapeHtml(attrs["aria-label"])}"` : "";
  const title = attrs.title ? ` title="${escapeHtml(attrs.title)}"` : "";
  return `<a${classAttr} href="${escapeHtml(normalizedHref)}"${target}${rel}${ariaLabel}${title}>${label}</a>`;
}

function parseEscapedHtmlAttributes(rawAttrs) {
  const attrs = {};
  const pattern = /([a-zA-Z:-]+)\s*=\s*(?:&quot;([\s\S]*?)&quot;|&#39;([\s\S]*?)&#39;|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(rawAttrs))) {
    const name = match[1].toLowerCase();
    attrs[name] = decodeEscapedAttribute(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function decodeEscapedAttribute(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
  const normalized = normalizeLegacyMediaUrl(String(value || "").trim());
  if (normalized.startsWith("http") || normalized.startsWith("/media/") || normalized.startsWith("/logo")) {
    return normalized;
  }
  if (normalized.startsWith("media/")) return `/${normalized}`;
  if (normalized.startsWith("/avatars/")) return normalized.replace("/avatars/", "/media/avatars/");
  if (normalized.startsWith("/avatars,")) return normalized.replace("/avatars,", "/media/avatars/");
  return normalized;
}

function normalizeLegacyMediaUrl(value) {
  return value
    .replace(/^(https?:\/\/[^/]+\/media\/(?:avatars|hall-of-fame|posts|knowledge|site)),/i, "$1/")
    .replace(/^(\/media\/(?:avatars|hall-of-fame|posts|knowledge|site)),/i, "$1/")
    .replace(/^media\/(avatars|hall-of-fame|posts|knowledge|site),/i, "media/$1/")
    .replace(/^\/avatars,/i, "/media/avatars/");
}

function safeDisplayAssetUrl(value) {
  const raw = normalizeAssetUrl(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("/media/") || raw.startsWith("/images/") || raw.startsWith("/logo")) {
    return raw;
  }
  return "";
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

// 只允许安全协议的链接，阻断 javascript:/data: 等点击型 XSS。
// 后台填入的成员/名人堂联系方式会经过这里再渲染。
function safeLinkUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") || raw.startsWith("#")) return raw;
  if (/^(https?:|mailto:)/i.test(raw)) return raw;
  return "";
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

function isQQContactLabel(label) {
  return String(label || "").trim().toLowerCase() === "qq";
}

function qqContactUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = raw.match(/^\d+$/);
  if (direct) return `https://wpa.qq.com/msgrd?v=3&uin=${direct[0]}&site=qq&menu=yes`;

  const oldQm = raw.match(/^https?:\/\/qm\.qq\.com\/q\/(\d+)\/?$/i);
  if (oldQm) return `https://wpa.qq.com/msgrd?v=3&uin=${oldQm[1]}&site=qq&menu=yes`;

  const uin = raw.match(/[?&]uin=(\d+)/i);
  if (uin) return `https://wpa.qq.com/msgrd?v=3&uin=${uin[1]}&site=qq&menu=yes`;

  return raw;
}

function safeContactLinkUrl(link) {
  const label = link?.label || "";
  const raw = link?.url || "";
  return safeLinkUrl(isQQContactLabel(label) ? qqContactUrl(raw) : raw);
}

// 弹窗通用关闭行为：Esc、点击遮罩。返回清理函数，close 时调用避免监听残留。
function setupModalDismiss(modal, close) {
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };
  modal.onclick = (event) => {
    if (event.target === modal) close();
  };
  document.addEventListener("keydown", onKeydown);
  return () => {
    modal.onclick = null;
    document.removeEventListener("keydown", onKeydown);
  };
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

function renderArticleTagFilter(posts) {
  const select = document.querySelector("[data-article-tag]");
  if (!select) return;

  const tags = postTags(posts);
  const urlTag = new URLSearchParams(location.search).get("tag") || "";
  const selected = tags.includes(urlTag) ? urlTag : "all";
  select.innerHTML = [
    '<option value="all">全部标签</option>',
    ...tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`),
  ].join("");
  select.value = selected;
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
      .slice(0, LIST_PAGE_SIZE)
      .map(
        (post) => `
          <article class="card reveal visible">
            <span class="flash"></span>
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
    .map(
      (post) => `
          <article class="card article-card reveal visible" data-article-card data-status="${escapeHtml(post.status)}" data-tags="${escapeHtml(postTagsDataValue(post))}" data-search="${escapeHtml(`${post.title} ${postTag(post)} ${post.excerpt || ""} ${postAuthorNames(post)}`.toLowerCase())}">
          <span class="flash"></span>
          ${postCoverUrl(post) ? `<div class="article-cover"><img src="${escapeHtml(postCoverUrl(post))}" alt="" loading="lazy"></div>` : ""}
          <div class="article-head">
            <div class="meta">${postTimeMetaHtml(post)}${admin ? `<span>${post.status === "published" ? "已发布" : "草稿"}</span>` : ""}<span>${formatViews(post.view_count)}</span></div>
          </div>
          <h2><a href="${admin ? `/admin/?slug=${encodeURIComponent(post.slug)}` : `/post.html?slug=${encodeURIComponent(post.slug)}`}">${escapeHtml(post.title)}</a></h2>
          <p>${escapeHtml(post.excerpt || "")}</p>
          <div class="card-footer">
            <div class="contact-row">${postTagsHtml(post)}</div>
            <a class="read-more" href="${admin ? `/admin/?slug=${encodeURIComponent(post.slug)}` : `/post.html?slug=${encodeURIComponent(post.slug)}`}">阅读全文 →</a>
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
      const tag = new URL(link.href, location.href).searchParams.get("tag") || "";
      link.classList.toggle("active", Boolean(selectedTag) && tag === selectedTag);
    });
    if (empty) empty.hidden = matches.length > 0;
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

async function renderKnowledgeBase() {
  const list = document.querySelector("[data-knowledge-list]");
  if (!list) return;

  const search = document.querySelector("[data-knowledge-search]");
  const tagSelect = document.querySelector("[data-knowledge-tag]");
  const summary = document.querySelector("[data-knowledge-summary]");
  const empty = document.querySelector("[data-knowledge-empty]");
  const pagination = document.querySelector("[data-knowledge-pagination]");
  let posts = [];

  try {
    const data = await fetchJson("/api/posts?kind=knowledge");
    posts = data.posts || [];
  } catch (error) {
    list.innerHTML = `<p class="empty-state error">${escapeHtml(error.message)}</p>`;
    return;
  }

  const tags = postTags(posts);
  if (tagSelect) {
    const urlTag = new URLSearchParams(location.search).get("tag") || "";
    const selected = tags.includes(urlTag) ? urlTag : "all";
    tagSelect.innerHTML = [
      '<option value="all">全部标签</option>',
      ...tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`),
    ].join("");
    tagSelect.value = selected;
  }

  function render() {
    const keyword = (search?.value || "").trim().toLowerCase();
    const selectedTag = tagSelect?.value && tagSelect.value !== "all" ? tagSelect.value : "";
    const filtered = posts.filter((post) => {
      const haystack = `${post.title} ${post.tag || ""} ${post.excerpt || ""} ${postAuthorNames(post)}`.toLowerCase();
      return (!keyword || haystack.includes(keyword)) && (!selectedTag || postTagList(post).includes(selectedTag));
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
    const page = Math.min(currentPageFromUrl(), totalPages);
    const start = (page - 1) * LIST_PAGE_SIZE;
    const pagePosts = filtered.slice(start, start + LIST_PAGE_SIZE);

    if (summary) {
      const tagCount = postTagCounts(posts).length;
      const views = posts.reduce((sum, post) => sum + viewCount(post.view_count), 0);
      summary.innerHTML = `
        <div><strong>${posts.length.toLocaleString("zh-CN")}</strong><span>资料条目</span></div>
        <div><strong>${tagCount.toLocaleString("zh-CN")}</strong><span>标签分类</span></div>
        <div><strong>${views.toLocaleString("zh-CN")}</strong><span>累计阅读</span></div>
      `;
    }

    if (!filtered.length) {
      list.innerHTML = posts.length ? '<p class="empty-state">暂无匹配的知识库条目。</p>' : "";
      if (empty) empty.hidden = posts.length > 0;
      renderPagination(pagination, { page: 1, total: 0, onPage: render });
      return;
    }

    if (empty) empty.hidden = true;
    renderPagination(pagination, {
      page,
      total: filtered.length,
      onPage: render,
    });
    list.innerHTML = pagePosts
      .map(
        (post) => `
          <article class="card article-card knowledge-entry reveal visible" data-knowledge-card data-tags="${escapeHtml(postTagsDataValue(post))}">
            <span class="flash"></span>
            ${postCoverUrl(post) ? `<div class="article-cover"><img src="${escapeHtml(postCoverUrl(post))}" alt="" loading="lazy"></div>` : ""}
            <div class="article-head">
              <div class="meta">${postTimeMetaHtml(post)}<span>${formatViews(post.view_count)}</span></div>
            </div>
            <h2><a href="/post.html?slug=${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
            <p>${escapeHtml(post.excerpt || "")}</p>
            <div class="card-footer">
              <div class="contact-row">${postTagsHtml(post)}</div>
              <a class="read-more" href="/post.html?slug=${encodeURIComponent(post.slug)}">查看资料 →</a>
            </div>
          </article>
        `,
      )
      .join("");
  }

  if (search && !search.dataset.boundKnowledgeFilter) {
    search.dataset.boundKnowledgeFilter = "1";
    search.addEventListener("input", () => {
      setPageParam("page", 1);
      render();
    });
  }
  if (tagSelect && !tagSelect.dataset.boundKnowledgeFilter) {
    tagSelect.dataset.boundKnowledgeFilter = "1";
    tagSelect.addEventListener("change", () => {
      const url = new URL(location.href);
      if (tagSelect.value && tagSelect.value !== "all") {
        url.searchParams.set("tag", tagSelect.value);
      } else {
        url.searchParams.delete("tag");
      }
      url.searchParams.delete("page");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      render();
    });
  }

  render();
}

async function renderHomeHero() {
  const hero = document.querySelector("[data-home-hero]");
  if (!hero) return;

  try {
    const data = await fetchSiteRecord("homepage-gallery");
    const items = JSON.parse(data.record.content || "[]");
    if (!Array.isArray(items) || !items.length) return;

    const active = items.find((item) => item.active) || items[0];
    // 走展示白名单并转义引号/反斜杠，避免 URL 打破 CSS url("...") 上下文。
    const background = safeDisplayAssetUrl(active?.url).replace(/\\/g, "%5C").replace(/"/g, "%22");
    if (!background) return;

    const target = hero.querySelector(".hero-bg") || hero;
    target.style.backgroundImage = `url("${background}")`;
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
    const data = await fetchSiteRecord(HOME_NOTICE_KEY);
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

async function renderFriendLinks() {
  const footers = Array.from(document.querySelectorAll(".footer"));
  if (!footers.length) return;
  const footerDefaults = new Map(footers.map((footer) => [footer, defaultFooterCopyState(footer)]));

  let state = { ...DEFAULT_FRIEND_LINKS, links: [...DEFAULT_FRIEND_LINKS.links] };
  // 友链与页脚文案同步发起，落在同一个批量请求里。
  const statePromise = (async () => {
    try {
      const data = await fetchSiteRecord(FRIEND_LINKS_KEY);
      if (data.record?.kind === "json") {
        state = normalizeFriendLinksState(JSON.parse(data.record.content || "{}"));
      }
    } catch {
      // Missing friend-link records keep the default footer links until an admin saves.
    }
  })();

  await Promise.all(footers.map(async (footer) => {
    const copyState = await loadFooterCopyState(footerCopyKey(footer), footerDefaults.get(footer));
    await statePromise;
    renderFooterCopyInto(footer, copyState, false);
    renderFriendLinksInto(footer, state, false);
  }));

  try {
    const me = await currentUser();
    if (!me.admin) return;
    footers.forEach((footer) => {
      const copyState = currentFooterCopyState(footer);
      renderFooterCopyInto(footer, copyState, true);
      renderFriendLinksInto(footer, state, true);
    });
  } catch {
    // Anonymous visitors just see the links.
  }
}

async function loadFooterCopyState(key, fallback) {
  try {
    const data = await fetchSiteRecord(key);
    if (data.record?.kind === "json") {
      return normalizeFooterCopyState(JSON.parse(data.record.content || "{}"), fallback);
    }
  } catch {
    // Missing footer copy records keep the built-in HTML copy until an admin saves.
  }
  return fallback;
}

function renderFooterCopyInto(footer, state, editable) {
  const { left, right } = ensureFooterTextNodes(footer);
  left.textContent = state.left;
  right.textContent = state.right;

  let button = footer.querySelector("[data-edit-footer-copy]");
  if (!editable) {
    button?.remove();
    return;
  }

  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "btn secondary compact footer-edit-button";
    button.dataset.editFooterCopy = "";
    button.textContent = "编辑页脚";
    footer.append(button);
  }
  button.onclick = () => openFooterCopyEditor(footer);
}

function renderFriendLinksInto(footer, state, editable) {
  let section = footer.querySelector("[data-friend-links]");
  if (!section) {
    section = document.createElement("div");
    section.className = "footer-friend-links";
    section.dataset.friendLinks = "";
  }
  const { left } = ensureFooterTextNodes(footer);
  left.after(section);

  const links = normalizeFriendLinks(state.links);
  const title = String(state.title || DEFAULT_FRIEND_LINKS.title).trim() || DEFAULT_FRIEND_LINKS.title;
  section.innerHTML = `
    <div class="footer-friend-head">
      <strong>${escapeHtml(title)}</strong>
      ${editable ? '<button type="button" class="btn secondary compact" data-edit-friend-links>编辑友链</button>' : ""}
    </div>
    <div class="footer-friend-list">
      ${
        links.length
          ? links.map(renderFriendLink).join("")
          : '<span class="footer-friend-empty">暂无友链</span>'
      }
    </div>
  `;

  section.querySelector("[data-edit-friend-links]")?.addEventListener("click", () => {
    openFriendLinksEditor({ title, links });
  });
}

function renderFriendLink(link) {
  const href = safeLinkUrl(link.href);
  if (!href) return "";
  const icon = safeDisplayAssetUrl(link.icon);
  const label = String(link.label || href).trim();
  const target = href.startsWith("http") ? ' target="_blank" rel="noreferrer"' : "";
  return `
    <a class="footer-friend-link" href="${escapeHtml(href)}"${target}>
      ${
        icon
          ? `<img class="footer-friend-icon" src="${escapeHtml(icon)}" alt="" loading="lazy">`
          : `<span class="footer-friend-icon fallback" aria-hidden="true">${escapeHtml(label.slice(0, 1).toUpperCase() || "友")}</span>`
      }
      <span>${escapeHtml(label)}</span>
    </a>
  `;
}

function normalizeFriendLinksState(value) {
  const raw = Array.isArray(value) ? { links: value } : value && typeof value === "object" ? value : {};
  return {
    title: String(raw.title || DEFAULT_FRIEND_LINKS.title).trim() || DEFAULT_FRIEND_LINKS.title,
    links: normalizeFriendLinks(raw.links),
  };
}

function normalizeFriendLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .map((link) => ({
      label: String(link?.label || "").trim(),
      href: String(link?.href || link?.url || "").trim(),
      icon: String(link?.icon || "").trim(),
    }))
    .filter((link) => link.label && safeLinkUrl(link.href));
}

function openFriendLinksEditor(state) {
  const modal = ensureFriendLinksModal();
  const titleInput = modal.querySelector("[data-friend-links-title]");
  const linksInput = modal.querySelector("[data-friend-links-items]");
  const message = modal.querySelector("[data-friend-links-message]");
  titleInput.value = state.title || DEFAULT_FRIEND_LINKS.title;
  linksInput.value = normalizeFriendLinks(state.links)
    .map((link) => [link.label, link.href, link.icon].join(" | "))
    .join("\n");
  message.textContent = "";
  modal.hidden = false;
  document.body.classList.add("modal-open");
  titleInput.focus();

  let teardownDismiss = () => {};
  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    teardownDismiss();
  };
  teardownDismiss = setupModalDismiss(modal, close);

  modal.querySelector("[data-friend-links-close]").onclick = close;
  modal.querySelector("[data-friend-links-save]").onclick = async () => {
    const nextState = {
      title: titleInput.value.trim() || DEFAULT_FRIEND_LINKS.title,
      links: parseFriendLinksInput(linksInput.value),
    };

    message.textContent = "正在保存...";
    try {
      await saveSiteJsonRecord(FRIEND_LINKS_KEY, nextState.title, nextState);
      document.querySelectorAll(".footer").forEach((footer) => {
        renderFooterCopyInto(footer, currentFooterCopyState(footer), true);
        renderFriendLinksInto(footer, nextState, true);
      });
      message.textContent = "已保存";
      close();
    } catch (error) {
      message.textContent = error.message;
    }
  };
}

function parseFriendLinksInput(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      return {
        label: parts[0] || "",
        href: parts[1] || "",
        icon: parts[2] || "",
      };
    })
    .filter((link) => link.label && safeLinkUrl(link.href));
}

function ensureFriendLinksModal() {
  let modal = document.querySelector("[data-friend-links-modal]");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.dataset.friendLinksModal = "";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="友链编辑器">
      <div class="modal-head">
        <div>
          <h2>编辑友链</h2>
          <p class="meta">保存后写入 D1 数据库，并同步到所有页面页脚。</p>
        </div>
        <button type="button" class="icon-button" data-friend-links-close aria-label="关闭编辑器">×</button>
      </div>
      <div class="modal-body">
        <section class="editor-shell admin-form">
          <label>
            标题
            <input class="admin-input" data-friend-links-title placeholder="友情链接" />
          </label>
          <label>
            友链列表（每行一个，格式：名称 | 链接 | 图标地址）
            <textarea class="admin-input" data-friend-links-items rows="8" placeholder="燕山大学 | https://www.ysu.edu.cn/ | /media/icons/ysu.png"></textarea>
          </label>
          <div class="editor-actions">
            <button type="button" class="btn primary" data-friend-links-save>保存友链</button>
          </div>
          <p class="meta" data-friend-links-message></p>
        </section>
      </div>
    </div>
  `;
  document.body.append(modal);
  return modal;
}

function defaultFooterCopyState(footer) {
  const { left, right } = ensureFooterTextNodes(footer);
  if (!footer.dataset.defaultFooterLeft) {
    footer.dataset.defaultFooterLeft = left.textContent.trim();
  }
  if (!footer.dataset.defaultFooterRight) {
    footer.dataset.defaultFooterRight = right.textContent.trim();
  }
  return {
    left: footer.dataset.defaultFooterLeft || "",
    right: footer.dataset.defaultFooterRight || "",
  };
}

function currentFooterCopyState(footer) {
  const { left, right } = ensureFooterTextNodes(footer);
  return {
    left: left.textContent.trim(),
    right: right.textContent.trim(),
  };
}

function normalizeFooterCopyState(value, fallback) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    left: String(raw.left === undefined ? fallback.left || "" : raw.left).trim(),
    right: String(raw.right === undefined ? fallback.right || "" : raw.right).trim(),
  };
}

function ensureFooterTextNodes(footer) {
  let left = Array.from(footer.children).find((node) => node.dataset?.footerLeft);
  let right = Array.from(footer.children).find((node) => node.dataset?.footerRight);
  const spans = Array.from(footer.children).filter((node) => node.tagName === "SPAN");

  if (!left) {
    left = spans[0] || document.createElement("span");
    left.dataset.footerLeft = "";
    if (!left.parentElement) footer.prepend(left);
  }

  if (!right) {
    right = spans.find((span) => span !== left) || document.createElement("span");
    right.dataset.footerRight = "";
    if (!right.parentElement) footer.append(right);
  }

  return { left, right };
}

function footerCopyKey(footer) {
  if (footer.dataset.footerKey) return footer.dataset.footerKey;
  const path = location.pathname.replace(/\/index\.html$/i, "/");
  const page = path === "/"
    ? "home"
    : path.replace(/^\/+|\/+$/g, "").replace(/\.html$/i, "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  footer.dataset.footerKey = `${FOOTER_COPY_PREFIX}-${page || "home"}`.slice(0, 80);
  return footer.dataset.footerKey;
}

function openFooterCopyEditor(footer) {
  const modal = ensureFooterCopyModal();
  const leftInput = modal.querySelector("[data-footer-copy-left]");
  const rightInput = modal.querySelector("[data-footer-copy-right]");
  const message = modal.querySelector("[data-footer-copy-message]");
  const state = currentFooterCopyState(footer);
  const key = footerCopyKey(footer);

  leftInput.value = state.left;
  rightInput.value = state.right;
  message.textContent = "";
  modal.hidden = false;
  document.body.classList.add("modal-open");
  leftInput.focus();

  let teardownDismiss = () => {};
  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    teardownDismiss();
  };
  teardownDismiss = setupModalDismiss(modal, close);

  modal.querySelector("[data-footer-copy-close]").onclick = close;
  modal.querySelector("[data-footer-copy-save]").onclick = async () => {
    const nextState = {
      left: leftInput.value.trim(),
      right: rightInput.value.trim(),
    };

    message.textContent = "正在保存...";
    try {
      await saveSiteJsonRecord(key, "页脚文案", nextState);
      document.querySelectorAll(".footer").forEach((item) => {
        if (footerCopyKey(item) === key) {
          renderFooterCopyInto(item, nextState, true);
        }
      });
      message.textContent = "已保存";
      close();
    } catch (error) {
      message.textContent = error.message;
    }
  };
}

function ensureFooterCopyModal() {
  let modal = document.querySelector("[data-footer-copy-modal]");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.dataset.footerCopyModal = "";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="页脚文案编辑器">
      <div class="modal-head">
        <div>
          <h2>编辑页脚</h2>
          <p class="meta">保存后写入 D1 数据库，仅更新当前页面类型的页脚文案。</p>
        </div>
        <button type="button" class="icon-button" data-footer-copy-close aria-label="关闭编辑器">×</button>
      </div>
      <div class="modal-body">
        <section class="editor-shell admin-form">
          <label>
            左侧文案
            <input class="admin-input" data-footer-copy-left />
          </label>
          <label>
            右侧文案
            <input class="admin-input" data-footer-copy-right />
          </label>
          <div class="editor-actions">
            <button type="button" class="btn primary" data-footer-copy-save>保存页脚</button>
          </div>
          <p class="meta" data-footer-copy-message></p>
        </section>
      </div>
    </div>
  `;
  document.body.append(modal);
  return modal;
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
    const data = await fetchSiteRecord(key);
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
  if (!me.admin) return;

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
  fieldsContainer.querySelector("textarea")?.focus();

  let teardownDismiss = () => {};
  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    teardownDismiss();
  };
  teardownDismiss = setupModalDismiss(modal, close);

  modal.querySelector("[data-block-editor-close]").onclick = close;
  const blockSaveButton = modal.querySelector("[data-block-editor-save]");
  blockSaveButton.onclick = async () => {
    if (blockSaveButton.disabled) return;
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
    blockSaveButton.disabled = true;
    try {
      const title = block.dataset.editableTitle || nextState.fields.title || key;
      await saveSiteJsonRecord(key, title, nextState);
      applyEditableBlockState(block, nextState);
      message.textContent = "已保存";
      close();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      blockSaveButton.disabled = false;
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
          <p class="meta" aria-live="polite" data-block-editor-message></p>
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

// 文章 hero 已展示标题；正文若以同名一级标题开头则去掉，避免页面出现两个相同 h1。
function stripDuplicateLeadingTitle(markdown, title) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return markdown;
  const lines = stripFrontmatter(markdown).replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  const heading = lines[index]?.match(/^#\s+(.+?)\s*$/);
  if (!heading || heading[1].trim() !== cleanTitle) return markdown;
  lines.splice(index, 1);
  return lines.join("\n");
}

function articleHeadingSlug(value, fallback) {
  return String(value || "")
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function renderArticleToc(article) {
  const toc = document.querySelector("[data-article-toc]");
  const list = toc?.querySelector("[data-article-toc-list]");
  if (!toc || !list) return;

  const headings = Array.from(article.children).filter((node) => node.matches("h1, h2"));
  if (!headings.length) {
    toc.hidden = true;
    list.innerHTML = "";
    return;
  }

  const usedIds = new Set();
  const entries = headings.map((heading, index) => {
    const label = heading.textContent.trim() || `章节 ${index + 1}`;
    const baseId = `article-${articleHeadingSlug(label, `section-${index + 1}`)}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id) || document.getElementById(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    heading.id = id;
    const subheading = heading.tagName === "H2" ? " is-subheading" : "";
    return `<a class="article-toc-link${subheading}" href="#${escapeHtml(id)}">${escapeHtml(label)}</a>`;
  });

  list.innerHTML = entries.join("");
  toc.hidden = false;
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
    article.innerHTML = `
      ${markdownToHtml(stripDuplicateLeadingTitle(data.markdown, data.post.title))}
    `;
    renderArticleToc(article);
    bindAuthorAvatarFallbacks(document);
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

async function renderDepartmentMarkdownPage() {
  const containers = Array.from(document.querySelectorAll("[data-department-markdown-page]"));
  if (!containers.length) return;
  await Promise.all(containers.map(renderDepartmentMarkdownContainer));
}

async function renderDepartmentMarkdownContainer(container) {
  const page = container.dataset.departmentMarkdownPage || "";
  if (!isSafeMarkdownPath(page)) {
    container.innerHTML = '<div class="article-body"><p class="empty-state error">部门页面路径无效。</p></div>';
    return;
  }

  const defaultTitle = container.dataset.departmentMarkdownTitle || pageTitleFromPath(page);
  const defaultMarkdown =
    container.querySelector("[data-department-markdown-default]")?.textContent.trim()
    || `# ${defaultTitle}\n\n`;

  let title = defaultTitle;
  let markdown = defaultMarkdown;
  try {
    const data = await fetchJson(pageApiPath(page));
    const content = String(data.page?.content || "").trim();
    if (content) {
      markdown = content;
      title = firstHeading(markdown) || data.page.title || defaultTitle;
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      container.innerHTML = `<div class="article-body"><p class="empty-state error">${escapeHtml(error.message)}</p></div>`;
      return;
    }
  }

  container.innerHTML = `<div class="article-body">${markdownToHtml(markdown)}</div>`;
  await attachStaticPageEditor(container, {
    page,
    title,
    markdown,
    editorTitle: `编辑${defaultTitle}详情`,
    editorHelper: "保存后会作为固定 Markdown 页面写入 D1，并纳入 Markdown 备份。",
  });
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
    const data = await fetchSiteRecord(key);
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
  const terms = sortedMemberTerms(items);
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
        ${terms.map((term) => renderMemberTerm(term, items.filter((item) => memberTermLabel(item) === term), term === activeTerm)).join("")}
      </div>
    </div>
  `;
}

function renderMemberTerm(term, items, active) {
  const departments = ["主席团", "开发部", "网络安全部", "运维部", "组宣部"];
  return `
    <section data-term-panel="${escapeHtml(term)}" ${active ? "" : "hidden"}>
      ${departments
        .map((department) => {
          const departmentItems = items.filter((item) => normalizeDepartmentName(item.department || "未分组") === department);
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

function normalizeDepartmentName(value) {
  return value === "\u7ec4\u5ba3\u79d8\u4e66\u5904" || value === "秘书处" ? "组宣部" : value;
}

function memberDepartmentLabel(item) {
  return normalizeDepartmentName(String(item?.department || "").trim()) || "未分组";
}

function sortedMemberDepartments(items) {
  const preferredDepartments = ["主席团", "开发部", "网络安全部", "运维部", "组宣部"];
  const departments = [...new Set(items.map(memberDepartmentLabel))];
  return departments.sort((a, b) => {
    const rankA = preferredDepartments.indexOf(a);
    const rankB = preferredDepartments.indexOf(b);
    if (rankA !== -1 || rankB !== -1) {
      if (rankA === -1) return 1;
      if (rankB === -1) return -1;
      return rankA - rankB;
    }
    if (a === "未分组") return 1;
    if (b === "未分组") return -1;
    return a.localeCompare(b, "zh-CN");
  });
}

function memberTermLabel(item) {
  return String(item?.term || "").trim() || "未填写届数";
}

function sortedMemberTerms(items) {
  return [...new Set(items.map(memberTermLabel))].sort(compareMemberTerms);
}

function compareMemberTerms(a, b) {
  const rankA = memberTermOrdinal(a);
  const rankB = memberTermOrdinal(b);
  if (rankA !== null || rankB !== null) {
    if (rankA === null) return 1;
    if (rankB === null) return -1;
    if (rankA !== rankB) return rankB - rankA;
  }
  if (a === "未填写届数") return 1;
  if (b === "未填写届数") return -1;
  return String(a).localeCompare(String(b), "zh-CN", { numeric: true });
}

function memberTermOrdinal(value) {
  const text = String(value || "").trim().replace(/\s+/g, "");
  if (!text || text === "未填写届数") return null;

  const numberMatch = text.match(/^第?(\d+)届?$/) || text.match(/^(\d+)$/);
  if (numberMatch) return Number(numberMatch[1]);

  const chineseMatch = text.match(/^第?([零〇一二两三四五六七八九十百千万廿卅]+)届?$/);
  if (!chineseMatch) return null;
  return parseChineseOrdinal(chineseMatch[1]);
}

function parseChineseOrdinal(value) {
  const text = String(value || "");
  const digitMap = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (text.startsWith("廿")) return 20 + (digitMap[text[1]] || 0);
  if (text.startsWith("卅")) return 30 + (digitMap[text[1]] || 0);

  const unitMap = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of text) {
    if (digitMap[char] !== undefined) {
      number = digitMap[char];
      continue;
    }
    const unit = unitMap[char];
    if (!unit) return null;
    if (unit === 10000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }
  const result = total + section + number;
  return result > 0 ? result : null;
}

async function renderTeamRecords() {
  await Promise.all([
    renderTeamRecord("members", document.querySelector("[data-team-members]")),
    renderTeamRecord("hall-of-fame", document.querySelector("[data-team-fame]")),
  ]);
}

async function renderTeamRecord(key, container) {
  if (!container) return;

  try {
    const data = await fetchSiteRecord(key);
    const items = JSON.parse(data.record.content || "[]");
    if (!Array.isArray(items) || !items.length) {
      container.innerHTML = '<p class="empty-state">暂无内容。</p>';
      return;
    }

    container.innerHTML = key === "members"
      ? renderTeamMembers(items)
      : `<div class="member-grid refined-member-grid">${items.map(renderProfileCard).join("")}</div>`;
    bindTeamMemberFilters(container);
  } catch (error) {
    container.innerHTML = isNotFoundError(error)
      ? '<p class="empty-state">暂无内容。</p>'
      : `<p class="empty-state error">${escapeHtml(error.message)}</p>`;
  }
}

function renderTeamMembers(items) {
  const terms = sortedMemberTerms(items);
  const departments = sortedMemberDepartments(items);
  const activeTerm = terms[0];
  return `
    <div class="team-toolbar">
      <div class="team-term-switcher" role="group" aria-label="往届成员届数切换">
        ${terms
          .map((term) => {
            const count = items.filter((item) => memberTermLabel(item) === term).length;
            const active = term === activeTerm;
            return `<button class="team-term-button${active ? " is-active" : ""}" type="button" data-team-term-button="${escapeHtml(term)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(term)}<span>${count.toLocaleString("zh-CN")} 人</span></button>`;
          })
          .join("")}
      </div>
      <label class="field-lite team-department-filter">
        <span>部门</span>
        <select class="select-input" data-team-department-filter aria-label="按部门筛选往届成员">
          <option value="">全部部门</option>
          ${departments.map((department) => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div data-team-term-panels>
      ${terms
        .map((term) => {
          const termItems = items.filter((item) => memberTermLabel(item) === term);
          return `
            <section data-team-term-panel="${escapeHtml(term)}" ${term === activeTerm ? "" : "hidden"}>
              <div class="member-grid refined-member-grid">
                ${termItems.map(renderProfileCard).join("")}
              </div>
              <p class="empty-state team-filter-empty" data-team-filter-empty aria-live="polite" hidden></p>
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

function bindTeamMemberFilters(container) {
  const buttons = Array.from(container.querySelectorAll("[data-team-term-button]"));
  if (!buttons.length) return;
  const departmentFilter = container.querySelector("[data-team-department-filter]");

  const applyFilters = (resetUnavailableDepartment = false) => {
    const activeTerm = buttons.find((button) => button.classList.contains("is-active"))?.dataset.teamTermButton || "";
    const activePanel = Array.from(container.querySelectorAll("[data-team-term-panel]")).find(
      (panel) => panel.dataset.teamTermPanel === activeTerm,
    );
    let department = departmentFilter?.value || "";
    if (resetUnavailableDepartment && department && activePanel) {
      const availableDepartments = new Set(
        Array.from(activePanel.querySelectorAll("[data-member-department]")).map((card) => card.dataset.memberDepartment || ""),
      );
      if (!availableDepartments.has(department)) {
        department = "";
        departmentFilter.value = "";
      }
    }

    container.querySelectorAll("[data-team-term-panel]").forEach((panel) => {
      const active = panel.dataset.teamTermPanel === activeTerm;
      panel.hidden = !active;
      let visibleCount = 0;
      panel.querySelectorAll("[data-member-department]").forEach((card) => {
        const visible = !department || card.dataset.memberDepartment === department;
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      const emptyState = panel.querySelector("[data-team-filter-empty]");
      if (emptyState) {
        emptyState.hidden = !active || visibleCount > 0;
        emptyState.textContent = department ? `当前届数暂无${department}成员。` : "当前届数暂无成员。";
      }
    });
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
      applyFilters(true);
    });
  });
  departmentFilter?.addEventListener("change", applyFilters);
  applyFilters();
}

function renderProfileCard(item) {
  const links = Array.isArray(item.links) ? item.links : [];
  const avatarText = (item.name || item.title || "Y").slice(0, 2).toUpperCase();
  return `
    <article class="member-card refined-member-card reveal visible" data-member-department="${escapeHtml(memberDepartmentLabel(item))}">
      <span class="flash"></span>
      <div class="member-card-top">
        ${
          item.avatar
            ? `<img class="avatar image-avatar" src="${escapeHtml(normalizeAssetUrl(item.avatar))}" alt="${escapeHtml(item.name || "")}" loading="lazy">`
            : `<div class="avatar">${escapeHtml(avatarText)}</div>`
        }
        <span class="tag">${escapeHtml(item.department ? normalizeDepartmentName(item.department) : item.title || "YUNA")}</span>
      </div>
      <h3>${escapeHtml(item.name || "")}</h3>
      ${item.title ? `<p class="meta">${escapeHtml(item.title)}</p>` : ""}
      ${item.desc ? `<p class="profile-desc">${escapeHtml(item.desc)}</p>` : ""}
      ${
        links.length
          ? `<div class="member-actions">${links
              .map((link) => {
                const href = safeContactLinkUrl(link);
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

  let teardownDismiss = () => {};
  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    teardownDismiss();
  };
  teardownDismiss = setupModalDismiss(modal, close);

  modal.querySelector("[data-page-editor-close]").onclick = close;
  const pageSaveButton = modal.querySelector("[data-page-editor-save]");
  pageSaveButton.onclick = async () => {
    if (pageSaveButton.disabled) return;
    const markdown = markdownInput.value;
    const title = titleInput.value.trim() || firstHeading(markdown) || "页面";
    message.textContent = "正在保存...";
    pageSaveButton.disabled = true;

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
    } finally {
      pageSaveButton.disabled = false;
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
          <p class="meta" aria-live="polite" data-page-editor-message></p>
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

function uploadContentMedia(file, path, onProgress) {
  return uploadMediaViaApi("/api/content", file, path, onProgress);
}

// 内容编辑与管理后台共用的媒体上传：小文件直传，大文件走分片。
// apiBase 为 "/api/content" 或 "/api/admin"，两侧接口形状一致。
async function uploadMediaViaApi(apiBase, file, path, onProgress) {
  if (file.size <= DIRECT_MEDIA_UPLOAD_LIMIT) {
    const response = await fetch(`${apiBase}/media/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw httpError(data.error || `上传失败：${response.status}`, response.status);
    onProgress?.(file.size, file.size);
    return data;
  }

  return uploadMultipartViaApi(apiBase, file, path, onProgress);
}

async function uploadMultipartViaApi(apiBase, file, path, onProgress) {
  const init = await fetchJson(`${apiBase}/uploads/init`, {
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
        `${apiBase}/uploads/part?path=${encodeURIComponent(path)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`,
        {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: chunk,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw httpError(data.error || `分片上传失败：${response.status}`, response.status);
      parts.push(data);
      uploaded += chunk.size;
      onProgress?.(uploaded, file.size);
    }

    return fetchJson(`${apiBase}/uploads/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        uploadId: init.uploadId,
        parts,
      }),
    });
  } catch (error) {
    await fetchJson(`${apiBase}/uploads/abort`, {
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
  // ()[] 会破坏 Markdown 链接语法和孤儿检测的 URL 提取，与非法字符一并替换。
  const fallback = "image.png";
  return (name || fallback)
    .replace(/[\\/:*?"<>|#%&{}$!`'@+=()[\]]/g, "-")
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
  fetchSiteRecord,
  uploadMediaViaApi,
  uploadPercent,
  formatDate,
  formatDay,
  formatViews,
  postTimeText,
  postTag,
  postTagsHtml,
  escapeHtml,
  markdownToHtml,
  normalizeAssetUrl,
  safeDisplayAssetUrl,
  safeAuthorUrl,
  authorIdentityHtml,
  postAuthors,
  authorsIdentityHtml,
  bindAuthorAvatarFallbacks,
  renderPostList,
  renderHomeHero,
  renderHomeNotice,
  renderFriendLinks,
  renderKnowledgeBase,
  renderPost,
  renderUserNav,
  initFallbackLogin,
  renderAdminOnlyActions,
  renderEditableBlocks,
  renderTeamRecords,
  renderDepartmentMarkdownPage,
  renderStaticPage,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderFriendLinks);
} else {
  renderFriendLinks();
}
