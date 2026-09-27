// 后台入口：控件事件绑定与启动。必须最后加载。

async function bootAdmin() {
  await refreshAdminData();
  updatePreview();
  updateContactPlaceholder(fields.memberContactLabel, fields.memberContactUrl);
  updateContactPlaceholder(fields.fameContactLabel, fields.fameContactUrl);
  markEditorClean();

  const slug = new URLSearchParams(location.search).get("slug");
  if (slug) {
    try {
      await loadPost(slug);
      openEditor();
    } catch (error) {
      // 错误要落在页面可见处；编辑器还没打开，fields.message 在隐藏的弹窗里看不见。
      fields.postListMessage.textContent = `打开文章「${slug}」失败：${adminErrorText(error)}`;
      updateEditorUrl("", state.editingKind);
    }
  }
}

async function refreshAdminData() {
  const tasks = [
    ["文章与知识库", refreshPosts],
    ["协会成员", loadMembers],
    ["名人堂", loadFame],
  ];
  const results = await Promise.allSettled(tasks.map(([, task]) => task()));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`${tasks[index][0]}加载失败`, result.reason);
    }
  });
}

bind("[data-publish]", "click", () => savePost("published"));
bind("[data-save-draft]", "click", () => savePost("draft"));
bind("[data-editor-close]", "click", () => closeEditor());
bindElement(editorModal, "click", (event) => {
  if (event.target === editorModal) closeEditor();
}, "data-editor-modal");
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && editorModal && !editorModal.hidden) closeEditor();
  if (event.key === "Escape" && fields.importModal && !fields.importModal.hidden) closeImportModal();
});
// 编辑器开着且有未保存修改时，拦一下刷新/关标签/后退，避免整篇稿子无声丢失。
window.addEventListener("beforeunload", (event) => {
  if (editorModal && !editorModal.hidden && isEditorDirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
bindElement(fields.markdown, "keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  insertRawAtCursor(fields.markdown, "  ");
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
bind("[data-upload-cover]", "click", uploadCoverImage);
bind("[data-upload-author-avatar]", "click", uploadAuthorAvatar);
bind("[data-use-github-avatar]", "click", useGithubAvatar);
bind("[data-add-coauthor]", "click", () => addCoauthor());
bindElement(fields.coauthorsList, "input", updatePreview, "data-coauthors-list");
bindElement(fields.coauthorsList, "click", (event) => {
  const githubButton = event.target.closest("[data-use-coauthor-github]");
  if (githubButton) {
    useCoauthorGithubAvatar(githubButton.closest("[data-coauthor-row]"));
    return;
  }
  const button = event.target.closest("[data-remove-coauthor]");
  if (!button) return;
  button.closest("[data-coauthor-row]")?.remove();
  if (!fields.coauthorsList.querySelector("[data-coauthor-row]")) renderCoauthors();
  updatePreview();
}, "data-coauthors-list");
bind("[data-upload-post-file]", "click", uploadPostFiles);
bindElement(fields.memberImageFile, "change", uploadMemberAvatar, "data-member-image-file");
bindElement(fields.fameImageFile, "change", uploadFameAvatar, "data-fame-image-file");
bind("[data-save-member-entry]", "click", saveMemberEntry);
bind("[data-save-fame-entry]", "click", saveFameEntry);
// 两个导出按钮（默认导出 / 含历史导出）都要给出反馈。
document.querySelectorAll("[data-export-db]").forEach((element) => {
  element.addEventListener("click", exportDatabase);
});
bind("[data-import-db]", "click", openImportModal);
bind("[data-import-confirm]", "click", importDatabase);
bind("[data-import-close]", "click", closeImportModal);
bind("[data-import-cancel]", "click", closeImportModal);
bindElement(fields.importModal, "click", (event) => {
  if (event.target === fields.importModal) closeImportModal();
}, "data-import-modal");
bind("[data-sync-markdown]", "click", syncMarkdownBackup);
bind("[data-refresh-usage]", "click", loadUsage);
bind("[data-scan-orphans]", "click", scanOrphans);
bind("[data-delete-orphans]", "click", deleteOrphans);
bindElement(fields.memberList, "click", handleFixedListClick, "data-member-list");
bindElement(fields.fameList, "click", handleFixedListClick, "data-fame-list");
bindElement(fields.memberContactLabel, "change", () => updateContactPlaceholder(fields.memberContactLabel, fields.memberContactUrl), "data-member-contact-label");
bindElement(fields.fameContactLabel, "change", () => updateContactPlaceholder(fields.fameContactLabel, fields.fameContactUrl), "data-fame-contact-label");
bind("[data-new]", "click", () => {
  resetEditor("article");
  openEditor();
});
bindElement(fields.search, "input", () => {
  state.articlePage = 1;
  renderAdminPostList();
}, "data-search");
bindElement(fields.filterStatus, "change", () => {
  state.articlePage = 1;
  renderAdminPostList();
}, "data-filter-status");
bindElement(fields.title, "input", updatePreview, "data-title");
bindElement(fields.tag, "input", updatePreview, "data-post-tag");
bindElement(fields.authorName, "input", updatePreview, "data-author-name");
bindElement(fields.authorUrl, "input", updatePreview, "data-author-url");
bindElement(fields.authorAvatar, "input", () => {
  fields.authorGithub.value = githubUsernameFromAuthor({ author_avatar: fields.authorAvatar.value });
  updatePreview();
}, "data-author-avatar");
bindElement(fields.excerpt, "input", updatePreview, "data-excerpt");
bindElement(fields.coverUrl, "input", updatePreview, "data-cover-url");
bindElement(fields.markdown, "input", updatePreview, "data-markdown");
bootAdmin().catch((error) => {
  console.error("后台初始化失败", error);
  // fields.message 在隐藏的编辑器弹窗里，初始化错误必须写到页面可见的列表消息栏。
  if (fields.postListMessage) {
    fields.postListMessage.textContent = `后台初始化失败：${adminErrorText(error)}`;
  }
});
