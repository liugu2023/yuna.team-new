const state = {
  editingSlug: null,
  editingMemberIndex: null,
  editingFameIndex: null,
  posts: [],
  members: [],
  fameItems: [],
  galleryItems: [],
  galleryPreviewUrl: "",
};
const fields = {
  title: document.querySelector("[data-title]"),
  tag: document.querySelector("[data-post-tag]"),
  excerpt: document.querySelector("[data-excerpt]"),
  markdown: document.querySelector("[data-markdown]"),
  message: document.querySelector("[data-message]"),
  preview: document.querySelector("[data-preview]"),
  search: document.querySelector("[data-search]"),
  filterStatus: document.querySelector("[data-filter-status]"),
  postListMessage: document.querySelector("[data-post-list-message]"),
  postSummary: document.querySelector("[data-post-summary]"),
  editorHeading: document.querySelector("[data-editor-heading]"),
  editorState: document.querySelector("[data-editor-state]"),
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
  importFile: document.querySelector("[data-import-db-file]"),
  importMessage: document.querySelector("[data-import-message]"),
  syncMessage: document.querySelector("[data-sync-message]"),
  galleryTitle: document.querySelector("[data-gallery-title]"),
  galleryFile: document.querySelector("[data-gallery-file]"),
  galleryScale: document.querySelector("[data-gallery-scale]"),
  galleryScaleValue: document.querySelector("[data-gallery-scale-value]"),
  galleryPreview: document.querySelector("[data-gallery-crop-preview]"),
  galleryPreviewImage: document.querySelector("[data-gallery-crop-preview-image]"),
  galleryMessage: document.querySelector("[data-gallery-message]"),
  galleryList: document.querySelector("[data-gallery-list]"),
  addGalleryButton: document.querySelector("[data-add-gallery-image]"),
};

const editorModal = document.querySelector("[data-editor-modal]");
const DIRECT_UPLOAD_LIMIT = 8 * 1024 * 1024;

function statusLabel(status) {
  return status === "published" ? "已发布" : "草稿";
}

function editorSnapshot() {
  return JSON.stringify({
    title: fields.title.value,
    tag: fields.tag.value,
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
  await Promise.all([refreshPosts(), loadMembers(), loadFame(), loadGallery()]);
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
  renderPostSummary();
  const posts = state.posts.filter((post) => {
    const matchesStatus = status === "all" || post.status === status;
    const haystack = `${post.title} ${post.tag || ""} ${post.excerpt || ""} ${post.slug}`.toLowerCase();
    return matchesStatus && (!keyword || haystack.includes(keyword));
  });

  if (!posts.length) {
    list.innerHTML = '<p class="empty-state">没有匹配的文章。</p>';
    return;
  }

  list.innerHTML = posts
    .map(
      (post) => `
        <article class="admin-item admin-post-card${state.editingSlug === post.slug ? " active is-active" : ""}">
          <p class="meta">${post.status === "published" ? "已发布" : "草稿"} · ${window.blog.escapeHtml(post.tag || "未分类")} · ${window.blog.formatDate(post.published_at || post.updated_at)} · ${window.blog.formatViews(post.view_count)}</p>
          <strong>${window.blog.escapeHtml(post.title)}</strong>
          <p>${window.blog.escapeHtml(post.excerpt || "")}</p>
          <div class="editor-actions">
            <button class="btn secondary" data-edit-post="${window.blog.escapeHtml(post.slug)}">编辑</button>
            <button class="btn danger" data-delete-post="${window.blog.escapeHtml(post.slug)}">删除</button>
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
  list.querySelectorAll("[data-delete-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deletePost(button.dataset.deletePost);
    });
  });
}

function renderPostSummary() {
  if (!fields.postSummary) return;
  const total = state.posts.length;
  const published = state.posts.filter((post) => post.status === "published").length;
  const drafts = state.posts.filter((post) => post.status !== "published").length;
  const views = state.posts.reduce((sum, post) => sum + Number(post.view_count || 0), 0);
  fields.postSummary.innerHTML = `
    <div><strong>${total.toLocaleString("zh-CN")}</strong><span>全部文章</span></div>
    <div><strong>${published.toLocaleString("zh-CN")}</strong><span>已发布</span></div>
    <div><strong>${drafts.toLocaleString("zh-CN")}</strong><span>草稿</span></div>
    <div><strong>${views.toLocaleString("zh-CN")}</strong><span>总阅读</span></div>
  `;
}

async function loadPost(slug) {
  const data = await window.blog.fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
  state.editingSlug = slug;
  fields.title.value = data.post.title;
  fields.tag.value = data.post.tag || "协会动态";
  fields.excerpt.value = data.post.excerpt || "";
  fields.markdown.value = data.markdown;
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
    tag: fields.tag.value.trim(),
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

async function deletePost(slug) {
  if (!slug) return;
  const post = state.posts.find((item) => item.slug === slug);
  const title = post?.title || slug;
  if (!confirm(`确定删除文章「${title}」吗？此操作不可恢复。`)) return;

  try {
    fields.postListMessage.textContent = "正在删除文章...";
    await window.blog.fetchJson(`/api/posts/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
    if (state.editingSlug === slug) {
      resetEditor();
    }
    await refreshPosts();
    fields.postListMessage.textContent = "文章已删除。";
  } catch (error) {
    fields.postListMessage.textContent = error.message;
  }
}

async function insertImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    fields.message.textContent = "只能插入图片文件。";
    return;
  }

  try {
    fields.message.textContent = "图片上传中…";
    const data = await uploadImage(file, `posts/${state.editingSlug || "drafts"}`);
    insertAtCursor(fields.markdown, `\n![${file.name}](${data.url})\n`);
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
  const file = fields.postImageFile.files[0];
  if (!file) {
    fields.message.textContent = "请选择文章图片。";
    return;
  }
  await insertImageFile(file);
}

async function uploadPostFiles() {
  const files = Array.from(fields.postFile.files || []);
  if (!files.length) {
    fields.message.textContent = "请选择要上传的附件资料。";
    return;
  }

  const urls = [];
  const folder = `posts/${state.editingSlug || "drafts"}/files`;
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
  return uploadMedia(file, path);
}

async function uploadMedia(file, path, onProgress) {
  if (file.size <= DIRECT_UPLOAD_LIMIT) {
    const data = await window.blog.fetchJson(`/api/admin/media/${encodeMediaPath(path)}`, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    onProgress?.(file.size, file.size);
    return data;
  }

  return uploadMultipartMedia(file, path, onProgress);
}

async function uploadMultipartMedia(file, path, onProgress) {
  const init = await window.blog.fetchJson("/api/admin/uploads/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    }),
  });

  const parts = [];
  const partSize = init.partSize || DIRECT_UPLOAD_LIMIT;
  let uploaded = 0;

  try {
    for (let offset = 0, partNumber = 1; offset < file.size; offset += partSize, partNumber += 1) {
      const chunk = file.slice(offset, Math.min(file.size, offset + partSize));
      const response = await fetch(
        `/api/admin/uploads/part?path=${encodeURIComponent(path)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`,
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

    return window.blog.fetchJson("/api/admin/uploads/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path,
        uploadId: init.uploadId,
        parts,
      }),
    });
  } catch (error) {
    await window.blog.fetchJson("/api/admin/uploads/abort", {
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

function encodeMediaPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function uploadPercent(loaded, total) {
  if (!total) return "0%";
  return `${Math.min(100, Math.round((loaded / total) * 100))}%`;
}

function cleanDocumentName(value) {
  return (value || "file")
    .replace(/[\\/:*?"<>|#%&{}$!`'@+=]/g, "-")
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

async function loadGallery() {
  state.galleryItems = await loadJsonRecord("homepage-gallery", fields.galleryMessage);
  renderGalleryList();
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

async function saveGallery() {
  await saveFixedRecord("homepage-gallery", "主页图库", state.galleryItems, fields.galleryMessage);
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
    listEl.innerHTML = '<p class="empty-state">当前暂无条目。</p>';
    return;
  }

  listEl.innerHTML = items
    .map((item, index) => {
      const meta =
        type === "members"
          ? `${window.blog.escapeHtml(item.term || "未填写届数")} · ${window.blog.escapeHtml(item.department || "")}`
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
          ${item.desc ? `<p>${window.blog.escapeHtml(item.desc)}</p>` : ""}
          <div class="member-actions">
            <button type="button" data-edit-fixed="${type}:${index}">编辑</button>
            <button type="button" class="danger" data-remove-fixed="${type}:${index}">删除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function addGalleryImage() {
  const file = fields.galleryFile.files?.[0];
  if (!file) {
    fields.galleryMessage.textContent = "请选择背景图片。";
    return;
  }
  if (!file.type.startsWith("image/")) {
    fields.galleryMessage.textContent = "只能上传图片文件。";
    return;
  }

  try {
    fields.addGalleryButton.disabled = true;
    fields.galleryMessage.textContent = "正在裁剪并上传图片...";
    const croppedFile = await cropHomepageImage(file, Number(fields.galleryScale.value || 1));
    const data = await uploadImage(croppedFile, "homepage");
    const item = {
      id: crypto.randomUUID(),
      title: fields.galleryTitle.value.trim() || file.name,
      url: data.url,
      size: "1920x360",
      scale: Number(fields.galleryScale.value || 1),
      active: state.galleryItems.length === 0,
      createdAt: new Date().toISOString(),
    };
    state.galleryItems.unshift(item);
    fields.galleryTitle.value = "";
    fields.galleryFile.value = "";
    fields.galleryScale.value = "1";
    updateGalleryCropPreview();
    renderGalleryList();
    await saveGallery();
    fields.galleryMessage.textContent = "图片已添加到图库。";
  } catch (error) {
    fields.galleryMessage.textContent = error.message;
  } finally {
    fields.addGalleryButton.disabled = false;
  }
}

async function cropHomepageImage(file, scale) {
  const targetWidth = 1920;
  const targetHeight = 360;
  const image = await loadImage(file);
  const targetRatio = targetWidth / targetHeight;
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const zoom = Math.max(1, Math.min(scale || 1, 2.5));

  let sourceWidth;
  let sourceHeight;
  if (imageRatio > targetRatio) {
    sourceHeight = image.naturalHeight;
    sourceWidth = sourceHeight * targetRatio;
  } else {
    sourceWidth = image.naturalWidth;
    sourceHeight = sourceWidth / targetRatio;
  }

  sourceWidth /= zoom;
  sourceHeight /= zoom;

  const sourceX = Math.max(0, (image.naturalWidth - sourceWidth) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceHeight) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图片裁剪。");
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("图片裁剪失败。");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-homepage-1920x360.jpg`, {
    type: "image/jpeg",
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败。"));
    };
    image.src = url;
  });
}

function updateGalleryCropPreview() {
  const file = fields.galleryFile.files?.[0];
  const scale = Number(fields.galleryScale.value || 1);
  fields.galleryScaleValue.textContent = `${scale.toFixed(2)}x`;
  fields.galleryPreviewImage.style.setProperty("--gallery-crop-scale", scale);

  if (!file) {
    if (state.galleryPreviewUrl) URL.revokeObjectURL(state.galleryPreviewUrl);
    state.galleryPreviewUrl = "";
    fields.galleryPreviewImage.hidden = true;
    fields.galleryPreviewImage.removeAttribute("src");
    fields.galleryPreview.querySelector("span").hidden = false;
    return;
  }

  if (state.galleryPreviewUrl) URL.revokeObjectURL(state.galleryPreviewUrl);
  state.galleryPreviewUrl = URL.createObjectURL(file);
  fields.galleryPreviewImage.src = state.galleryPreviewUrl;
  fields.galleryPreviewImage.hidden = false;
  fields.galleryPreview.querySelector("span").hidden = true;
}

function renderGalleryList() {
  if (!fields.galleryList) return;
  if (!state.galleryItems.length) {
    fields.galleryList.innerHTML = '<p class="empty-state">当前暂无主页背景图片。</p>';
    return;
  }

  fields.galleryList.innerHTML = state.galleryItems
    .map(
      (item, index) => `
        <article class="gallery-admin-card visual-card${item.active ? " is-active" : ""}">
          <span class="flash"></span>
          <img src="${window.blog.escapeHtml(window.blog.normalizeAssetUrl(item.url))}" alt="${window.blog.escapeHtml(item.title || "主页背景")}" loading="lazy">
          <div>
            <h4>${window.blog.escapeHtml(item.title || "未命名图片")}</h4>
            <p class="meta">${item.active ? "当前展示" : "未展示"}</p>
            <div class="editor-actions">
              <button type="button" class="btn secondary" data-gallery-active="${index}" ${item.active ? "disabled" : ""}>设为展示</button>
              <button type="button" class="btn danger" data-gallery-remove="${index}">删除</button>
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

async function handleGalleryClick(event) {
  if (!(event.target instanceof Element)) return;

  const activeButton = event.target.closest("[data-gallery-active]");
  if (activeButton) {
    const index = Number(activeButton.dataset.galleryActive);
    if (!state.galleryItems[index]) return;
    state.galleryItems = state.galleryItems.map((item, itemIndex) => ({
      ...item,
      active: itemIndex === index,
    }));
    renderGalleryList();
    await saveGallery();
    return;
  }

  const removeButton = event.target.closest("[data-gallery-remove]");
  if (removeButton) {
    const index = Number(removeButton.dataset.galleryRemove);
    if (!state.galleryItems[index]) return;
    state.galleryItems.splice(index, 1);
    if (state.galleryItems.length && !state.galleryItems.some((item) => item.active)) {
      state.galleryItems[0].active = true;
    }
    renderGalleryList();
    await saveGallery();
  }
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

async function exportDatabase() {
  fields.exportMessage.textContent = "正在下载导出文件...";
}

async function importDatabase() {
  const file = fields.importFile.files?.[0];
  if (!file) {
    fields.importMessage.textContent = "请选择要导入的 JSON 文件。";
    return;
  }

  if (!confirm("导入会强制覆盖文章、固定页面和备份记录，确定继续吗？")) {
    return;
  }

  fields.importMessage.textContent = "正在导入...";
  try {
    const payload = JSON.parse(await file.text());
    const data = await window.blog.fetchJson("/api/admin/import?mode=replace-all", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const snapshotNote = data.snapshotKey ? `导入前已备份至 ${data.snapshotKey}。` : "";
    fields.importMessage.textContent =
      `导入完成：文章 ${data.counts.posts}，页面 ${data.counts.siteRecords}，备份 ${data.counts.siteRecordBackups}。${snapshotNote}`;
    fields.importFile.value = "";
    await Promise.all([refreshPosts(), loadMembers(), loadFame(), loadGallery()]);
  } catch (error) {
    fields.importMessage.textContent = error.message;
  }
}

async function syncMarkdownBackup() {
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
}

function resetEditor() {
  state.editingSlug = null;
  fields.title.value = "";
  fields.tag.value = "协会动态";
  fields.excerpt.value = "";
  fields.markdown.value = "";
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
  const tag = fields.tag.value.trim() || "协会动态";
  const excerpt = fields.excerpt.value.trim();
  fields.preview.innerHTML = `
    <p class="meta">${window.blog.escapeHtml(tag)}</p>
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
bind("[data-upload-post-file]", "click", uploadPostFiles);
bindElement(fields.memberImageFile, "change", uploadMemberAvatar, "data-member-image-file");
bindElement(fields.fameImageFile, "change", uploadFameAvatar, "data-fame-image-file");
bind("[data-save-member-entry]", "click", saveMemberEntry);
bind("[data-save-fame-entry]", "click", saveFameEntry);
bind("[data-export-db]", "click", exportDatabase);
bind("[data-import-db]", "click", importDatabase);
bind("[data-sync-markdown]", "click", syncMarkdownBackup);
bind("[data-add-gallery-image]", "click", addGalleryImage);
bindElement(fields.galleryFile, "change", updateGalleryCropPreview, "data-gallery-file");
bindElement(fields.galleryScale, "input", updateGalleryCropPreview, "data-gallery-scale");
bindElement(fields.memberList, "click", handleFixedListClick, "data-member-list");
bindElement(fields.fameList, "click", handleFixedListClick, "data-fame-list");
bindElement(fields.galleryList, "click", handleGalleryClick, "data-gallery-list");
bindElement(fields.memberContactLabel, "change", () => updateContactPlaceholder(fields.memberContactLabel, fields.memberContactUrl), "data-member-contact-label");
bindElement(fields.fameContactLabel, "change", () => updateContactPlaceholder(fields.fameContactLabel, fields.fameContactUrl), "data-fame-contact-label");
bind("[data-new]", "click", () => {
  resetEditor();
  openEditor();
});
bindElement(fields.search, "input", renderAdminPostList, "data-search");
bindElement(fields.filterStatus, "change", renderAdminPostList, "data-filter-status");
bindElement(fields.title, "input", updatePreview, "data-title");
bindElement(fields.tag, "input", updatePreview, "data-post-tag");
bindElement(fields.excerpt, "input", updatePreview, "data-excerpt");
bindElement(fields.markdown, "input", updatePreview, "data-markdown");
bootAdmin().catch((error) => {
  fields.message.textContent = error.message;
});
