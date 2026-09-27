// Markdown 页面编辑弹窗：标题 + 正文 + 图片上传（粘贴/拖拽/选择），保存到 /api/pages 或调用方传入的 save。
// 固定页面、部门页、首页公告共用。依赖 core.js、markdown.js、uploads.js。

function openStaticPageEditor(pageState, onSaved) {
  const modal = ensureStaticPageEditorModal();
  const heading = modal.querySelector("[data-page-editor-heading]");
  const helper = modal.querySelector("[data-page-editor-helper]");
  const titleInput = modal.querySelector("[data-page-editor-title]");
  const markdownInput = modal.querySelector("[data-page-editor-markdown]");
  const message = modal.querySelector("[data-page-editor-message]");

  if (heading) heading.textContent = pageState.editorTitle || "编辑页面";
  if (helper) helper.textContent = pageState.editorHelper || "保存后写入 D1 数据库。";
  titleInput.value = pageState.title || firstHeading(pageState.markdown) || "";
  markdownInput.value = pageState.markdown || "";
  message.textContent = "";
  modal.hidden = false;
  document.body.classList.add("modal-open");
  markdownInput.focus();

  let teardownDismiss = () => {};
  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    teardownDismiss();
  };
  teardownDismiss = setupModalDismiss(modal, close);

  modal.querySelector("[data-page-editor-close]").onclick = close;
  const pageSaveButton = modal.querySelector("[data-page-editor-save]");
  pageSaveButton.onclick = async () => {
    if (pageSaveButton.disabled) return;
    const markdown = markdownInput.value;
    const title = titleInput.value.trim() || firstHeading(markdown) || "页面";
    message.textContent = "正在保存...";
    pageSaveButton.disabled = true;

    try {
      if (pageState.save) {
        await pageState.save({ title, markdown });
      } else {
        await fetchJson(pageApiPath(pageState.page), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            content: markdown,
          }),
        });
      }
      message.textContent = "已保存";
      onSaved({ title, markdown });
      close();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      pageSaveButton.disabled = false;
    }
  };

  modal.querySelector("[data-page-editor-upload]").onclick = async () => {
    const fileInput = modal.querySelector("[data-page-editor-image]");
    const file = fileInput.files?.[0];
    if (!file) {
      message.textContent = "请选择图片";
      return;
    }
    try {
      await insertStaticPageImage(pageState.uploadScope || pageState.page, markdownInput, file, message);
      fileInput.value = "";
    } catch (error) {
      message.textContent = error.message;
    }
  };

  markdownInput.onpaste = async (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    try {
      for (const file of files) {
        await insertStaticPageImage(pageState.uploadScope || pageState.page, markdownInput, file, message);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  };

  markdownInput.ondragover = (event) => {
    event.preventDefault();
    markdownInput.classList.add("is-dragover");
  };
  markdownInput.ondragleave = () => markdownInput.classList.remove("is-dragover");
  markdownInput.ondrop = async (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    markdownInput.classList.remove("is-dragover");
    try {
      for (const file of files) {
        await insertStaticPageImage(pageState.uploadScope || pageState.page, markdownInput, file, message);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  };
}

function ensureStaticPageEditorModal() {
  let modal = document.querySelector("[data-page-editor-modal]");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.dataset.pageEditorModal = "";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="页面编辑器">
      <div class="modal-head">
        <div>
          <h2 data-page-editor-heading>编辑页面</h2>
          <p class="meta" data-page-editor-helper>保存后写入 D1 数据库。</p>
        </div>
        <button type="button" class="icon-button" data-page-editor-close aria-label="关闭编辑器">×</button>
      </div>
      <div class="modal-body">
        <section class="editor-shell admin-form">
          <label>
            标题
            <input class="admin-input" data-page-editor-title placeholder="页面标题" />
          </label>
          <label>
            Markdown 内容（可粘贴或拖拽图片）
            <textarea class="admin-input" data-page-editor-markdown placeholder="# 页面标题"></textarea>
          </label>
          <div class="inline-uploader">
            <label>
              图片
              <input class="admin-input" data-page-editor-image type="file" accept="image/*" />
            </label>
            <button type="button" class="btn secondary" data-page-editor-upload>上传</button>
          </div>
          <div class="editor-actions">
            <button type="button" class="btn primary" data-page-editor-save>保存页面</button>
          </div>
          <p class="meta" aria-live="polite" data-page-editor-message></p>
        </section>
      </div>
    </div>
  `;
  document.body.append(modal);
  return modal;
}

async function insertStaticPageImage(page, textarea, file, message) {
  message.textContent = "正在上传图片...";
  const filename = uploadFilename(file.name);
  const mediaPath = `pages/${page}/${Date.now()}-${filename}`;
  const data = await uploadContentMedia(file, mediaPath, (loaded, total) => {
    message.textContent = `正在上传图片... ${uploadPercent(loaded, total)}`;
  });

  insertAtCursor(textarea, `![${filename}](${data.url})`);
  message.textContent = "图片已上传";
}

function uploadContentMedia(file, path, onProgress) {
  return uploadMediaViaApi("/api/content", file, path, onProgress);
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || start;
  const prefix = textarea.value.slice(0, start);
  const suffix = textarea.value.slice(end);
  const needsLeadingBreak = prefix && !prefix.endsWith("\n") ? "\n" : "";
  const insert = `${needsLeadingBreak}${text}\n`;
  textarea.value = `${prefix}${insert}${suffix}`;
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + insert.length;
}

function uploadFilename(name) {
  // ()[] 会破坏 Markdown 链接语法和孤儿检测的 URL 提取，与非法字符一并替换。
  const fallback = "image.png";
  return (name || fallback)
    .replace(/[\\/:*?"<>|#%&{}$!`'@+=()[\]]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96) || fallback;
}

function pageApiPath(page) {
  return `/api/pages/${page.split("/").map(encodeURIComponent).join("/")}`;
}
