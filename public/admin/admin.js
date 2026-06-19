const state = { editingSlug: null, posts: [], members: [], fameItems: [] };
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
  return window.blog.fetchJson(`/api/admin/media/${encodeURI(path)}`, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
}

async function loadMembers() {
  state.members = await loadJsonRecord("members", fields.memberMessage);
  renderFixedList(state.members, fields.memberList, "members");
}

async function loadFame() {
  state.fameItems = await loadJsonRecord("hall-of-fame", fields.fameMessage);
  renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");
}

async function loadJsonRecord(key, messageEl) {
  try {
    const data = await window.blog.fetchJson(`/api/site/${key}`);
    messageEl.textContent = `已读取 ${data.record.title}`;
    return JSON.parse(data.record.content || "[]");
  } catch (error) {
    messageEl.textContent = error.message;
    return [];
  }
}

function addMember() {
  const item = {
    term: fields.memberTerm.value.trim(),
    department: fields.memberDepartment.value,
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

  state.members.push(item);
  fields.memberName.value = "";
  fields.memberAvatar.value = "";
  fields.memberDesc.value = "";
  fields.memberContactUrl.value = "";
  renderFixedList(state.members, fields.memberList, "members");
}

function addFame() {
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

  state.fameItems.push(item);
  fields.fameName.value = "";
  fields.fameTitle.value = "";
  fields.fameAvatar.value = "";
  fields.fameDesc.value = "";
  fields.fameContactUrl.value = "";
  renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");
}

async function saveMembers() {
  await saveFixedRecord("members", "协会成员", state.members, fields.memberMessage);
}

async function saveFame() {
  await saveFixedRecord("hall-of-fame", "网协名人堂", state.fameItems, fields.fameMessage);
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
  } catch (error) {
    messageEl.textContent = error.message;
  }
}

function renderFixedList(items, listEl, type) {
  if (!items.length) {
    listEl.innerHTML = '<p class="empty">当前暂无条目。</p>';
    return;
  }

  listEl.innerHTML = items
    .map(
      (item, index) => `
        <article class="post-card">
          <p class="meta">${type === "members" ? `${window.blog.escapeHtml(item.term || "未填写届数")} · ${window.blog.escapeHtml(item.department || "")}` : "名人堂"}</p>
          <h2>${window.blog.escapeHtml(item.name)}</h2>
          <p>${window.blog.escapeHtml(item.title || "")}</p>
          <p>${window.blog.escapeHtml(item.desc || "")}</p>
          <div class="actions">
            <button class="danger" data-remove-fixed="${type}:${index}">删除</button>
          </div>
        </article>
      `,
    )
    .join("");

  listEl.querySelectorAll("[data-remove-fixed]").forEach((button) => {
    button.addEventListener("click", () => {
      const [targetType, rawIndex] = button.dataset.removeFixed.split(":");
      const target = targetType === "members" ? state.members : state.fameItems;
      target.splice(Number(rawIndex), 1);
      renderFixedList(target, targetType === "members" ? fields.memberList : fields.fameList, targetType);
    });
  });
}

function normalizeContactUrl(label, value) {
  if (label === "Email" && !value.startsWith("mailto:")) return `mailto:${value}`;
  if (label === "QQ" && /^\d+$/.test(value)) return `https://qm.qq.com/q/${value}`;
  return value;
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
fields.memberImageFile.addEventListener("change", uploadMemberAvatar);
fields.fameImageFile.addEventListener("change", uploadFameAvatar);
document.querySelector("[data-load-members]").addEventListener("click", loadMembers);
document.querySelector("[data-add-member]").addEventListener("click", addMember);
document.querySelector("[data-save-members]").addEventListener("click", saveMembers);
document.querySelector("[data-load-fame]").addEventListener("click", loadFame);
document.querySelector("[data-add-fame]").addEventListener("click", addFame);
document.querySelector("[data-save-fame]").addEventListener("click", saveFame);
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
