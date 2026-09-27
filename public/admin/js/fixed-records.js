// 协会成员与名人堂：整表读-改-写的结构化记录维护。

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
    listEl.innerHTML = '<p class="empty-state">这里还空着，左边填好后保存就会出现在这里。</p>';
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
        <article class="admin-fixed-card${isEditingFixedItem(type, index) ? " is-active" : ""}">
          ${avatar}
          <div class="admin-fixed-body">
            <h3>${window.blog.escapeHtml(item.name)}</h3>
            <p class="meta">${[meta, window.blog.escapeHtml(item.title || "")].filter(Boolean).join(" · ")}</p>
            ${item.desc ? `<p class="profile-desc">${window.blog.escapeHtml(item.desc)}</p>` : ""}
            ${renderContactIcons(item.links)}
          </div>
          <div class="member-actions">
            <button type="button" class="btn secondary compact" data-edit-fixed="${type}:${index}">编辑</button>
            <button type="button" class="btn danger compact" data-remove-fixed="${type}:${index}">删除</button>
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

function qqContactNumber(value) {
  const raw = String(value || "").trim();
  if (/^\d+$/.test(raw)) return raw;
  return (
    raw.match(/^https?:\/\/qm\.qq\.com\/q\/(\d+)\/?$/i)?.[1]
    || raw.match(/[?&]uin=(\d+)/i)?.[1]
    || ""
  );
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
