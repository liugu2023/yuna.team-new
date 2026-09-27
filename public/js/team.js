// 协会成员与名人堂：按届数、部门分组渲染。依赖 core.js、markdown.js。

function renderMembersRecord(record, items) {
  const terms = sortedMemberTerms(items);
  const activeTerm = terms[0];
  return `
    <div class="record-view">
      <div class="record-head">
        <h2 class="record-title">${escapeHtml(record.title)}</h2>
        <label class="field-lite inline-control">
          <span>届数</span>
          <select class="select-input" data-term-switch>
            ${terms.map((term) => `<option value="${escapeHtml(term)}">${escapeHtml(term)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div data-term-panels>
        ${terms.map((term) => renderMemberTerm(term, items.filter((item) => memberTermLabel(item) === term), term === activeTerm)).join("")}
      </div>
    </div>
  `;
}

function renderMemberTerm(term, items, active) {
  const departments = ["主席团", "开发部", "网络安全部", "运维部", "组宣部"];
  return `
    <section data-term-panel="${escapeHtml(term)}" ${active ? "" : "hidden"}>
      ${departments
        .map((department) => {
          const departmentItems = items.filter((item) => normalizeDepartmentName(item.department || "未分组") === department);
          if (!departmentItems.length) return "";
          return `
            <h2 class="record-group-title">${escapeHtml(department)}<span>${departmentItems.length.toLocaleString("zh-CN")} 人</span></h2>
            <div class="member-grid refined-member-grid">
              ${departmentItems.map(renderProfileCard).join("")}
            </div>
          `;
        })
        .join("")}
    </section>
  `;
}

function normalizeDepartmentName(value) {
  return value === "\u7ec4\u5ba3\u79d8\u4e66\u5904" || value === "秘书处" ? "组宣部" : value;
}

function memberDepartmentLabel(item) {
  return normalizeDepartmentName(String(item?.department || "").trim()) || "未分组";
}

function sortedMemberDepartments(items) {
  const preferredDepartments = ["主席团", "开发部", "网络安全部", "运维部", "组宣部"];
  const departments = [...new Set(items.map(memberDepartmentLabel))];
  return departments.sort((a, b) => {
    const rankA = preferredDepartments.indexOf(a);
    const rankB = preferredDepartments.indexOf(b);
    if (rankA !== -1 || rankB !== -1) {
      if (rankA === -1) return 1;
      if (rankB === -1) return -1;
      return rankA - rankB;
    }
    if (a === "未分组") return 1;
    if (b === "未分组") return -1;
    return a.localeCompare(b, "zh-CN");
  });
}

function memberTermLabel(item) {
  return String(item?.term || "").trim() || "未填写届数";
}

function sortedMemberTerms(items) {
  return [...new Set(items.map(memberTermLabel))].sort(compareMemberTerms);
}

function compareMemberTerms(a, b) {
  const rankA = memberTermOrdinal(a);
  const rankB = memberTermOrdinal(b);
  if (rankA !== null || rankB !== null) {
    if (rankA === null) return 1;
    if (rankB === null) return -1;
    if (rankA !== rankB) return rankB - rankA;
  }
  if (a === "未填写届数") return 1;
  if (b === "未填写届数") return -1;
  return String(a).localeCompare(String(b), "zh-CN", { numeric: true });
}

function memberTermOrdinal(value) {
  const text = String(value || "").trim().replace(/\s+/g, "");
  if (!text || text === "未填写届数") return null;

  const numberMatch = text.match(/^第?(\d+)届?$/) || text.match(/^(\d+)$/);
  if (numberMatch) return Number(numberMatch[1]);

  const chineseMatch = text.match(/^第?([零〇一二两三四五六七八九十百千万廿卅]+)届?$/);
  if (!chineseMatch) return null;
  return parseChineseOrdinal(chineseMatch[1]);
}

function parseChineseOrdinal(value) {
  const text = String(value || "");
  const digitMap = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (text.startsWith("廿")) return 20 + (digitMap[text[1]] || 0);
  if (text.startsWith("卅")) return 30 + (digitMap[text[1]] || 0);

  const unitMap = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of text) {
    if (digitMap[char] !== undefined) {
      number = digitMap[char];
      continue;
    }
    const unit = unitMap[char];
    if (!unit) return null;
    if (unit === 10000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }
  const result = total + section + number;
  return result > 0 ? result : null;
}

async function renderTeamRecords() {
  await Promise.all([
    renderTeamRecord("members", document.querySelector("[data-team-members]")),
    renderTeamRecord("hall-of-fame", document.querySelector("[data-team-fame]")),
  ]);
}

async function renderTeamRecord(key, container) {
  if (!container) return;

  try {
    const data = await fetchSiteRecord(key);
    const items = JSON.parse(data.record.content || "[]");
    if (!Array.isArray(items) || !items.length) {
      container.innerHTML = '<p class="empty-state">暂无内容。</p>';
      return;
    }

    container.innerHTML = key === "members"
      ? renderTeamMembers(items)
      : `<div class="member-grid refined-member-grid fame-grid">${items.map(renderFameCard).join("")}</div>`;
    bindTeamMemberFilters(container);
  } catch (error) {
    container.innerHTML = isNotFoundError(error)
      ? '<p class="empty-state">暂无内容。</p>'
      : `<p class="empty-state error">${escapeHtml(error.message)}</p>`;
  }
}

function renderTeamMembers(items) {
  const terms = sortedMemberTerms(items);
  const departments = sortedMemberDepartments(items);
  const activeTerm = terms[0];
  return `
    <div class="team-toolbar">
      <div class="team-term-switcher" role="group" aria-label="往届成员届数切换">
        ${terms
          .map((term) => {
            const count = items.filter((item) => memberTermLabel(item) === term).length;
            const active = term === activeTerm;
            return `<button class="team-term-button${active ? " is-active" : ""}" type="button" data-team-term-button="${escapeHtml(term)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(term)}<span>${count.toLocaleString("zh-CN")} 人</span></button>`;
          })
          .join("")}
      </div>
      <label class="field-lite team-department-filter">
        <span>部门</span>
        <select class="select-input" data-team-department-filter aria-label="按部门筛选往届成员">
          <option value="">全部部门</option>
          ${departments.map((department) => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div data-team-term-panels>
      ${terms
        .map((term) => {
          const termItems = items.filter((item) => memberTermLabel(item) === term);
          return `
            <section data-team-term-panel="${escapeHtml(term)}" ${term === activeTerm ? "" : "hidden"}>
              <div class="member-grid refined-member-grid">
                ${termItems.map(renderProfileCard).join("")}
              </div>
              <p class="empty-state team-filter-empty" data-team-filter-empty aria-live="polite" hidden></p>
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

function bindTeamMemberFilters(container) {
  const buttons = Array.from(container.querySelectorAll("[data-team-term-button]"));
  if (!buttons.length) return;
  const departmentFilter = container.querySelector("[data-team-department-filter]");

  const applyFilters = (resetUnavailableDepartment = false) => {
    const activeTerm = buttons.find((button) => button.classList.contains("is-active"))?.dataset.teamTermButton || "";
    const activePanel = Array.from(container.querySelectorAll("[data-team-term-panel]")).find(
      (panel) => panel.dataset.teamTermPanel === activeTerm,
    );
    let department = departmentFilter?.value || "";
    if (resetUnavailableDepartment && department && activePanel) {
      const availableDepartments = new Set(
        Array.from(activePanel.querySelectorAll("[data-member-department]")).map((card) => card.dataset.memberDepartment || ""),
      );
      if (!availableDepartments.has(department)) {
        department = "";
        departmentFilter.value = "";
      }
    }

    container.querySelectorAll("[data-team-term-panel]").forEach((panel) => {
      const active = panel.dataset.teamTermPanel === activeTerm;
      panel.hidden = !active;
      let visibleCount = 0;
      panel.querySelectorAll("[data-member-department]").forEach((card) => {
        const visible = !department || card.dataset.memberDepartment === department;
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      const emptyState = panel.querySelector("[data-team-filter-empty]");
      if (emptyState) {
        emptyState.hidden = !active || visibleCount > 0;
        emptyState.textContent = department ? `当前届数暂无${department}成员。` : "当前届数暂无成员。";
      }
    });
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
      applyFilters(true);
    });
  });
  departmentFilter?.addEventListener("change", applyFilters);
  applyFilters();
}

// 成员卡：头像 + 部门标签 + 姓名/职务 + 简介 + 带图标的联系方式。会长/部长等负责人加 .is-lead。
function renderProfileCard(item) {
  const department = item.department ? normalizeDepartmentName(item.department) : "";
  const title = String(item.title || "").trim();
  const lead = /会长|主席|部长|负责人/.test(title);
  return `
    <article class="member-card refined-member-card profile-card spotlight reveal visible${lead ? " is-lead" : ""}" data-member-department="${escapeHtml(memberDepartmentLabel(item))}">
      <div class="member-card-top">
        ${renderMemberAvatar(item)}
        <span class="tag${lead ? " is-brand" : ""}">${escapeHtml(department || title || "YUNA")}</span>
      </div>
      <h3>${escapeHtml(item.name || "")}</h3>
      ${title ? `<p class="meta">${escapeHtml(title)}</p>` : ""}
      ${item.desc ? `<p class="profile-desc">${escapeHtml(item.desc)}</p>` : ""}
      ${renderMemberLinks(item)}
    </article>
  `;
}

// 名人堂卡：序号 + 职务（如「第1届会长」）作等宽眉标，头像放大，底部同样是联系方式。
function renderFameCard(item, index) {
  const title = String(item.title || "").trim();
  return `
    <article class="member-card refined-member-card profile-card fame-card spotlight reveal visible" data-member-department="${escapeHtml(memberDepartmentLabel(item))}">
      <div class="fame-card-head">
        <span class="fame-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
        ${title ? `<span class="fame-title">${escapeHtml(title)}</span>` : ""}
      </div>
      ${renderMemberAvatar(item)}
      <h3>${escapeHtml(item.name || "")}</h3>
      ${item.desc ? `<p class="profile-desc">${escapeHtml(item.desc)}</p>` : ""}
      ${renderMemberLinks(item)}
    </article>
  `;
}

function renderMemberAvatar(item) {
  const avatarText = (item.name || item.title || "Y").slice(0, 2).toUpperCase();
  return item.avatar
    ? `<img class="avatar image-avatar" src="${escapeHtml(normalizeAssetUrl(item.avatar))}" alt="${escapeHtml(item.name || "")}" loading="lazy">`
    : `<div class="avatar" aria-hidden="true">${escapeHtml(avatarText)}</div>`;
}

function renderMemberLinks(item) {
  const links = Array.isArray(item.links) ? item.links : [];
  const html = links
    .map((link) => {
      const href = safeContactLinkUrl(link);
      if (!href) return "";
      const label = link.label || link.url;
      return `<a class="member-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${memberLinkIcon(label, href)}<span>${escapeHtml(label)}</span></a>`;
    })
    .filter(Boolean)
    .join("");
  return html ? `<div class="member-actions member-links">${html}</div>` : "";
}

// 线条图标（currentColor），按标签或地址粗略识别；识别不了用通用链接图标。
function memberLinkIcon(label, href) {
  const text = `${label} ${href}`.toLowerCase();
  let paths = '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>';
  if (/github/.test(text)) {
    paths = '<path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>';
  } else if (/qq|tencent/.test(text)) {
    paths = '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>';
  } else if (/mailto:|邮箱|email/.test(text)) {
    paths = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>';
  } else if (/博客|blog|主页|网站|site/.test(text)) {
    paths = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>';
  }
  return `<svg class="member-link-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-term-switch]")) return;
  const term = event.target.value;
  document.querySelectorAll("[data-term-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.termPanel !== term;
  });
});

Object.assign(window.blog, {
  renderTeamRecords,
});
