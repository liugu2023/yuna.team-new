// 页面上 data-editable-block 标注的文案块：读取、渲染与管理员内联编辑。依赖 core.js。
// 块内钩子（记录为 site_records 中 key=块名 的 JSON：{ fields, hrefs?, lists?, tags?, rows?, links? }）：
//   data-block-field="名"            文字字段 → fields[名]；节点带子元素时只改直接子级文字（保留箭头等）
//     + data-block-href              同时可改 href → hrefs[名]（链接/按钮）
//     + data-block-multiline="breaks" 多行，换行渲染为 <br>
//     + data-block-label="中文名"     编辑器里的字段名
//   data-block-list="名"             纯文字列表 → lists[名]，以第一个子元素为模板；data-block-list-text="名" 写入“、”连接的全文
//   data-block-tags / data-block-rows / data-block-links   标签 / 分项行 / 链接列表（links 只替换直接子级 <a>）
// 记录里缺少的字段一律保留 HTML 默认内容，因此给已有块新增字段是向后兼容的。

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

// 同一个块名可能出现在多个页面（如部门卡：首页、部门一览、关于协会、加入我们），各页展示的字段不完全相同。
// 保存时先合并线上已有内容，本页没有的字段 / 链接地址原样保留，避免在一个页面保存后冲掉其它页面的内容。
async function mergeWithStoredBlock(key, nextState) {
  let stored = {};
  try {
    const data = await fetchSiteRecord(key);
    if (data.record?.kind === "json") stored = JSON.parse(data.record.content || "{}") || {};
  } catch {
    // 记录不存在：直接用本页内容。
  }
  const merged = { ...stored, ...nextState };
  for (const part of ["fields", "hrefs", "lists"]) {
    if (stored[part] || nextState[part]) merged[part] = { ...(stored[part] || {}), ...(nextState[part] || {}) };
  }
  return merged;
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

  // 链接字段（data-block-href）：文字走 fields，地址存 hrefs；旧数据没有 hrefs 时保留 HTML 默认地址。
  const hrefs = state.hrefs && typeof state.hrefs === "object" ? state.hrefs : {};
  Object.entries(hrefs).forEach(([name, value]) => {
    editableBlockNodes(block, `[data-block-field="${name}"][data-block-href]`).forEach((node) => {
      setEditableHref(node, value);
    });
  });

  // 纯文字列表（data-block-list）：以第一个子元素为模板重建；[data-block-list-text] 同步写入以“、”连接的全文。
  const lists = state.lists && typeof state.lists === "object" ? state.lists : {};
  Object.entries(lists).forEach(([name, items]) => {
    if (!Array.isArray(items)) return;
    const values = items.map((item) => String(item || "").trim()).filter(Boolean);
    if (!values.length) return;
    editableBlockNodes(block, `[data-block-list="${name}"]`).forEach((node) => {
      renderEditableList(node, values);
    });
    editableBlockNodes(block, `[data-block-list-text="${name}"]`).forEach((node) => {
      node.textContent = values.join("、");
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
      renderEditableLinks(links, state.links);
    }
  }
}

// 只替换容器里直接子级的 <a>，保留标题等其它子元素（页脚链接栏的 h2 与链接同处一层）；
// 纯链接容器（如 .aside-list）的结果与旧实现一致。外链自动新窗口打开。
function renderEditableLinks(container, items) {
  const html = items
    .filter((link) => String(link?.label || link?.href || "").trim())
    .map((link) => {
      const href = safeLinkUrl(link.href) || "#";
      const external = /^https?:\/\//i.test(href) && !href.startsWith(location.origin);
      const target = external ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${escapeHtml(href)}"${target}>${escapeHtml(String(link.label || href).trim())}</a>`;
    })
    .join("");
  const oldLinks = Array.from(container.children).filter((child) => child.tagName === "A");
  const anchor = oldLinks[0] || null;
  const fragment = document.createRange().createContextualFragment(html);
  const actions = container.querySelector(":scope > .editable-block-actions");
  if (anchor) anchor.before(fragment);
  else if (actions) actions.before(fragment);
  else container.append(fragment);
  oldLinks.forEach((link) => link.remove());
}

function setEditableHref(node, value) {
  const href = safeLinkUrl(value);
  if (!href) return;
  node.setAttribute("href", href);
  if (/^https?:\/\//i.test(href) && !href.startsWith(location.origin)) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener");
  } else {
    node.removeAttribute("target");
    node.removeAttribute("rel");
  }
}

// 列表容器的第一个子元素作为模板（保留 class），逐项复制后写入文字。
// 关键词轮换（[data-rotator]）由 yuna-ui.js 按元素绑定一次，因此整体换成新节点让它重新绑定。
function renderEditableList(node, values) {
  const template = node.firstElementChild;
  if (!template) return;
  const target = node.hasAttribute("data-rotator") ? node.cloneNode(false) : node;
  if (target !== node) {
    target.classList.remove("is-ready");
    target.style.removeProperty("width");
  }
  const items = values.map((value) => {
    const item = template.cloneNode(false);
    item.classList.remove("is-active", "is-leaving");
    item.textContent = value;
    return item;
  });
  target.replaceChildren(...items);
  if (target !== node) node.replaceWith(target);
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
      href: node.hasAttribute("data-block-href") ? node.getAttribute("href") || "" : null,
    });
  });

  const lists = {};
  const listMeta = [];
  editableBlockNodes(block, "[data-block-list]").forEach((node) => {
    const name = node.dataset.blockList;
    if (!name || lists[name]) return;
    lists[name] = Array.from(node.children).map((item) => item.textContent.trim()).filter(Boolean);
    listMeta.push({ name, label: node.dataset.blockLabel || editableFieldLabel(name) });
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
    ? Array.from(linkNode.querySelectorAll(":scope > a")).map((link) => ({
        label: link.textContent.trim(),
        href: link.getAttribute("href") || "",
      }))
    : null;

  return { fields, fieldMeta, lists, listMeta, tags, rows, links };
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
    kicker: "编号小标",
    note: "补充说明",
    label: "说明",
    unit: "单位",
    value: "数值",
    primaryAction: "主按钮",
    secondaryAction: "次按钮",
    moreLink: "右侧链接",
    cta: "按钮",
  };
  return labels[name] || name;
}

// 带装饰子元素的节点（按钮里的箭头、目录里的编号 span 等）只读写直接子级文字，子元素原样保留。
function hasElementChildren(node) {
  return node.children.length > 0 && node.dataset.blockMultiline !== "breaks";
}

function getEditableText(node) {
  if ("value" in node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA")) {
    return String(node.value || "").trim();
  }
  if (node.hasAttribute("data-count")) return String(node.getAttribute("data-count") || "").trim();
  if (hasElementChildren(node)) {
    return Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent)
      .join("")
      .trim();
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
  if (node.hasAttribute("data-count")) {
    // 计数数字由 yuna-ui.js 按 data-count 滚动，改属性会触发重新计数。
    if (Number.isFinite(Number(text)) && text.trim()) node.setAttribute("data-count", text.trim());
    else node.removeAttribute("data-count");
    node.textContent = text;
    return;
  }
  if (hasElementChildren(node)) {
    const textNodes = Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE);
    const first = textNodes.find((child) => child.textContent.trim()) || textNodes[0];
    if (!first) {
      node.prepend(document.createTextNode(text));
      return;
    }
    const [, lead, trail] = first.textContent.match(/^(\s*)[\s\S]*?(\s*)$/) || ["", "", ""];
    first.textContent = `${lead}${text}${trail}`;
    textNodes.filter((child) => child !== first).forEach((child) => {
      if (child.textContent.trim()) child.remove();
    });
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
        ${
          field.href === null
            ? ""
            : `<label>
          ${escapeHtml(field.label)}链接（站内以 / 开头，外链以 https:// 开头）
          <input class="admin-input" data-block-editor-href="${escapeHtml(field.name)}" value="${escapeHtml(field.href)}" />
        </label>`
        }
      `,
    )
    .join("") + state.listMeta
    .map(
      (list) => `
        <label>
          ${escapeHtml(list.label)}（每行一项）
          <textarea class="admin-input" data-block-editor-list="${escapeHtml(list.name)}" rows="5">${escapeHtml(state.lists[list.name].join("\n"))}</textarea>
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
    const hrefInputs = fieldsContainer.querySelectorAll("[data-block-editor-href]");
    if (hrefInputs.length) {
      nextState.hrefs = {};
      hrefInputs.forEach((input) => {
        nextState.hrefs[input.dataset.blockEditorHref] = input.value.trim();
      });
    }
    const listInputs = fieldsContainer.querySelectorAll("[data-block-editor-list]");
    if (listInputs.length) {
      nextState.lists = {};
      listInputs.forEach((input) => {
        nextState.lists[input.dataset.blockEditorList] = input.value.split("\n").map((item) => item.trim()).filter(Boolean);
      });
    }
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
      await saveSiteJsonRecord(key, title, await mergeWithStoredBlock(key, nextState));
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

Object.assign(window.blog, {
  renderEditableBlocks,
});
