// 管理后台共享状态、表单控件引用和通用小工具。后台脚本都是普通 <script>，
// 依赖前台的 public/js/*（经由 window.blog 或全局函数），加载顺序见 admin/index.html。

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

function adminErrorText(error) {
  if (error?.status === 401) return "登录已过期，请刷新页面重新登录";
  return error?.message || "请求失败";
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
