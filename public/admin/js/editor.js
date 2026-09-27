// 文章编辑弹窗：表单读写、协同作者、预览、图片/附件/头像上传、保存。

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

async function insertImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    fields.message.textContent = "只能插入图片文件。";
    return;
  }

  try {
    fields.message.textContent = "图片上传中…";
    const data = await uploadImage(file, `${contentFolder()}/${state.editingSlug || "drafts"}`);
    insertRawAtCursor(fields.markdown, `\n![${cleanDocumentName(file.name)}](${data.url})\n`);
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
        insertRawAtCursor(fields.markdown, `\n[点击下载](${data.url})\n`);
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

async function uploadImage(file, folder) {
  const safeName = `${Date.now()}-${file.name}`.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-");
  const path = `${folder}/${safeName}`.replace(/^\/+/, "");
  return uploadMedia(file, path);
}

async function uploadMedia(file, path, onProgress) {
  return window.blog.uploadMediaViaApi("/api/admin", file, path, onProgress);
}

function cleanDocumentName(value) {
  // ()[] 会破坏 Markdown 链接语法和孤儿检测的 URL 提取（Windows 副本文件名常带括号），一并替换。
  return (value || "file")
    .replace(/[\\/:*?"<>|#%&{}$!`'@+=()[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "file";
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

// 原样插入，不补换行（调用方自己带 \n）。与前台 pages.js 的 insertAtCursor 行为不同，
// 所以不能同名：普通 <script> 共享全局作用域，同名函数会互相覆盖。
function insertRawAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  textarea.selectionStart = start + text.length;
  textarea.selectionEnd = start + text.length;
  textarea.focus();
}
