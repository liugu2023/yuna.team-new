const state = {
  editingSlug: null,
  editingMemberIndex: null,
  editingFameIndex: null,
  posts: [],
  members: [],
  fameItems: [],
};
const fields = {
  title: document.querySelector("[data-title]"),
  slug: document.querySelector("[data-slug]"),
  excerpt: document.querySelector("[data-excerpt]"),
  markdown: document.querySelector("[data-markdown]"),
  message: document.querySelector("[data-message]"),
  delete: document.querySelector("[data-delete]"),
  viewPost: document.querySelector("[data-view-post]"),
  preview: document.querySelector("[data-preview]"),
  search: document.querySelector("[data-search]"),
  filterStatus: document.querySelector("[data-filter-status]"),
  editorHeading: document.querySelector("[data-editor-heading]"),
  editorState: document.querySelector("[data-editor-state]"),
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

const editorModal = document.querySelector("[data-editor-modal]");

function statusLabel(status) {
  return status === "published" ? "已发布" : "草稿";
}

function editorSnapshot() {
  return JSON.stringify({
    title: fields.title.value,
    slug: fields.slug.value,
    excerpt: fields.excerpt.value,
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
}

function closeEditor(force) {
  if (!force && isEditorDirty() && !confirm("有未保存的修改，确定关闭并丢弃吗？")) {
    return;
  }
  editorModal.hidden = true;
  document.body.classList.remove("modal-open");
  resetEditor();
}

async function bootAdmin() {
  await Promise.all([refreshPosts(), loadMembers(), loadFame()]);
  updatePreview();
  updateContactPlaceholder(fields.memberContactLabel, fields.memberContactUrl);
  updateContactPlaceholder(fields.fameContactLabel, fields.fameContactUrl);
  markEditorClean();

  const slug = new URLSearchParams(location.search).get("slug");
  if (slug) {
    await loadPost(slug);
    openEditor();
  }
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
        <article class="post-card admin-post-card${state.editingSlug === post.slug ? " is-active" : ""}">
          <p class="meta">${post.status === "published" ? "已发布" : "草稿"} · ${window.blog.formatDate(post.published_at || post.updated_at)}</p>
          <h2>${window.blog.escapeHtml(post.title)}</h2>
          <p>${window.blog.escapeHtml(post.excerpt || "")}</p>
          <div class="actions">
            <button class="secondary" data-edit-post="${window.blog.escapeHtml(post.slug)}">编辑</button>
            <a class="button secondary" href="/post.html?slug=${encodeURIComponent(post.slug)}" target="_blank" rel="noreferrer">查看</a>
          </div>
        </article>
      `,
    )
    .join("");

  list.querySelectorAll("[data-edit-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      await loadPost(button.dataset.editPost);
      openEditor();
    });
  });
}

async function loadPost(slug) {
  const data = await window.blog.fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
  state.editingSlug = slug;
  fields.title.value = data.post.title;
  fields.slug.value = data.post.slug;
  fields.slug.disabled = true;
  fields.excerpt.value = data.post.excerpt || "";
  fields.markdown.value = data.markdown;
  fields.delete.hidden = false;
  fields.viewPost.href = `/post.html?slug=${encodeURIComponent(data.post.slug)}`;
  fields.viewPost.hidden = false;
  fields.editorHeading.textContent = "编辑文章";
  fields.editorState.textContent = `${statusLabel(data.post.status)} · 正在编辑：${data.post.slug}`;
  fields.message.textContent = "";
  updatePreview();
  renderAdminPostList();
  markEditorClean();
}

async function savePost(status) {
  const payload = {
    title: fields.title.value.trim(),
    slug: fields.slug.value.trim(),
    excerpt: fields.excerpt.value.trim(),
    status,
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
    fields.viewPost.href = `/post.html?slug=${encodeURIComponent(data.post.slug)}`;
    fields.viewPost.hidden = false;
    fields.editorHeading.textContent = "编辑文章";
    fields.editorState.textContent = `${statusLabel(data.post.status)} · 正在编辑：${data.post.slug}`;
    fields.message.textContent = data.post.status === "published" ? "已发布。" : "已保存为草稿。";
    markEditorClean();
    await refreshPosts();
    history.replaceState(null, "", `/admin/?slug=${data.post.slug}`);
  } catch (error) {
    fields.message.textContent = error.message;
  }
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
    const data = await window.blog.fetchJson(`/api/site/${key}`);
    messageEl.textContent = "";
    return JSON.parse(data.record.content || "[]");
  } catch (error) {
    messageEl.textContent = error.message === "内容不存在" ? "暂无内容，保存后会自动创建。" : error.message;
    return [];
  }
}

async function saveMemberEntry() {
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

  if (Number.isInteger(state.editingMemberIndex) && state.members[state.editingMemberIndex]) {
    state.members[state.editingMemberIndex] = item;
  } else {
    state.members.push(item);
  }

  clearMemberForm();
  renderFixedList(state.members, fields.memberList, "members");
  await saveMembers();
}

async function saveFameEntry() {
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

  if (Number.isInteger(state.editingFameIndex) && state.fameItems[state.editingFameIndex]) {
    state.fameItems[state.editingFameIndex] = item;
  } else {
    state.fameItems.push(item);
  }

  clearFameForm();
  renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");
  await saveFame();
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
        <article class="post-card${isEditingFixedItem(type, index) ? " is-active" : ""}">
          <p class="meta">${type === "members" ? `${window.blog.escapeHtml(item.term || "未填写届数")} · ${window.blog.escapeHtml(item.department || "")}` : "名人堂"}</p>
          <h2>${window.blog.escapeHtml(item.name)}</h2>
          <p>${window.blog.escapeHtml(item.title || "")}</p>
          <p>${window.blog.escapeHtml(item.desc || "")}</p>
          <div class="actions">
            <button type="button" class="secondary" data-edit-fixed="${type}:${index}">编辑</button>
            <button type="button" class="danger" data-remove-fixed="${type}:${index}">删除</button>
          </div>
        </article>
      `,
    )
    .join("");
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
  const item = target[index];
  if (!item) return;

  if (type === "members") {
    state.editingMemberIndex = index;
    fields.memberTerm.value = item.term || "";
    fields.memberDepartment.value = item.department || "主席团";
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
  if (!target[index]) return;

  target.splice(index, 1);

  if (isMembers) {
    if (state.editingMemberIndex === index) clearMemberForm();
    if (Number.isInteger(state.editingMemberIndex) && state.editingMemberIndex > index) {
      state.editingMemberIndex -= 1;
    }
    renderFixedList(state.members, fields.memberList, "members");
    await saveMembers();
    return;
  }

  if (state.editingFameIndex === index) clearFameForm();
  if (Number.isInteger(state.editingFameIndex) && state.editingFameIndex > index) {
    state.editingFameIndex -= 1;
  }
  renderFixedList(state.fameItems, fields.fameList, "hall-of-fame");
  await saveFame();
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
  if (label === "QQ" && /^\d+$/.test(value)) return `https://qm.qq.com/q/${value}`;
  return value;
}

function displayContactValue(label, value) {
  if (label === "Email") return value.replace(/^mailto:/, "");
  return value;
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

async function deletePost() {
  if (!state.editingSlug) return;
  if (!confirm(`确定删除 ${state.editingSlug} 吗？`)) return;

  await window.blog.fetchJson(`/api/posts/${encodeURIComponent(state.editingSlug)}`, {
    method: "DELETE",
  });
  await refreshPosts();
  closeEditor(true);
}

function resetEditor() {
  state.editingSlug = null;
  fields.title.value = "";
  fields.slug.value = "";
  fields.slug.disabled = false;
  fields.excerpt.value = "";
  fields.markdown.value = "";
  fields.delete.hidden = true;
  fields.viewPost.hidden = true;
  fields.viewPost.href = "#";
  fields.editorHeading.textContent = "新建文章";
  fields.editorState.textContent = "未保存";
  fields.message.textContent = "";
  updatePreview();
  renderAdminPostList();
  markEditorClean();
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

document.querySelector("[data-publish]").addEventListener("click", () => savePost("published"));
document.querySelector("[data-save-draft]").addEventListener("click", () => savePost("draft"));
document.querySelector("[data-editor-close]").addEventListener("click", () => closeEditor());
editorModal.addEventListener("click", (event) => {
  if (event.target === editorModal) closeEditor();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !editorModal.hidden) closeEditor();
});
fields.markdown.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  insertAtCursor(fields.markdown, "  ");
  updatePreview();
});
document.querySelector("[data-upload-post-image]").addEventListener("click", uploadPostImage);
fields.memberImageFile.addEventListener("change", uploadMemberAvatar);
fields.fameImageFile.addEventListener("change", uploadFameAvatar);
document.querySelector("[data-save-member-entry]").addEventListener("click", saveMemberEntry);
document.querySelector("[data-save-fame-entry]").addEventListener("click", saveFameEntry);
fields.memberList.addEventListener("click", handleFixedListClick);
fields.fameList.addEventListener("click", handleFixedListClick);
fields.memberContactLabel.addEventListener("change", () => updateContactPlaceholder(fields.memberContactLabel, fields.memberContactUrl));
fields.fameContactLabel.addEventListener("change", () => updateContactPlaceholder(fields.fameContactLabel, fields.fameContactUrl));
document.querySelector("[data-new]").addEventListener("click", () => {
  resetEditor();
  openEditor();
});
fields.delete.addEventListener("click", deletePost);
fields.search.addEventListener("input", renderAdminPostList);
fields.filterStatus.addEventListener("change", renderAdminPostList);
fields.title.addEventListener("input", updatePreview);
fields.excerpt.addEventListener("input", updatePreview);
fields.markdown.addEventListener("input", updatePreview);
bootAdmin().catch((error) => {
  fields.message.textContent = error.message;
});
