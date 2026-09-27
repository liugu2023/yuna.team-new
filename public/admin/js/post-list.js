// 后台文章列表：拉取、筛选、分页、统计与删除。

async function refreshPosts() {
  await refreshContentPosts("article");
}

async function refreshContentPosts(kind) {
  const config = contentConfig(kind);
  try {
    const data = await window.blog.fetchJson(`/api/posts?drafts=1&kind=${kind}`);
    state.posts = Array.isArray(data.posts) ? data.posts : [];
    if (config.message) config.message.textContent = "";
    renderContentList(kind);
  } catch (error) {
    state.posts = [];
    renderContentLoadError(kind, error);
  }
}

function renderAdminPostList() {
  renderContentList("article");
}

function contentConfig(kind) {
  return {
    kind,
    items: state.posts,
    list: document.querySelector("[data-post-list]"),
    search: fields.search,
    filterStatus: fields.filterStatus,
    message: fields.postListMessage,
    summary: fields.postSummary,
    pagination: document.querySelector("[data-post-pagination]"),
    page: state.articlePage,
    emptyText: "没有找到匹配的文章，换个关键词或状态试试。",
  };
}

function setContentPage(kind, page) {
  state.articlePage = page;
}

function renderContentPagination(kind, total, page) {
  const config = contentConfig(kind);
  const container = config.pagination;
  if (!container) return;
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <button class="btn secondary compact" type="button" data-admin-prev ${page <= 1 ? "disabled" : ""}>上一页</button>
    <span class="pagination-info">第 ${page} / ${totalPages} 页</span>
    <button class="btn secondary compact" type="button" data-admin-next ${page >= totalPages ? "disabled" : ""}>下一页</button>
  `;
  container.querySelector("[data-admin-prev]")?.addEventListener("click", () => {
    setContentPage(kind, Math.max(1, page - 1));
    renderContentList(kind);
  });
  container.querySelector("[data-admin-next]")?.addEventListener("click", () => {
    setContentPage(kind, Math.min(totalPages, page + 1));
    renderContentList(kind);
  });
}

function renderContentLoadError(kind, error) {
  const config = contentConfig(kind);
  const message = adminErrorText(error);
  if (config.summary) config.summary.innerHTML = "";
  if (config.pagination) config.pagination.innerHTML = "";
  if (config.message) config.message.textContent = `加载失败：${message}`;
  if (config.list) {
    config.list.innerHTML = `<p class="empty-state error">文章列表加载失败：${window.blog.escapeHtml(message)}</p>`;
  }
}

function renderContentList(kind) {
  const config = contentConfig(kind);
  if (!config.list) return;
  const keyword = (config.search?.value || "").trim().toLowerCase();
  const status = config.filterStatus?.value || "all";
  renderPostSummary(kind);
  const posts = config.items.filter((post) => {
    const matchesStatus = status === "all" || post.status === status;
    const coauthorNames = (Array.isArray(post.coauthors) ? post.coauthors : []).map((author) => author?.name || "").join(" ");
    const haystack = `${post.title} ${post.tag || ""} ${post.author_name || ""} ${coauthorNames} ${post.excerpt || ""} ${post.slug}`.toLowerCase();
    return matchesStatus && (!keyword || haystack.includes(keyword));
  });
  const totalPages = Math.max(1, Math.ceil(posts.length / ADMIN_PAGE_SIZE));
  const page = Math.min(config.page, totalPages);
  if (page !== config.page) setContentPage(kind, page);
  const pagePosts = posts.slice((page - 1) * ADMIN_PAGE_SIZE, page * ADMIN_PAGE_SIZE);

  if (!posts.length) {
    config.list.innerHTML = `<p class="empty-state">${config.emptyText}</p>`;
    renderContentPagination(kind, 0, 1);
    return;
  }

  renderContentPagination(kind, posts.length, page);
  const head = `
    <div class="admin-list-head" aria-hidden="true">
      <span>标题</span><span>状态</span><span>作者 · 时间</span><span>阅读</span><span></span>
    </div>
  `;
  config.list.innerHTML = head + pagePosts
    .map((post) => {
      const published = post.status === "published";
      return `
        <article class="admin-item admin-post-card${state.editingSlug === post.slug ? " active is-active" : ""}">
          <div class="admin-item-main">
            <strong>${window.blog.escapeHtml(post.title)}</strong>
            <p class="admin-item-excerpt">${window.blog.escapeHtml(post.excerpt || "")}</p>
            <p class="admin-item-tags">${window.blog.postTagsHtml(post)}</p>
          </div>
          <span class="admin-status ${published ? "is-published" : "is-draft"}">${published ? "已发布" : "草稿"}</span>
          <p class="meta admin-item-meta"><span>${window.blog.escapeHtml(post.author_name || "网络信息协会")}</span><span>${window.blog.postTimeText(post)}</span></p>
          <span class="admin-item-views">${window.blog.formatViews(post.view_count)}</span>
          <div class="editor-actions">
            <button class="btn secondary compact" type="button" data-edit-post="${window.blog.escapeHtml(post.slug)}">编辑</button>
            <button class="btn danger compact" type="button" data-delete-post="${window.blog.escapeHtml(post.slug)}">删除</button>
          </div>
        </article>
      `;
    })
    .join("");

  config.list.querySelectorAll("[data-edit-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      // loadPost 失败（会话过期、草稿被删等）时要把原因写到列表消息栏，而不是无声无息。
      try {
        await loadPost(button.dataset.editPost);
        openEditor();
      } catch (error) {
        if (config.message) config.message.textContent = `加载文章失败：${adminErrorText(error)}`;
      }
    });
  });
  config.list.querySelectorAll("[data-delete-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deletePost(button.dataset.deletePost);
    });
  });
}

function renderPostSummary(kind = "article") {
  const config = contentConfig(kind);
  if (!config.summary) return;
  const total = config.items.length;
  const published = config.items.filter((post) => post.status === "published").length;
  const drafts = config.items.filter((post) => post.status !== "published").length;
  const views = config.items.reduce((sum, post) => sum + Number(post.view_count || 0), 0);
  config.summary.innerHTML = `
    <div><span>全部文章</span><strong>${total.toLocaleString("zh-CN")}</strong></div>
    <div><span>已发布</span><strong>${published.toLocaleString("zh-CN")}</strong></div>
    <div><span>草稿</span><strong>${drafts.toLocaleString("zh-CN")}</strong></div>
    <div><span>总阅读</span><strong>${views.toLocaleString("zh-CN")}</strong></div>
  `;
}

// 请求在途时忽略重复删除：双击会触发两次 confirm，第二次 DELETE 只会得到误导性的 404。
const deletingSlugs = new Set();

async function deletePost(slug) {
  if (!slug || deletingSlugs.has(slug)) return;
  const post = state.posts.find((item) => item.slug === slug);
  const title = post?.title || slug;
  const noun = "文章";
  if (!confirm(`确定删除${noun}「${title}」吗？此操作不可恢复。`)) return;
  const messageEl = fields.postListMessage;

  deletingSlugs.add(slug);
  try {
    messageEl.textContent = `正在删除${noun}...`;
    await window.blog.fetchJson(`/api/posts/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
    if (state.editingSlug === slug) {
      resetEditor();
    }
    await refreshPosts();
    messageEl.textContent = `${noun}已删除。`;
  } catch (error) {
    messageEl.textContent = adminErrorText(error);
  } finally {
    deletingSlugs.delete(slug);
  }
}
