// 页脚文案与友情链接，全站每页加载后自动渲染。依赖 core.js、markdown.js。

const FRIEND_LINKS_KEY = "friend-links";

const FOOTER_COPY_PREFIX = "footer";

const DEFAULT_FRIEND_LINKS = {
  title: "友情链接",
  links: [
    { label: "燕山大学", href: "https://www.ysu.edu.cn/", icon: "" },
  ],
};

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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderFriendLinks);
} else {
  renderFriendLinks();
}

Object.assign(window.blog, {
  renderFriendLinks,
});
