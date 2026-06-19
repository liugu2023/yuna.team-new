const state = { editingSlug: null, posts: [], structuredItems: [] };
const fields = {
  title: document.querySelector("[data-title]"),
  slug: document.querySelector("[data-slug]"),
  excerpt: document.querySelector("[data-excerpt]"),
  status: document.querySelector("[data-status]"),
  markdown: document.querySelector("[data-markdown]"),
  message: document.querySelector("[data-message]"),
  delete: document.querySelector("[data-delete]"),
  preview: document.querySelector("[data-preview]"),
  search: document.querySelector("[data-search]"),
  filterStatus: document.querySelector("[data-filter-status]"),
  postImageFile: document.querySelector("[data-post-image-file]"),
  structuredImageFile: document.querySelector("[data-structured-image-file]"),
  structuredKey: document.querySelector("[data-structured-key]"),
  structuredTerm: document.querySelector("[data-structured-term]"),
  structuredDepartment: document.querySelector("[data-structured-department]"),
  structuredRole: document.querySelector("[data-structured-role]"),
  structuredName: document.querySelector("[data-structured-name]"),
  structuredTitle: document.querySelector("[data-structured-title]"),
  structuredAvatar: document.querySelector("[data-structured-avatar]"),
  structuredDesc: document.querySelector("[data-structured-desc]"),
  structuredLinkLabel: document.querySelector("[data-structured-link-label]"),
  structuredLinkUrl: document.querySelector("[data-structured-link-url]"),
  structuredMessage: document.querySelector("[data-structured-message]"),
  structuredList: document.querySelector("[data-structured-list]"),
};

async function bootAdmin() {
  const authPanel = document.querySelector("[data-auth-panel]");
  const editor = document.querySelector("[data-editor]");
  const me = await window.blog.fetchJson("/api/auth/me");

  if (!me.admin) {
    authPanel.innerHTML = '<p>请先从首页登录，然后再进入管理后台。</p><a class="button" href="/">返回首页</a>';
    return;
  }

  authPanel.hidden = true;
  editor.hidden = false;
  document.querySelectorAll("[data-admin-tools]").forEach((section) => {
    section.hidden = false;
  });
  await refreshPosts();
  updatePreview();
  updateStructuredMode();

  const slug = new URLSearchParams(location.search).get("slug");
  if (slug) await loadPost(slug);
}

async function refreshPosts() {
  const data = await window.blog.fetchJson("/api/posts?drafts=1");
  state.posts = data.posts;
  renderAdminPostList();
}

function renderAdminPostList() {
  const list = document.querySelector("[data-post-list]");
  const keyword = fields.search.value.trim().toLowerCase();
  const status = fields.filterStatus.value;
  const posts = state.posts.filter((post) => {
    const matchesStatus = status === "all" || post.status === status;
    const haystack = `${post.title} ${post.excerpt || ""} ${post.slug}`.toLowerCase();
    return matchesStatus && (!keyword || haystack.includes(keyword));
  });

  if (!posts.length) {
    list.innerHTML = '<p class="empty">没有匹配的文章。</p>';
    return;
  }

  list.innerHTML = posts
    .map(
      (post) => `
        <article class="post-card">
          <p class="meta">${post.status === "published" ? "已发布" : "草稿"} · ${window.blog.formatDate(post.published_at || post.updated_at)}</p>
          <h2><a href="/admin/?slug=${post.slug}">${window.blog.escapeHtml(post.title)}</a></h2>
          <p>${window.blog.escapeHtml(post.excerpt || "")}</p>
          <div class="actions">
            <a class="button secondary" href="/post.html?slug=${post.slug}" target="_blank" rel="noreferrer">查看</a>
            <button class="secondary" data-quick-status="${post.status === "published" ? "draft" : "published"}" data-slug="${post.slug}">
              ${post.status === "published" ? "转草稿" : "发布"}
            </button>
          </div>
        </article>
      `,
    )
    .join("");

  list.querySelectorAll("[data-quick-status]").forEach((button) => {
    button.addEventListener("click", () => quickSetStatus(button.dataset.slug, button.dataset.quickStatus));
  });
}

async function loadPost(slug) {
  const data = await window.blog.fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
  state.editingSlug = slug;
  fields.title.value = data.post.title;
  fields.slug.value = data.post.slug;
  fields.slug.disabled = true;
  fields.excerpt.value = data.post.excerpt || "";
  fields.status.value = data.post.status;
  fields.markdown.value = data.markdown;
  fields.delete.hidden = false;
  fields.message.textContent = `正在编辑 ${slug}`;
  updatePreview();
}

async function savePost() {
  const payload = {
    title: fields.title.value.trim(),
    slug: fields.slug.value.trim(),
    excerpt: fields.excerpt.value.trim(),
    status: fields.status.value,
    markdown: fields.markdown.value,
  };

  const url = state.editingSlug
    ? `/api/posts/${encodeURIComponent(state.editingSlug)}`
    : "/api/posts";
  const method = state.editingSlug ? "PUT" : "POST";

  try {
    const data = await window.blog.fetchJson(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.editingSlug = data.post.slug;
    fields.slug.disabled = true;
    fields.delete.hidden = false;
    fields.message.textContent = "已保存。";
    await refreshPosts();
    history.replaceState(null, "", `/admin/?slug=${data.post.slug}`);
  } catch (error) {
    fields.message.textContent = error.message;
  }
}

async function quickSetStatus(slug, status) {
  const data = await window.blog.fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
  await window.blog.fetchJson(`/api/posts/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, markdown: data.markdown }),
  });
  await refreshPosts();
  if (state.editingSlug === slug) {
    fields.status.value = status;
  }
}

async function saveWithStatus(status) {
  fields.status.value = status;
  await savePost();
}

async function seedPosts() {
  const data = await window.blog.fetchJson("/api/admin/seed", { method: "POST" });
  fields.message.textContent = `已生成 ${data.created.length} 篇测试文章，跳过 ${data.skipped.length} 篇已有文章。`;
  await refreshPosts();
}

async function uploadPostImage() {
  const file = fields.postImageFile.files[0];
  if (!file) {
    fields.message.textContent = "请选择文章图片。";
    return;
  }

  try {
    const data = await uploadImage(file, `posts/${state.editingSlug || "drafts"}`);
    insertAtCursor(fields.markdown, `\n![${file.name}](${data.url})\n`);
    fields.message.textContent = `图片已上传：${data.url}`;
    updatePreview();
  } catch (error) {
    fields.message.textContent = error.message;
  }
}

async function uploadStructuredImage() {
  const file = fields.structuredImageFile.files[0];
  if (!file) {
    fields.structuredMessage.textContent = "请选择头像或图片。";
    return;
  }

  try {
    const data = await uploadImage(file, fields.structuredKey.value === "members" ? "avatars" : "hall-of-fame");
    fields.structuredAvatar.value = data.url;
    fields.structuredMessage.textContent = `图片已上传：${data.url}`;
  } catch (error) {
    fields.structuredMessage.textContent = error.message;
  }
}

async function uploadImage(file, folder) {
  const safeName = `${Date.now()}-${file.name}`.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-");
  const path = `${folder}/${safeName}`.replace(/^\/+/, "");
  return window.blog.fetchJson(`/api/admin/media/${encodeURI(path)}`, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
}

async function loadStructuredRecord() {
  const key = fields.structuredKey.value;
  try {
    const data = await window.blog.fetchJson(`/api/site/${key}`);
    state.structuredItems = JSON.parse(data.record.content || "[]");
    fields.structuredMessage.textContent = `已读取 ${data.record.title}`;
  } catch (error) {
    state.structuredItems = [];
    fields.structuredMessage.textContent = error.message;
  }
  renderStructuredList();
}

function addStructuredItem() {
  const isMembers = fields.structuredKey.value === "members";
  const item = {
    term: fields.structuredTerm.value.trim(),
    department: isMembers ? fields.structuredDepartment.value : "",
    role: isMembers ? fields.structuredRole.value : "",
    name: fields.structuredName.value.trim(),
    title: isMembers ? fields.structuredRole.value : fields.structuredTitle.value.trim(),
    avatar: fields.structuredAvatar.value.trim(),
    desc: fields.structuredDesc.value.trim(),
    links: [],
  };

  if (fields.structuredLinkLabel.value.trim() && fields.structuredLinkUrl.value.trim()) {
    item.links.push({
      label: fields.structuredLinkLabel.value.trim(),
      url: fields.structuredLinkUrl.value.trim(),
    });
  }

  if (!item.name) {
    fields.structuredMessage.textContent = "姓名 / 标题不能为空。";
    return;
  }

  state.structuredItems.push(item);
  fields.structuredName.value = "";
  fields.structuredTitle.value = "";
  fields.structuredAvatar.value = "";
  fields.structuredDesc.value = "";
  fields.structuredLinkLabel.value = "";
  fields.structuredLinkUrl.value = "";
  renderStructuredList();
}

async function saveStructuredRecord() {
  const key = fields.structuredKey.value;
  try {
    await window.blog.fetchJson(`/api/admin/site/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: key === "members" ? "协会成员" : "网协名人堂",
        kind: "json",
        content: JSON.stringify(state.structuredItems),
      }),
    });
    fields.structuredMessage.textContent = "已保存栏目，并写入增量备份。";
  } catch (error) {
    fields.structuredMessage.textContent = error.message;
  }
}

function renderStructuredList() {
  if (!state.structuredItems.length) {
    fields.structuredList.innerHTML = '<p class="empty">当前栏目暂无条目。</p>';
    return;
  }

  fields.structuredList.innerHTML = state.structuredItems
    .map(
      (item, index) => `
        <article class="post-card">
          <p class="meta">${window.blog.escapeHtml(item.term || "未填写届数")} · ${window.blog.escapeHtml(item.department || "名人堂")}</p>
          <h2>${window.blog.escapeHtml(item.name)}</h2>
          <p>${window.blog.escapeHtml(item.title || "")}</p>
          <p>${window.blog.escapeHtml(item.desc || "")}</p>
          <div class="actions">
            <button class="danger" data-remove-structured="${index}">删除</button>
          </div>
        </article>
      `,
    )
    .join("");

  fields.structuredList.querySelectorAll("[data-remove-structured]").forEach((button) => {
    button.addEventListener("click", () => {
      state.structuredItems.splice(Number(button.dataset.removeStructured), 1);
      renderStructuredList();
    });
  });
}

function updateStructuredMode() {
  const isMembers = fields.structuredKey.value === "members";
  document.querySelectorAll("[data-members-only]").forEach((node) => {
    node.hidden = !isMembers;
  });
  document.querySelectorAll("[data-fame-only]").forEach((node) => {
    node.hidden = isMembers;
  });
  fields.structuredTerm.placeholder = isMembers ? "第九届" : "第六届 / 2024";
  fields.structuredName.placeholder = isMembers ? "成员姓名" : "名人堂条目标题";
}

async function deletePost() {
  if (!state.editingSlug) return;
  if (!confirm(`确定删除 ${state.editingSlug} 吗？`)) return;

  await window.blog.fetchJson(`/api/posts/${encodeURIComponent(state.editingSlug)}`, {
    method: "DELETE",
  });
  resetEditor();
  await refreshPosts();
}

function resetEditor() {
  state.editingSlug = null;
  fields.title.value = "";
  fields.slug.value = "";
  fields.slug.disabled = false;
  fields.excerpt.value = "";
  fields.status.value = "draft";
  fields.markdown.value = "";
  fields.delete.hidden = true;
  fields.message.textContent = "";
  updatePreview();
  history.replaceState(null, "", "/admin/");
}

function updatePreview() {
  const title = fields.title.value.trim() || "未命名文章";
  const excerpt = fields.excerpt.value.trim();
  fields.preview.innerHTML = `
    <h1>${window.blog.escapeHtml(title)}</h1>
    ${excerpt ? `<p>${window.blog.escapeHtml(excerpt)}</p>` : ""}
    ${window.blog.markdownToHtml(fields.markdown.value || "开始输入 Markdown 内容。")}
  `;
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  textarea.selectionStart = start + text.length;
  textarea.selectionEnd = start + text.length;
  textarea.focus();
}

document.querySelector("[data-save]").addEventListener("click", savePost);
document.querySelector("[data-publish]").addEventListener("click", () => saveWithStatus("published"));
document.querySelector("[data-draft]").addEventListener("click", () => saveWithStatus("draft"));
document.querySelector("[data-seed]").addEventListener("click", seedPosts);
document.querySelector("[data-upload-post-image]").addEventListener("click", uploadPostImage);
document.querySelector("[data-upload-structured-image]").addEventListener("click", uploadStructuredImage);
document.querySelector("[data-load-structured]").addEventListener("click", loadStructuredRecord);
document.querySelector("[data-add-structured]").addEventListener("click", addStructuredItem);
document.querySelector("[data-save-structured]").addEventListener("click", saveStructuredRecord);
fields.structuredKey.addEventListener("change", () => {
  updateStructuredMode();
  loadStructuredRecord();
});
document.querySelector("[data-new]").addEventListener("click", resetEditor);
fields.delete.addEventListener("click", deletePost);
fields.search.addEventListener("input", renderAdminPostList);
fields.filterStatus.addEventListener("change", renderAdminPostList);
fields.title.addEventListener("input", updatePreview);
fields.excerpt.addEventListener("input", updatePreview);
fields.markdown.addEventListener("input", updatePreview);
bootAdmin().catch((error) => {
  document.querySelector("[data-auth-panel]").textContent = error.message;
});
