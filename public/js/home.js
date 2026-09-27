// 首页头图与公告卡片。依赖 core.js、markdown.js、page-editor.js（公告编辑复用页面编辑弹窗）。

const HOME_NOTICE_KEY = "homepage-notice";

const DEFAULT_HOME_NOTICE = {
  title: "协会公告",
  markdown: "招新答疑开放中，欢迎同学了解开发、安全、运维和组宣方向。",
};

async function renderHomeHero() {
  const hero = document.querySelector("[data-home-hero]");
  if (!hero) return;

  try {
    const data = await fetchSiteRecord("homepage-gallery");
    const items = JSON.parse(data.record.content || "[]");
    if (!Array.isArray(items) || !items.length) return;

    const active = items.find((item) => item.active) || items[0];
    // 走展示白名单并转义引号/反斜杠，避免 URL 打破 CSS url("...") 上下文。
    const background = safeDisplayAssetUrl(active?.url).replace(/\\/g, "%5C").replace(/"/g, "%22");
    if (!background) return;

    const target = hero.querySelector(".hero-bg") || hero;
    target.style.backgroundImage = `url("${background}")`;
    hero.classList.add("has-background");
  } catch {
    hero.classList.remove("has-background");
  }
}

async function renderHomeNotice() {
  const card = document.querySelector("[data-home-notice]");
  if (!card) return;

  const noticeState = { ...DEFAULT_HOME_NOTICE };
  try {
    const data = await fetchSiteRecord(HOME_NOTICE_KEY);
    if (data.record?.kind === "markdown") {
      noticeState.title = data.record.title || DEFAULT_HOME_NOTICE.title;
      noticeState.markdown = data.record.content || DEFAULT_HOME_NOTICE.markdown;
    }
  } catch {
    // Missing records are fine: the homepage keeps the built-in default notice.
  }

  renderHomeNoticeCard(card, noticeState);
  await attachHomeNoticeEditor(card, noticeState);
}

function renderHomeNoticeCard(card, noticeState) {
  const title = card.querySelector("[data-home-notice-title]");
  const content = card.querySelector("[data-home-notice-content]");
  if (title) title.textContent = noticeState.title || DEFAULT_HOME_NOTICE.title;
  if (content) content.innerHTML = markdownToHtml(noticeState.markdown || DEFAULT_HOME_NOTICE.markdown);
}

async function attachHomeNoticeEditor(card, noticeState) {
  let me;
  try {
    me = await currentUser();
  } catch {
    return;
  }
  if (!me.admin) return;

  const actions = card.querySelector("[data-home-notice-actions]");
  if (!actions) return;

  actions.hidden = false;
  actions.innerHTML = '<button type="button" class="btn secondary" data-edit-home-notice>编辑公告</button>';
  actions.querySelector("[data-edit-home-notice]").addEventListener("click", () => {
    openStaticPageEditor(
      {
        page: HOME_NOTICE_KEY,
        title: noticeState.title,
        markdown: noticeState.markdown,
        editorTitle: "编辑协会公告",
        editorHelper: "保存后会更新首页右侧公告。",
        uploadScope: `site/${HOME_NOTICE_KEY}`,
        save: ({ title, markdown }) => saveSiteMarkdownRecord(HOME_NOTICE_KEY, title, markdown),
      },
      (nextState) => {
        noticeState.title = nextState.title;
        noticeState.markdown = nextState.markdown;
        renderHomeNoticeCard(card, noticeState);
      },
    );
  });
}

Object.assign(window.blog, {
  renderHomeHero,
  renderHomeNotice,
});
