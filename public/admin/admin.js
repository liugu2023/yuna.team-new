const state = {
  editingSlug: null,
  editingKind: "article",
  // 打开编辑器时的 updated_at 快照，保存时回传做乐观锁校验。
  editingUpdatedAt: null,
  editingMemberIndex: null,
  editingFameIndex: null,
  articlePage: 1,
  posts: [],
  members: [],
  fameItems: [],
};
const fields = {
  title: document.querySelector("[data-title]"),
  tag: document.querySelector("[data-post-tag]"),
  authorName: document.querySelector("[data-author-name]"),
  authorUrl: document.querySelector("[data-author-url]"),
  authorAvatar: document.querySelector("[data-author-avatar]"),
  authorGithub: document.querySelector("[data-author-github]"),
  authorAvatarFile: document.querySelector("[data-author-avatar-file]"),
  coauthorsList: document.querySelector("[data-coauthors-list]"),
  lastEditor: document.querySelector("[data-last-editor]"),
  excerpt: document.querySelector("[data-excerpt]"),
  coverUrl: document.querySelector("[data-cover-url]"),
  markdown: document.querySelector("[data-markdown]"),
  message: document.querySelector("[data-message]"),
  preview: document.querySelector("[data-preview]"),
  search: document.querySelector("[data-search]"),
  filterStatus: document.querySelector("[data-filter-status]"),
  postListMessage: document.querySelector("[data-post-list-message]"),
  postSummary: document.querySelector("[data-post-summary]"),
  editorHeading: document.querySelector("[data-editor-heading]"),
  editorState: document.querySelector("[data-editor-state]"),
  coverFile: document.querySelector("[data-cover-file]"),
  postImageFile: document.querySelector("[data-post-image-file]"),
  postFile: document.querySelector("[data-post-file]"),
  memberTerm: document.querySelector("[data-member-term]"),
  memberDepartment: document.querySelector("[data-member-department]"),
  memberRole: document.querySelector("[data-member-role]"),
  memberName: document.querySelector("[data-member-name]"),
  memberImageFile: document.querySelector("[data-member-image-file]"),
  memberAvatar: document.querySelector("[data-member-avatar]"),
  memberDesc: document.querySelector("[data-member-desc]"),
  memberContactLabel: document.querySelector("[data-member-contact-label]"),
  memberContactUrl: document.querySelector("[data-member-contact-url]"),
  memberMessage: document.querySelector("[data-member-message]"),
  memberList: document.querySelector("[data-member-list]"),
  fameName: document.querySelector("[data-fame-name]"),
  fameTitle: document.querySelector("[data-fame-title]"),
  fameImageFile: document.querySelector("[data-fame-image-file]"),
  fameAvatar: document.querySelector("[data-fame-avatar]"),
  fameDesc: document.querySelector("[data-fame-desc]"),
  fameContactLabel: document.querySelector("[data-fame-contact-label]"),
  fameContactUrl: document.querySelector("[data-fame-contact-url]"),
  fameMessage: document.querySelector("[data-fame-message]"),
  fameList: document.querySelector("[data-fame-list]"),
  exportMessage: document.querySelector("[data-export-message]"),
  importModal: document.querySelector("[data-import-modal]"),
  importFile: document.querySelector("[data-import-db-file]"),
  importMessage: document.querySelector("[data-import-message]"),
  importModalMessage: document.querySelector("[data-import-modal-message]"),
  syncMessage: document.querySelector("[data-sync-message]"),
  usageSummary: document.querySelector("[data-usage-summary]"),
  usageMessage: document.querySelector("[data-usage-message]"),
  orphanSummary: document.querySelector("[data-orphan-summary]"),
  orphanMessage: document.querySelector("[data-orphan-message]"),
};

const editorModal = document.querySelector("[data-editor-modal]");
const ADMIN_PAGE_SIZE = 10;
// 作者与最后编辑人默认署协会名，不再取登录账号；两个字段都可手动改。
const DEFAULT_CREDIT_NAME = "网络信息协会";

function collectCoauthors() {
  return Array.from(fields.coauthorsList?.querySelectorAll("[data-coauthor-row]") || []).flatMap((row) => {
    const name = row.querySelector("[data-coauthor-name]")?.value.trim() || "";
    const url = row.querySelector("[data-coauthor-url]")?.value.trim() || "";
    const avatar = row.querySelector("[data-coauthor-avatar]")?.value.trim() || "";
    if (!name && !url && !avatar) return [];
    return [{ name, url, avatar }];
  });
}

function coauthorRowHtml(author = {}) {
  const githubUsername = githubUsernameFromAuthor({
    author_url: author.url || "",
    author_avatar: author.avatar || "",
  });
  return `
    <div class="coauthor-row" data-coauthor-row>
      <label>姓名<input class="admin-input" data-coauthor-name value="${window.blog.escapeHtml(author.name || "")}" placeholder="协同作者姓名" /></label>
      <label>主页<input class="admin-input" data-coauthor-url type="url" value="${window.blog.escapeHtml(author.url || "")}" placeholder="https://example.com/profile" /></label>
      <label>头像<input class="admin-input" data-coauthor-avatar value="${window.blog.escapeHtml(author.avatar || "")}" placeholder="图片地址或 /media/..." /></label>
      <div class="inline-uploader">
        <label>GitHub 用户名<input class="admin-input" data-coauthor-github value="${window.blog.escapeHtml(githubUsername)}" placeholder="例如 octocat" autocomplete="off" /></label>
        <button class="btn secondary compact" type="button" data-use-coauthor-github>读取 GitHub 头像</button>
      </div>
      <button class="coauthor-remove" type="button" data-remove-coauthor aria-label="移除协同作者">×</button>
    </div>`;
}

function renderCoauthors(authors = []) {
  if (!fields.coauthorsList) return;
  const valid = Array.isArray(authors) ? authors : [];
  fields.coauthorsList.innerHTML = valid.length
    ? valid.map(coauthorRowHtml).join("")
    : '<p class="coauthor-empty" data-coauthor-empty>尚未添加协同作者。</p>';
}

function addCoauthor(author = {}) {
  if (!fields.coauthorsList) return;
  fields.coauthorsList.querySelector("[data-coauthor-empty]")?.remove();
  fields.coauthorsList.insertAdjacentHTML("beforeend", coauthorRowHtml(author));
  fields.coauthorsList.querySelector("[data-coauthor-row]:last-child [data-coauthor-name]")?.focus();
  updatePreview();
}

// 异步操作期间锁住触发按钮：双击「发布」会创建两篇文章，导入/同步重复触发同理。
async function withLockedButtons(selector, task) {
  const buttons = Array.from(document.querySelectorAll(selector));
  if (buttons.some((button) => button.disabled)) return;
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    await task();
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function statusLabel(status) {
  return status === "published" ? "已发布" : "草稿";
}

function defaultTag() {
  return "协会动态";
}

function contentFolder() {
  return "posts";
}

function editorSnapshot() {
  return JSON.stringify({
    title: fields.title.value,
    tag: fields.tag.value,
    authorName: fields.authorName.value,
    authorUrl: fields.authorUrl.value,
    authorAvatar: fields.authorAvatar.value,
    authorGithub: fields.authorGithub.value,
    coauthors: collectCoauthors(),
    lastEditor: fields.lastEditor.value,
    excerpt: fields.excerpt.value,
    coverUrl: fields.coverUrl.value,
    markdown: fields.markdown.value,
  });
}

let editorBaseline = editorSnapshot();

function markEditorClean() {
  editorBaseline = editorSnapshot();
}

function isEditorDirty() {
  return editorSnapshot() !== editorBaseline;
}

function openEditor() {
  editorModal.hidden = false;
  document.body.classList.add("modal-open");
  fields.title.focus();
}

function closeEditor(force) {
  if (!force && isEditorDirty() && !confirm("有未保存的修改，确定关闭并丢弃吗？")) {
    return;
  }
  const kind = state.editingKind;
  editorModal.hidden = true;
  document.body.classList.remove("modal-open");
  resetEditor(kind);
}

async function bootAdmin() {
  await refreshAdminData();
  updatePreview();
  updateContactPlaceholder(fields.memberContactLabel, fields.memberContactUrl);
  updateContactPlaceholder(fields.fameContactLabel, fields.fameContactUrl);
  markEditorClean();

  const slug = new URLSearchParams(location.search).get("slug");
  if (slug) {
    try {
      await loadPost(slug);
      openEditor();
    } catch (error) {
      // 错误要落在页面可见处；编辑器还没打开，fields.message 在隐藏的弹窗里看不见。
      fields.postListMessage.textContent = `打开文章「${slug}」失败：${adminErrorText(error)}`;
      updateEditorUrl("", state.editingKind);
    }
  }
}

async function refreshAdminData() {
  const tasks = [
    ["文章与知识库", refreshPosts],
    ["协会成员", loadMembers],
    ["名人堂", loadFame],
  ];
  const results = await Promise.allSettled(tasks.map(([, task]) => task()));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`${tasks[index][0]}加载失败`, result.reason);
    }
  });
}

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
    emptyText: "没有匹配的文章。",
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
  config.list.innerHTML = pagePosts
    .map(
      (post) => `
        <article class="admin-item admin-post-card${state.editingSlug === post.slug ? " active is-active" : ""}">
          <p class="meta"><span>${post.status === "published" ? "已发布" : "草稿"}</span>${window.blog.postTagsHtml(post)}${post.author_name ? `<span>${window.blog.escapeHtml(post.author_name)}</span>` : ""}<span>${window.blog.postTimeText(post)}</span><span>${window.blog.formatViews(post.view_count)}</span></p>
          <strong>${window.blog.escapeHtml(post.title)}</strong>
          <p>${window.blog.escapeHtml(post.excerpt || "")}</p>
          <div class="editor-actions">
            <button class="btn secondary" type="button" data-edit-post="${window.blog.escapeHtml(post.slug)}">编辑</button>
            <button class="btn danger" type="button" data-delete-post="${window.blog.escapeHtml(post.slug)}">删除</button>
          </div>
        </article>
      `,
    )
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
    <div><strong>${total.toLocaleString("zh-CN")}</strong><span>全部文章</span></div>
    <div><strong>${published.toLocaleString("zh-CN")}</strong><span>已发布</span></div>
    <div><strong>${drafts.toLocaleString("zh-CN")}</strong><span>草稿</span></div>
    <div><strong>${views.toLocaleString("zh-CN")}</strong><span>总阅读</span></div>
  `;
}

async function loadPost(slug) {
  const data = await window.blog.fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
  state.editingSlug = slug;
  state.editingKind = "article";
  state.editingUpdatedAt = data.post.updated_at || null;
  fields.title.value = data.post.title;
  fields.tag.value = data.post.tag || defaultTag(state.editingKind);
  fields.authorName.value = data.post.author_name || DEFAULT_CREDIT_NAME;
  fields.authorUrl.value = data.post.author_url || "";
  fields.authorAvatar.value = data.post.author_avatar || "";
  fields.authorGithub.value = githubUsernameFromAuthor(data.post);
  renderCoauthors(data.post.coauthors);
  fields.lastEditor.value = data.post.editor_name || DEFAULT_CREDIT_NAME;
  fields.excerpt.value = data.post.excerpt || "";
  fields.coverUrl.value = data.post.cover_url || "";
  fields.markdown.value = data.markdown;
  fields.editorHeading.textContent = "编辑文章";
  fields.editorState.textContent = `${statusLabel(data.post.status)} · 正在编辑：${data.post.slug}`;
  fields.message.textContent = "";
  updatePreview();
  renderAdminPostList();
  markEditorClean();
  activateAdminTab("posts");
  updateEditorUrl(data.post.slug || slug, state.editingKind);
}

async function savePost(status) {
  await withLockedButtons("[data-publish],[data-save-draft]", async () => {
    fields.message.textContent = status === "published" ? "发布中…" : "保存中…";
    const payload = {
      title: fields.title.value.trim(),
      tag: fields.tag.value.trim(),
      author_name: fields.authorName.value.trim(),
      author_url: fields.authorUrl.value.trim(),
      author_avatar: fields.authorAvatar.value.trim(),
      coauthors: collectCoauthors(),
      editor_name: fields.lastEditor.value.trim(),
      excerpt: fields.excerpt.value.trim(),
      cover_url: fields.coverUrl.value.trim(),
      status,
      kind: state.editingKind,
      markdown: fields.markdown.value,
    };

    const url = state.editingSlug
      ? `/api/posts/${encodeURIComponent(state.editingSlug)}`
      : "/api/posts";
    const method = state.editingSlug ? "PUT" : "POST";
    if (state.editingSlug && state.editingUpdatedAt) {
      payload.expected_updated_at = state.editingUpdatedAt;
    }

    try {
      const data = await window.blog.fetchJson(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.editingSlug = data.post.slug;
      state.editingKind = "article";
      state.editingUpdatedAt = data.post.updated_at || null;
      // 服务端会把留空的署名/标签归一成默认值，回填保持表单与实际数据一致。
      fields.authorName.value = data.post.author_name || DEFAULT_CREDIT_NAME;
      fields.authorUrl.value = data.post.author_url || "";
      fields.authorAvatar.value = data.post.author_avatar || "";
      fields.authorGithub.value = githubUsernameFromAuthor(data.post);
      renderCoauthors(data.post.coauthors);
      fields.lastEditor.value = data.post.editor_name || DEFAULT_CREDIT_NAME;
      fields.tag.value = data.post.tag || defaultTag(state.editingKind);
      fields.editorHeading.textContent = "编辑文章";
      fields.editorState.textContent = `${statusLabel(data.post.status)} · 正在编辑：${data.post.slug}`;
      fields.message.textContent = data.post.status === "published" ? "已发布。" : "已保存为草稿。";
      updatePreview();
      markEditorClean();
      await refreshPosts();
      updateEditorUrl(data.post.slug, state.editingKind);
    } catch (error) {
      fields.message.textContent = error.message;
    }
  });
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

async function insertImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    fields.message.textContent = "只能插入图片文件。";
    return;
  }

  try {
    fields.message.textContent = "图片上传中…";
    const data = await uploadImage(file, `${contentFolder()}/${state.editingSlug || "drafts"}`);
    insertAtCursor(fields.markdown, `\n![${cleanDocumentName(file.name)}](${data.url})\n`);
    fields.message.textContent = `图片已上传：${data.url}`;
    updatePreview();
  } catch (error) {
    fields.message.textContent = error.message;
  }
}

async function insertImageFiles(files) {
  for (const file of files) {
    await insertImageFile(file);
  }
}

async function uploadPostImage() {
  await withLockedButtons("[data-upload-post-image]", async () => {
    const file = fields.postImageFile.files[0];
    if (!file) {
      fields.message.textContent = "请选择文章图片。";
      return;
    }
    await insertImageFile(file);
  });
}

async function uploadCoverImage() {
  await withLockedButtons("[data-upload-cover]", async () => {
    const file = fields.coverFile.files[0];
    if (!file) {
      fields.message.textContent = "请选择封面图。";
      return;
    }
    if (!file.type.startsWith("image/")) {
      fields.message.textContent = "封面图必须是图片文件。";
      return;
    }

    try {
      fields.message.textContent = "封面图上传中…";
      const data = await uploadImage(file, `${contentFolder()}/${state.editingSlug || "drafts"}/cover`);
      fields.coverUrl.value = data.url;
      fields.coverFile.value = "";
      fields.message.textContent = "封面图已设置。";
      updatePreview();
    } catch (error) {
      fields.message.textContent = adminErrorText(error);
    }
  });
}

async function uploadAuthorAvatar() {
  await withLockedButtons("[data-upload-author-avatar]", async () => {
    const file = fields.authorAvatarFile.files[0];
    if (!file) {
      fields.message.textContent = "请选择作者头像。";
      return;
    }
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
      fields.message.textContent = "作者头像仅支持 PNG、JPEG、GIF 或 WebP。";
      return;
    }

    try {
      fields.message.textContent = "作者头像上传中…";
      const data = await uploadImage(file, "avatars/authors");
      fields.authorAvatar.value = data.url;
      fields.authorGithub.value = "";
      fields.authorAvatarFile.value = "";
      fields.message.textContent = "作者头像已设置。";
      updatePreview();
    } catch (error) {
      fields.message.textContent = adminErrorText(error);
    }
  });
}

function githubUsernameFromAuthor(post) {
  const values = [post?.author_avatar, post?.author_url];
  for (const value of values) {
    const match = String(value || "").match(/^https:\/\/(?:www\.)?github\.com\/([^/?#]+)(?:\.png)?(?:[/?#]|$)/i);
    if (match) {
      try {
        return decodeURIComponent(match[1]).replace(/\.png$/i, "");
      } catch {
        return match[1].replace(/\.png$/i, "");
      }
    }
  }
  return "";
}

function useGithubAvatar() {
  const username = fields.authorGithub.value.trim().replace(/^@/, "");
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) {
    fields.message.textContent = "请输入有效的 GitHub 用户名（1–39 位字母、数字或连字符）。";
    return;
  }
  fields.authorGithub.value = username;
  fields.authorAvatar.value = `https://github.com/${encodeURIComponent(username)}.png?size=200`;
  if (!fields.authorUrl.value.trim()) {
    fields.authorUrl.value = `https://github.com/${encodeURIComponent(username)}`;
  }
  fields.message.textContent = `已读取 GitHub 用户 ${username} 的头像。`;
  updatePreview();
}

function useCoauthorGithubAvatar(row) {
  const githubInput = row?.querySelector("[data-coauthor-github]");
  const urlInput = row?.querySelector("[data-coauthor-url]");
  const avatarInput = row?.querySelector("[data-coauthor-avatar]");
  const username = githubInput?.value.trim().replace(/^@/, "") || "";
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) {
    fields.message.textContent = "请输入有效的 GitHub 用户名（1–39 位字母、数字或连字符）。";
    return;
  }
  githubInput.value = username;
  avatarInput.value = `https://github.com/${encodeURIComponent(username)}.png?size=200`;
  if (!urlInput.value.trim()) urlInput.value = `https://github.com/${encodeURIComponent(username)}`;
  fields.message.textContent = `已读取协同作者 ${username} 的 GitHub 头像。`;
  updatePreview();
}

async function uploadPostFiles() {
  await withLockedButtons("[data-upload-post-file]", async () => {
    const files = Array.from(fields.postFile.files || []);
    if (!files.length) {
      fields.message.textContent = "请选择要上传的附件资料。";
      return;
    }

    const urls = [];
    const folder = `${contentFolder()}/${state.editingSlug || "drafts"}/files`;
    fields.message.textContent = "准备上传附件...";

    try {
      for (const [index, file] of files.entries()) {
        const name = `${Date.now()}-${cleanDocumentName(file.name)}`;
        const path = `${folder}/${name}`;
        const data = await uploadMedia(file, path, (loaded, total) => {
          fields.message.textContent = `正在上传附件 ${index + 1}/${files.length}：${file.name} ${uploadPercent(loaded, total)}`;
        });
        urls.push(data.url);
        insertAtCursor(fields.markdown, `\n[点击下载](${data.url})\n`);
      }

      fields.postFile.value = "";
      fields.message.textContent = `附件已上传：${urls.join(" ")}`;
      updatePreview();
    } catch (error) {
      // 清空选择，避免重试时把已成功的文件再传一遍、插入重复链接。
      fields.postFile.value = "";
      fields.message.textContent = `第 ${urls.length + 1} 个附件上传失败：${adminErrorText(error)}。前 ${urls.length} 个已插入正文，请重新选择未上传的文件。`;
      updatePreview();
    }
  });
}

async function uploadMemberAvatar() {
  const file = fields.memberImageFile.files[0];
  if (!file) {
    fields.memberMessage.textContent = "请选择头像。";
    return;
  }

  try {
    const data = await uploadImage(file, "avatars");
    fields.memberAvatar.value = data.url;
    fields.memberMessage.textContent = "头像已上传。";
  } catch (error) {
    fields.memberMessage.textContent = error.message;
  }
}

async function uploadFameAvatar() {
  const file = fields.fameImageFile.files[0];
  if (!file) {
    fields.fameMessage.textContent = "请选择头像。";
    return;
  }

  try {
    const data = await uploadImage(file, "hall-of-fame");
    fields.fameAvatar.value = data.url;
    fields.fameMessage.textContent = "头像已上传。";
  } catch (error) {
    fields.fameMessage.textContent = error.message;
  }
}

async function uploadImage(file, folder) {
  const safeName = `${Date.now()}-${file.name}`.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-");
  const path = `${folder}/${safeName}`.replace(/^\/+/, "");
  return uploadMedia(file, path);
}

async function uploadMedia(file, path, onProgress) {
  return window.blog.uploadMediaViaApi("/api/admin", file, path, onProgress);
}

function uploadPercent(loaded, total) {
  return window.blog.uploadPercent(loaded, total);
}

function cleanDocumentName(value) {
  // ()[] 会破坏 Markdown 链接语法和孤儿检测的 URL 提取（Windows 副本文件名常带括号），一并替换。
  return (value || "file")
    .replace(/[\\/:*?"<>|#%&{}$!`'@+=()[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "file";
}

async function loadMembers() {
  state.members = await loadJsonRecord("members", fields.memberMessage);
  state.editingMemberIndex = null;
  renderFixedList(state.members, fields.memberList, "members");
}

async function loadFame() {
  state.fameItems = await loadJsonRecord("hall-of-fame", fields.fameMessage);
  state.editingFameIndex = null;
  renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");
}

async function loadJsonRecord(key, messageEl) {
  try {
    const data = await window.blog.fetchSiteRecord(key);
    messageEl.textContent = "";
    return JSON.parse(data.record.content || "[]");
  } catch (error) {
    if (error.status === 404 || error.message === "内容不存在") {
      messageEl.textContent = "暂无内容，保存后会自动创建。";
      return [];
    }
    // 其他错误返回 null 并禁止保存：整表读-改-写模式下，把空列表存回去会清空线上数据。
    messageEl.textContent = `加载失败：${adminErrorText(error)}。为防止覆盖线上数据，已禁止保存，请刷新重试。`;
    return null;
  }
}

function adminErrorText(error) {
  if (error?.status === 401) return "登录已过期，请刷新页面重新登录";
  return error?.message || "请求失败";
}

function ensureFixedListLoaded(items, messageEl) {
  if (Array.isArray(items)) return true;
  messageEl.textContent = "列表尚未加载成功，不能保存。请刷新页面重试。";
  return false;
}

async function saveMemberEntry() {
  if (!ensureFixedListLoaded(state.members, fields.memberMessage)) return;

  const item = {
    term: fields.memberTerm.value.trim(),
    department: normalizeMemberDepartment(fields.memberDepartment.value),
    role: fields.memberRole.value,
    name: fields.memberName.value.trim(),
    title: fields.memberRole.value,
    avatar: fields.memberAvatar.value.trim(),
    desc: fields.memberDesc.value.trim(),
    links: [],
  };

  if (fields.memberContactUrl.value.trim()) {
    item.links.push({
      label: fields.memberContactLabel.value,
      url: normalizeContactUrl(fields.memberContactLabel.value, fields.memberContactUrl.value.trim()),
    });
  }

  if (!item.name) {
    fields.memberMessage.textContent = "姓名不能为空。";
    return;
  }

  // 保存失败时回滚本地列表，同时保留表单内容供重试。
  const previous = [...state.members];
  if (Number.isInteger(state.editingMemberIndex) && state.members[state.editingMemberIndex]) {
    state.members[state.editingMemberIndex] = item;
  } else {
    state.members.push(item);
  }
  renderFixedList(state.members, fields.memberList, "members");

  if (await saveMembers()) {
    clearMemberForm();
  } else {
    state.members = previous;
  }
  renderFixedList(state.members, fields.memberList, "members");
}

async function saveFameEntry() {
  if (!ensureFixedListLoaded(state.fameItems, fields.fameMessage)) return;

  const item = {
    term: "",
    department: "",
    role: "",
    name: fields.fameName.value.trim(),
    title: fields.fameTitle.value.trim(),
    avatar: fields.fameAvatar.value.trim(),
    desc: fields.fameDesc.value.trim(),
    links: [],
  };

  if (fields.fameContactUrl.value.trim()) {
    item.links.push({
      label: fields.fameContactLabel.value,
      url: normalizeContactUrl(fields.fameContactLabel.value, fields.fameContactUrl.value.trim()),
    });
  }

  if (!item.name) {
    fields.fameMessage.textContent = "名称不能为空。";
    return;
  }

  const previous = [...state.fameItems];
  if (Number.isInteger(state.editingFameIndex) && state.fameItems[state.editingFameIndex]) {
    state.fameItems[state.editingFameIndex] = item;
  } else {
    state.fameItems.push(item);
  }
  renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");

  if (await saveFame()) {
    clearFameForm();
  } else {
    state.fameItems = previous;
  }
  renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");
}

async function saveMembers() {
  return saveFixedRecord("members", "协会成员", state.members, fields.memberMessage);
}

async function saveFame() {
  return saveFixedRecord("hall-of-fame", "网协名人堂", state.fameItems, fields.fameMessage);
}

async function saveFixedRecord(key, title, items, messageEl) {
  try {
    await window.blog.fetchJson(`/api/admin/site/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        kind: "json",
        content: JSON.stringify(items),
      }),
    });
    messageEl.textContent = "已保存，并写入增量备份。";
    return true;
  } catch (error) {
    messageEl.textContent = `保存失败：${adminErrorText(error)}`;
    return false;
  }
}

function renderFixedList(items, listEl, type) {
  if (!Array.isArray(items)) {
    listEl.innerHTML = '<p class="empty-state error">列表加载失败，暂不能编辑。请刷新页面重试。</p>';
    return;
  }
  if (!items.length) {
    listEl.innerHTML = '<p class="empty-state">当前暂无条目。</p>';
    return;
  }

  listEl.innerHTML = items
    .map((item, index) => {
      const meta =
        type === "members"
          ? `${window.blog.escapeHtml(item.term || "未填写届数")} · ${window.blog.escapeHtml(normalizeMemberDepartment(item.department || ""))}`
          : "名人堂";
      const avatarText = (item.name || item.title || "Y").slice(0, 2).toUpperCase();
      const avatar = item.avatar
        ? `<img class="avatar image-avatar" src="${window.blog.escapeHtml(window.blog.normalizeAssetUrl(item.avatar))}" alt="${window.blog.escapeHtml(item.name || "")}" loading="lazy">`
        : `<div class="avatar">${window.blog.escapeHtml(avatarText)}</div>`;
      return `
        <article class="member-card refined-member-card admin-fixed-card${isEditingFixedItem(type, index) ? " is-active" : ""}">
          <span class="flash"></span>
          <div class="member-card-top">
            ${avatar}
            <span class="tag">${meta}</span>
          </div>
          <h3>${window.blog.escapeHtml(item.name)}</h3>
          <p class="meta">${window.blog.escapeHtml(item.title || "")}</p>
          ${item.desc ? `<p class="profile-desc">${window.blog.escapeHtml(item.desc)}</p>` : ""}
          ${renderContactIcons(item.links)}
          <div class="member-actions">
            <button type="button" data-edit-fixed="${type}:${index}">编辑</button>
            <button type="button" class="danger" data-remove-fixed="${type}:${index}">删除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderContactIcons(links) {
  if (!Array.isArray(links) || !links.length) return "";
  const icons = links
    .map((link) => {
      const label = link.label || "链接";
      const href = safeAdminContactUrl(label, link.url);
      if (!href) return "";
      return `
        <a class="contact-icon" href="${window.blog.escapeHtml(href)}" target="_blank" rel="noreferrer" title="${window.blog.escapeHtml(label)}" aria-label="${window.blog.escapeHtml(label)}">
          ${window.blog.escapeHtml(contactIconText(label))}
        </a>
      `;
    })
    .filter(Boolean)
    .join("");
  return icons ? `<div class="admin-contact-icons">${icons}</div>` : "";
}

function contactIconText(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("github")) return "GH";
  if (value.includes("email") || value.includes("mail")) return "@";
  if (value.includes("qq")) return "QQ";
  return "WEB";
}

function safeAdminContactUrl(label, value) {
  const raw = isQQContactLabel(label) ? qqContactUrl(value) : String(value || "").trim();
  if (!raw) return "";
  if (/^(https?:|mailto:)/i.test(raw)) return raw;
  return "";
}

function isEditingFixedItem(type, index) {
  return type === "members" ? state.editingMemberIndex === index : state.editingFameIndex === index;
}

async function handleFixedListClick(event) {
  if (!(event.target instanceof Element)) return;

  const editButton = event.target.closest("[data-edit-fixed]");
  if (editButton) {
    event.preventDefault();
    const [targetType, rawIndex] = editButton.dataset.editFixed.split(":");
    editFixedItem(targetType, Number(rawIndex));
    return;
  }

  const removeButton = event.target.closest("[data-remove-fixed]");
  if (removeButton) {
    event.preventDefault();
    const [targetType, rawIndex] = removeButton.dataset.removeFixed.split(":");
    await removeFixedItem(targetType, Number(rawIndex));
  }
}

function editFixedItem(type, index) {
  const target = type === "members" ? state.members : state.fameItems;
  if (!Array.isArray(target)) return;
  const item = target[index];
  if (!item) return;

  if (type === "members") {
    state.editingMemberIndex = index;
    fields.memberTerm.value = item.term || "";
    fields.memberDepartment.value = normalizeMemberDepartment(item.department || "主席团");
    fields.memberRole.value = item.role || item.title || "成员";
    fields.memberName.value = item.name || "";
    fields.memberAvatar.value = item.avatar || "";
    fields.memberDesc.value = item.desc || "";
    const link = Array.isArray(item.links) ? item.links[0] : null;
    fields.memberContactLabel.value = link?.label || "GitHub";
    fields.memberContactUrl.value = displayContactValue(fields.memberContactLabel.value, link?.url || "");
    updateContactPlaceholder(fields.memberContactLabel, fields.memberContactUrl);
    renderFixedList(state.members, fields.memberList, "members");
    fields.memberMessage.textContent = "正在编辑成员。";
    return;
  }

  state.editingFameIndex = index;
  fields.fameName.value = item.name || "";
  fields.fameTitle.value = item.title || "";
  fields.fameAvatar.value = item.avatar || "";
  fields.fameDesc.value = item.desc || "";
  const link = Array.isArray(item.links) ? item.links[0] : null;
  fields.fameContactLabel.value = link?.label || "GitHub";
  fields.fameContactUrl.value = displayContactValue(fields.fameContactLabel.value, link?.url || "");
  updateContactPlaceholder(fields.fameContactLabel, fields.fameContactUrl);
  renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");
  fields.fameMessage.textContent = "正在编辑名人堂条目。";
}

async function removeFixedItem(type, index) {
  const isMembers = type === "members";
  const target = isMembers ? state.members : state.fameItems;
  if (!Array.isArray(target) || !target[index]) return;
  const item = target[index];

  // 删除按钮紧挨着编辑按钮，误触即整表落库，必须先确认。
  const noun = isMembers ? "成员" : "名人堂条目";
  if (!confirm(`确定删除${noun}「${item.name || "未命名"}」吗？删除后立即保存并在前台生效。`)) return;

  // 保存失败时回滚列表并复位编辑状态，保证本地与线上一致。
  const previous = [...target];

  target.splice(index, 1);

  if (isMembers) {
    if (state.editingMemberIndex === index) clearMemberForm();
    if (Number.isInteger(state.editingMemberIndex) && state.editingMemberIndex > index) {
      state.editingMemberIndex -= 1;
    }
    renderFixedList(state.members, fields.memberList, "members");
    if (!(await saveMembers())) {
      state.members = previous;
      clearMemberForm();
      renderFixedList(state.members, fields.memberList, "members");
    }
    return;
  }

  if (state.editingFameIndex === index) clearFameForm();
  if (Number.isInteger(state.editingFameIndex) && state.editingFameIndex > index) {
    state.editingFameIndex -= 1;
  }
  renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");
  if (!(await saveFame())) {
    state.fameItems = previous;
    clearFameForm();
    renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");
  }
}

function clearMemberForm() {
  state.editingMemberIndex = null;
  fields.memberName.value = "";
  fields.memberAvatar.value = "";
  fields.memberImageFile.value = "";
  fields.memberDesc.value = "";
  fields.memberContactUrl.value = "";
}

function clearFameForm() {
  state.editingFameIndex = null;
  fields.fameName.value = "";
  fields.fameTitle.value = "";
  fields.fameAvatar.value = "";
  fields.fameImageFile.value = "";
  fields.fameDesc.value = "";
  fields.fameContactUrl.value = "";
}

function normalizeContactUrl(label, value) {
  if (label === "Email" && !value.startsWith("mailto:")) return `mailto:${value}`;
  if (isQQContactLabel(label)) {
    const qq = qqContactNumber(value);
    return qq ? qqContactUrl(qq) : value;
  }
  return value;
}

function displayContactValue(label, value) {
  if (label === "Email") return value.replace(/^mailto:/, "");
  if (isQQContactLabel(label)) return qqContactNumber(value) || value;
  return value;
}

function isQQContactLabel(label) {
  return String(label || "").trim().toLowerCase() === "qq";
}

function qqContactNumber(value) {
  const raw = String(value || "").trim();
  if (/^\d+$/.test(raw)) return raw;
  return (
    raw.match(/^https?:\/\/qm\.qq\.com\/q\/(\d+)\/?$/i)?.[1]
    || raw.match(/[?&]uin=(\d+)/i)?.[1]
    || ""
  );
}

function qqContactUrl(value) {
  const qq = qqContactNumber(value);
  return qq ? `https://wpa.qq.com/msgrd?v=3&uin=${qq}&site=qq&menu=yes` : String(value || "").trim();
}

function updateContactPlaceholder(select, input) {
  const placeholders = {
    GitHub: "https://github.com/yuna2017",
    Email: "name@example.com",
    QQ: "123456789",
    个人主页: "https://example.com",
  };
  input.placeholder = placeholders[select.value] || "";
}

function normalizeMemberDepartment(value) {
  return value === "\u7ec4\u5ba3\u79d8\u4e66\u5904" || value === "秘书处" ? "组宣部" : value;
}

// 导出走 fetch + blob 下载：直接 <a href> 在会话过期时会把整个后台导航到 401 JSON，
// 且无法反馈失败原因；这里拦截点击，成功才触发下载。
let exportingDatabase = false;

async function exportDatabase(event) {
  const link = event.target instanceof Element ? event.target.closest("a[data-export-db]") : null;
  const href = link?.getAttribute("href");
  if (!href) return;
  event.preventDefault();
  if (exportingDatabase) return;
  exportingDatabase = true;

  fields.exportMessage.textContent = "正在导出...";
  try {
    const response = await fetch(href);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `请求失败：${response.status}`);
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1]
      || `yuna-blog-db-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    fields.exportMessage.textContent = `导出完成：${filename}`;
  } catch (error) {
    fields.exportMessage.textContent = `导出失败：${adminErrorText(error)}`;
  } finally {
    exportingDatabase = false;
  }
}

function openImportModal() {
  fields.importMessage.textContent = "";
  fields.importModalMessage.textContent = "";
  fields.importFile.value = "";
  fields.importModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeImportModal() {
  fields.importModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function setImportMessage(message) {
  fields.importMessage.textContent = message;
  fields.importModalMessage.textContent = message;
}

async function importDatabase() {
  await withLockedButtons("[data-import-confirm]", async () => {
    const file = fields.importFile.files?.[0];
    if (!file) {
      setImportMessage("请选择要导入的 JSON 文件。");
      return;
    }

    setImportMessage("正在导入...");
    try {
      const payload = JSON.parse(await file.text());
      const data = await window.blog.fetchJson("/api/admin/import?mode=replace-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const snapshotNote = data.snapshotKey ? `导入前已备份至 ${data.snapshotKey}。` : "";
      setImportMessage(`导入完成：文章 ${data.counts.posts}，页面 ${data.counts.siteRecords}，备份 ${data.counts.siteRecordBackups}。${snapshotNote}`);
      fields.importFile.value = "";
      await refreshAdminData();
      closeImportModal();
    } catch (error) {
      setImportMessage(error.message);
    }
  });
}

async function syncMarkdownBackup() {
  await withLockedButtons("[data-sync-markdown]", async () => {
    fields.syncMessage.textContent = "正在同步 Markdown 到 GitHub...";
    try {
      const data = await window.blog.fetchJson("/api/admin/github-sync", {
        method: "POST",
      });
      fields.syncMessage.textContent = data.skipped
        ? data.reason || "未配置 GitHub 同步，已跳过。"
        : `同步完成：${data.files} 个 Markdown 文件。`;
    } catch (error) {
      fields.syncMessage.textContent = error.message;
    }
  });
}

async function loadUsage() {
  fields.usageMessage.textContent = "正在检测 D1 与 R2 用量...";
  try {
    const data = await window.blog.fetchJson("/api/admin/usage");
    renderUsage(data);
    fields.usageMessage.textContent = `检测完成：${window.blog.formatDate(data.checkedAt)}${data.bucket.truncated ? "。R2 对象较多，本次只统计了前 100000 个对象。" : ""}`;
  } catch (error) {
    fields.usageMessage.textContent = error.message;
  }
}

function renderUsage(data) {
  const database = data.database || {};
  const bucket = data.bucket || {};
  const dbSize = database.sqliteHuman || database.estimatedContentHuman || "0 B";
  const dbLabel = database.sqliteHuman ? "D1 已用空间" : "D1 内容估算";
  const tableRows = Array.isArray(database.tables)
    ? database.tables.reduce((sum, table) => sum + Number(table.rows || 0), 0)
    : 0;
  const tableList = Array.isArray(database.tables) ? database.tables : [];
  const prefixList = Array.isArray(bucket.prefixes) ? bucket.prefixes : [];

  fields.usageSummary.innerHTML = `
    <div class="usage-kpis">
      <div><strong>${window.blog.escapeHtml(dbSize)}</strong><span>${dbLabel}</span></div>
      <div><strong>${tableRows.toLocaleString("zh-CN")}</strong><span>D1 总记录</span></div>
      <div><strong>${window.blog.escapeHtml(bucket.human || "0 B")}</strong><span>R2 已用空间</span></div>
      <div><strong>${Number(bucket.objects || 0).toLocaleString("zh-CN")}</strong><span>R2 对象</span></div>
    </div>
    <div class="usage-detail">
      <div>
        <h4>D1 表</h4>
        ${tableList.map((table) => `
          <p><span>${window.blog.escapeHtml(table.label || table.name)}</span><strong>${Number(table.rows || 0).toLocaleString("zh-CN")} 条 · ${formatAdminBytes(table.estimatedBytes)}</strong></p>
        `).join("") || '<p><span>暂无数据</span><strong>0 条</strong></p>'}
      </div>
      <div>
        <h4>R2 前缀</h4>
        ${prefixList.map((item) => `
          <p><span>${window.blog.escapeHtml(item.prefix)}</span><strong>${Number(item.objects || 0).toLocaleString("zh-CN")} 个 · ${formatAdminBytes(item.bytes)}</strong></p>
        `).join("") || '<p><span>暂无对象</span><strong>0 B</strong></p>'}
      </div>
    </div>
    <p class="meta">${window.blog.escapeHtml(database.note || "")}</p>
  `;
}

function formatAdminBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unit]}`;
}

async function scanOrphans() {
  fields.orphanMessage.textContent = "正在检测 R2 引用情况...";
  try {
    const data = await window.blog.fetchJson("/api/admin/media-orphans");
    renderOrphans(data);
    fields.orphanMessage.textContent = "检测完成，未执行删除。";
  } catch (error) {
    fields.orphanMessage.textContent = error.message;
  }
}

async function deleteOrphans() {
  const ok = confirm("将重新检测并删除未被数据库引用的 media/ 文件，以及旧的 db/posts/*.md 残留。db-snapshots/ 和未知前缀不会删除。确定继续吗？");
  if (!ok) return;

  fields.orphanMessage.textContent = "正在检测并删除可清理对象...";
  try {
    const data = await window.blog.fetchJson("/api/admin/media-orphans?confirm=delete", {
      method: "POST",
    });
    renderOrphans(data);
    fields.orphanMessage.textContent = `已删除 ${Number(data.deletedCount || 0).toLocaleString("zh-CN")} 个对象，释放约 ${window.blog.escapeHtml(data.summary?.reclaimableHuman || "0 B")}。`;
    await loadUsage();
  } catch (error) {
    fields.orphanMessage.textContent = error.message;
  }
}

function renderOrphans(data) {
  const summary = data.summary || {};
  const orphanMedia = Array.isArray(data.orphanMedia) ? data.orphanMedia : [];
  const legacyPostMd = Array.isArray(data.legacyPostMd) ? data.legacyPostMd : [];
  const unknown = Array.isArray(data.unknown) ? data.unknown : [];
  const reclaimableCount = Number(summary.orphanMedia || 0) + Number(summary.legacyPostMd || 0);

  fields.orphanSummary.innerHTML = `
    <div class="usage-kpis">
      <div><strong>${Number(summary.totalObjects || 0).toLocaleString("zh-CN")}</strong><span>R2 对象总数</span></div>
      <div><strong>${Number(summary.referenced || 0).toLocaleString("zh-CN")}</strong><span>已被引用</span></div>
      <div><strong>${reclaimableCount.toLocaleString("zh-CN")}</strong><span>可清理对象</span></div>
      <div><strong>${window.blog.escapeHtml(summary.reclaimableHuman || "0 B")}</strong><span>预计释放</span></div>
    </div>
    <div class="usage-detail">
      <div>
        <h4>可删除</h4>
        <p><span>孤儿媒体</span><strong>${Number(summary.orphanMedia || 0).toLocaleString("zh-CN")} 个</strong></p>
        <p><span>旧文章 Markdown</span><strong>${Number(summary.legacyPostMd || 0).toLocaleString("zh-CN")} 个</strong></p>
        <p><span>保留快照</span><strong>${Number(summary.snapshotsKept || 0).toLocaleString("zh-CN")} 个</strong></p>
        <p><span>未知前缀保留</span><strong>${Number(summary.unknownKept || 0).toLocaleString("zh-CN")} 个</strong></p>
      </div>
      <div>
        <h4>对象示例</h4>
        ${renderObjectSamples([...orphanMedia, ...legacyPostMd], "暂无可清理对象。")}
      </div>
    </div>
    ${unknown.length ? `<p class="meta">未知前缀对象不会自动删除：${window.blog.escapeHtml(unknown.slice(0, 3).map((item) => item.key).join("，"))}${unknown.length > 3 ? " 等" : ""}</p>` : ""}
  `;
}

function renderObjectSamples(items, emptyText) {
  if (!items.length) return `<p><span>${emptyText}</span><strong>0 B</strong></p>`;
  return items.slice(0, 6).map((item) => `
    <p><span>${window.blog.escapeHtml(item.key)}</span><strong>${formatAdminBytes(item.size)}</strong></p>
  `).join("");
}

function resetEditor() {
  state.editingSlug = null;
  state.editingKind = "article";
  state.editingUpdatedAt = null;
  fields.title.value = "";
  fields.tag.value = defaultTag(state.editingKind);
  fields.authorName.value = DEFAULT_CREDIT_NAME;
  fields.authorUrl.value = "";
  fields.authorAvatar.value = "";
  fields.authorGithub.value = "";
  fields.authorAvatarFile.value = "";
  renderCoauthors();
  fields.lastEditor.value = DEFAULT_CREDIT_NAME;
  fields.excerpt.value = "";
  fields.coverUrl.value = "";
  fields.coverFile.value = "";
  fields.markdown.value = "";
  fields.editorHeading.textContent = "新建文章";
  fields.editorState.textContent = "未保存";
  fields.message.textContent = "";
  updatePreview();
  renderAdminPostList();
  markEditorClean();
  activateAdminTab("posts");
  updateEditorUrl("", state.editingKind);
}

function updateEditorUrl(slug, kind) {
  const url = new URL(location.href);
  url.pathname = "/admin/";
  if (slug) {
    url.searchParams.set("slug", slug);
  } else {
    url.searchParams.delete("slug");
  }
  url.searchParams.delete("tab");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function activateAdminTab(name) {
  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    const active = tab.dataset.adminTab === name;
    tab.classList.toggle("is-active", active);
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-pressed", active ? "true" : "false");
  });
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== name;
  });
}

function updatePreview() {
  const title = fields.title.value.trim() || "未命名文章";
  const authorName = fields.authorName.value.trim();
  const authorPost = {
    author_name: authorName,
    author_url: fields.authorUrl.value.trim(),
    author_avatar: fields.authorAvatar.value.trim(),
    coauthors: collectCoauthors(),
  };
  const excerpt = fields.excerpt.value.trim();
  const coverUrl = window.blog.safeDisplayAssetUrl(fields.coverUrl.value.trim());
  const previewPost = { tag: fields.tag.value.trim() || "协会动态" };
  fields.preview.innerHTML = `
    ${window.blog.postAuthors(authorPost).length ? `<div class="author-byline author-collection">${window.blog.authorsIdentityHtml(authorPost)}</div>` : ""}
    <p class="meta">${window.blog.postTagsHtml(previewPost)}</p>
    <h1>${window.blog.escapeHtml(title)}</h1>
    ${excerpt ? `<p>${window.blog.escapeHtml(excerpt)}</p>` : ""}
    ${coverUrl ? `<img src="${window.blog.escapeHtml(coverUrl)}" alt="" loading="lazy">` : ""}
    ${window.blog.markdownToHtml(fields.markdown.value || "开始输入 Markdown 内容。")}
  `;
  window.blog.bindAuthorAvatarFallbacks(fields.preview);
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  textarea.selectionStart = start + text.length;
  textarea.selectionEnd = start + text.length;
  textarea.focus();
}

function bind(selector, event, handler) {
  const element = document.querySelector(selector);
  if (!element) {
    console.warn(`后台控件未找到：${selector}`);
    return;
  }
  element.addEventListener(event, handler);
}

function bindElement(element, event, handler, name) {
  if (!element) {
    console.warn(`后台控件未找到：${name}`);
    return;
  }
  element.addEventListener(event, handler);
}

bind("[data-publish]", "click", () => savePost("published"));
bind("[data-save-draft]", "click", () => savePost("draft"));
bind("[data-editor-close]", "click", () => closeEditor());
bindElement(editorModal, "click", (event) => {
  if (event.target === editorModal) closeEditor();
}, "data-editor-modal");
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && editorModal && !editorModal.hidden) closeEditor();
  if (event.key === "Escape" && fields.importModal && !fields.importModal.hidden) closeImportModal();
});
// 编辑器开着且有未保存修改时，拦一下刷新/关标签/后退，避免整篇稿子无声丢失。
window.addEventListener("beforeunload", (event) => {
  if (editorModal && !editorModal.hidden && isEditorDirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
bindElement(fields.markdown, "keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  insertAtCursor(fields.markdown, "  ");
  updatePreview();
}, "data-markdown");
bindElement(fields.markdown, "paste", (event) => {
  const files = Array.from(event.clipboardData?.files || []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (!files.length) return;
  event.preventDefault();
  insertImageFiles(files);
}, "data-markdown");
bindElement(fields.markdown, "dragover", (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
  event.preventDefault();
  fields.markdown.classList.add("is-dragover");
}, "data-markdown");
bindElement(fields.markdown, "dragleave", () => {
  fields.markdown.classList.remove("is-dragover");
}, "data-markdown");
bindElement(fields.markdown, "drop", (event) => {
  const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
    file.type.startsWith("image/"),
  );
  fields.markdown.classList.remove("is-dragover");
  if (!files.length) return;
  event.preventDefault();
  insertImageFiles(files);
}, "data-markdown");
bind("[data-upload-post-image]", "click", uploadPostImage);
bind("[data-upload-cover]", "click", uploadCoverImage);
bind("[data-upload-author-avatar]", "click", uploadAuthorAvatar);
bind("[data-use-github-avatar]", "click", useGithubAvatar);
bind("[data-add-coauthor]", "click", () => addCoauthor());
bindElement(fields.coauthorsList, "input", updatePreview, "data-coauthors-list");
bindElement(fields.coauthorsList, "click", (event) => {
  const githubButton = event.target.closest("[data-use-coauthor-github]");
  if (githubButton) {
    useCoauthorGithubAvatar(githubButton.closest("[data-coauthor-row]"));
    return;
  }
  const button = event.target.closest("[data-remove-coauthor]");
  if (!button) return;
  button.closest("[data-coauthor-row]")?.remove();
  if (!fields.coauthorsList.querySelector("[data-coauthor-row]")) renderCoauthors();
  updatePreview();
}, "data-coauthors-list");
bind("[data-upload-post-file]", "click", uploadPostFiles);
bindElement(fields.memberImageFile, "change", uploadMemberAvatar, "data-member-image-file");
bindElement(fields.fameImageFile, "change", uploadFameAvatar, "data-fame-image-file");
bind("[data-save-member-entry]", "click", saveMemberEntry);
bind("[data-save-fame-entry]", "click", saveFameEntry);
// 两个导出按钮（默认导出 / 含历史导出）都要给出反馈。
document.querySelectorAll("[data-export-db]").forEach((element) => {
  element.addEventListener("click", exportDatabase);
});
bind("[data-import-db]", "click", openImportModal);
bind("[data-import-confirm]", "click", importDatabase);
bind("[data-import-close]", "click", closeImportModal);
bind("[data-import-cancel]", "click", closeImportModal);
bindElement(fields.importModal, "click", (event) => {
  if (event.target === fields.importModal) closeImportModal();
}, "data-import-modal");
bind("[data-sync-markdown]", "click", syncMarkdownBackup);
bind("[data-refresh-usage]", "click", loadUsage);
bind("[data-scan-orphans]", "click", scanOrphans);
bind("[data-delete-orphans]", "click", deleteOrphans);
bindElement(fields.memberList, "click", handleFixedListClick, "data-member-list");
bindElement(fields.fameList, "click", handleFixedListClick, "data-fame-list");
bindElement(fields.memberContactLabel, "change", () => updateContactPlaceholder(fields.memberContactLabel, fields.memberContactUrl), "data-member-contact-label");
bindElement(fields.fameContactLabel, "change", () => updateContactPlaceholder(fields.fameContactLabel, fields.fameContactUrl), "data-fame-contact-label");
bind("[data-new]", "click", () => {
  resetEditor("article");
  openEditor();
});
bindElement(fields.search, "input", () => {
  state.articlePage = 1;
  renderAdminPostList();
}, "data-search");
bindElement(fields.filterStatus, "change", () => {
  state.articlePage = 1;
  renderAdminPostList();
}, "data-filter-status");
bindElement(fields.title, "input", updatePreview, "data-title");
bindElement(fields.tag, "input", updatePreview, "data-post-tag");
bindElement(fields.authorName, "input", updatePreview, "data-author-name");
bindElement(fields.authorUrl, "input", updatePreview, "data-author-url");
bindElement(fields.authorAvatar, "input", () => {
  fields.authorGithub.value = githubUsernameFromAuthor({ author_avatar: fields.authorAvatar.value });
  updatePreview();
}, "data-author-avatar");
bindElement(fields.excerpt, "input", updatePreview, "data-excerpt");
bindElement(fields.coverUrl, "input", updatePreview, "data-cover-url");
bindElement(fields.markdown, "input", updatePreview, "data-markdown");
bootAdmin().catch((error) => {
  console.error("后台初始化失败", error);
  // fields.message 在隐藏的编辑器弹窗里，初始化错误必须写到页面可见的列表消息栏。
  if (fields.postListMessage) {
    fields.postListMessage.textContent = `后台初始化失败：${adminErrorText(error)}`;
  }
});
