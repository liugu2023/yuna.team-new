// 站点维护：数据库导出/导入、Markdown 备份同步、D1/R2 用量与孤儿媒体清理。
// 导入成功后调用 main.js 的 refreshAdminData 重新拉取全部数据。

// 导出走 fetch + blob 下载：直接 <a href> 在会话过期时会把整个后台导航到 401 JSON，
// 且无法反馈失败原因；这里拦截点击，成功才触发下载。
let exportingDatabase = false;

async function exportDatabase(event) {
  const link = event.target instanceof Element ? event.target.closest("a[data-export-db]") : null;
  const href = link?.getAttribute("href");
  if (!href) return;
  event.preventDefault();
  if (exportingDatabase) return;
  exportingDatabase = true;

  fields.exportMessage.textContent = "正在导出...";
  try {
    const response = await fetch(href);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `请求失败：${response.status}`);
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1]
      || `yuna-blog-db-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    fields.exportMessage.textContent = `导出完成：${filename}`;
  } catch (error) {
    fields.exportMessage.textContent = `导出失败：${adminErrorText(error)}`;
  } finally {
    exportingDatabase = false;
  }
}

function openImportModal() {
  fields.importMessage.textContent = "";
  fields.importModalMessage.textContent = "";
  fields.importFile.value = "";
  fields.importModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeImportModal() {
  fields.importModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function setImportMessage(message) {
  fields.importMessage.textContent = message;
  fields.importModalMessage.textContent = message;
}

async function importDatabase() {
  await withLockedButtons("[data-import-confirm]", async () => {
    const file = fields.importFile.files?.[0];
    if (!file) {
      setImportMessage("请选择要导入的 JSON 文件。");
      return;
    }

    setImportMessage("正在导入...");
    try {
      const payload = JSON.parse(await file.text());
      const data = await window.blog.fetchJson("/api/admin/import?mode=replace-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const snapshotNote = data.snapshotKey ? `导入前已备份至 ${data.snapshotKey}。` : "";
      setImportMessage(`导入完成：文章 ${data.counts.posts}，页面 ${data.counts.siteRecords}，备份 ${data.counts.siteRecordBackups}。${snapshotNote}`);
      fields.importFile.value = "";
      await refreshAdminData();
      closeImportModal();
    } catch (error) {
      setImportMessage(error.message);
    }
  });
}

async function syncMarkdownBackup() {
  await withLockedButtons("[data-sync-markdown]", async () => {
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
  });
}

async function loadUsage() {
  fields.usageMessage.textContent = "正在检测 D1 与 R2 用量...";
  try {
    const data = await window.blog.fetchJson("/api/admin/usage");
    renderUsage(data);
    fields.usageMessage.textContent = `检测完成：${window.blog.formatDate(data.checkedAt)}${data.bucket.truncated ? "。R2 对象较多，本次只统计了前 100000 个对象。" : ""}`;
  } catch (error) {
    fields.usageMessage.textContent = error.message;
  }
}

function renderUsage(data) {
  const database = data.database || {};
  const bucket = data.bucket || {};
  const dbSize = database.sqliteHuman || database.estimatedContentHuman || "0 B";
  const dbLabel = database.sqliteHuman ? "D1 已用空间" : "D1 内容估算";
  const tableRows = Array.isArray(database.tables)
    ? database.tables.reduce((sum, table) => sum + Number(table.rows || 0), 0)
    : 0;
  const tableList = Array.isArray(database.tables) ? database.tables : [];
  const prefixList = Array.isArray(bucket.prefixes) ? bucket.prefixes : [];

  fields.usageSummary.innerHTML = `
    <div class="usage-kpis">
      <div><strong>${window.blog.escapeHtml(dbSize)}</strong><span>${dbLabel}</span></div>
      <div><strong>${tableRows.toLocaleString("zh-CN")}</strong><span>D1 总记录</span></div>
      <div><strong>${window.blog.escapeHtml(bucket.human || "0 B")}</strong><span>R2 已用空间</span></div>
      <div><strong>${Number(bucket.objects || 0).toLocaleString("zh-CN")}</strong><span>R2 对象</span></div>
    </div>
    <div class="usage-detail">
      <div>
        <h4>D1 表</h4>
        ${tableList.map((table) => `
          <p><span>${window.blog.escapeHtml(table.label || table.name)}</span><strong>${Number(table.rows || 0).toLocaleString("zh-CN")} 条 · ${formatAdminBytes(table.estimatedBytes)}</strong></p>
        `).join("") || '<p><span>暂无数据</span><strong>0 条</strong></p>'}
      </div>
      <div>
        <h4>R2 前缀</h4>
        ${prefixList.map((item) => `
          <p><span>${window.blog.escapeHtml(item.prefix)}</span><strong>${Number(item.objects || 0).toLocaleString("zh-CN")} 个 · ${formatAdminBytes(item.bytes)}</strong></p>
        `).join("") || '<p><span>暂无对象</span><strong>0 B</strong></p>'}
      </div>
    </div>
    <p class="meta">${window.blog.escapeHtml(database.note || "")}</p>
  `;
}

function formatAdminBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unit]}`;
}

async function scanOrphans() {
  fields.orphanMessage.textContent = "正在检测 R2 引用情况...";
  try {
    const data = await window.blog.fetchJson("/api/admin/media-orphans");
    renderOrphans(data);
    fields.orphanMessage.textContent = "检测完成，未执行删除。";
  } catch (error) {
    fields.orphanMessage.textContent = error.message;
  }
}

async function deleteOrphans() {
  const ok = confirm("将重新检测并删除未被数据库引用的 media/ 文件，以及旧的 db/posts/*.md 残留。db-snapshots/ 和未知前缀不会删除。确定继续吗？");
  if (!ok) return;

  fields.orphanMessage.textContent = "正在检测并删除可清理对象...";
  try {
    const data = await window.blog.fetchJson("/api/admin/media-orphans?confirm=delete", {
      method: "POST",
    });
    renderOrphans(data);
    fields.orphanMessage.textContent = `已删除 ${Number(data.deletedCount || 0).toLocaleString("zh-CN")} 个对象，释放约 ${window.blog.escapeHtml(data.summary?.reclaimableHuman || "0 B")}。`;
    await loadUsage();
  } catch (error) {
    fields.orphanMessage.textContent = error.message;
  }
}

function renderOrphans(data) {
  const summary = data.summary || {};
  const orphanMedia = Array.isArray(data.orphanMedia) ? data.orphanMedia : [];
  const legacyPostMd = Array.isArray(data.legacyPostMd) ? data.legacyPostMd : [];
  const unknown = Array.isArray(data.unknown) ? data.unknown : [];
  const reclaimableCount = Number(summary.orphanMedia || 0) + Number(summary.legacyPostMd || 0);

  fields.orphanSummary.innerHTML = `
    <div class="usage-kpis">
      <div><strong>${Number(summary.totalObjects || 0).toLocaleString("zh-CN")}</strong><span>R2 对象总数</span></div>
      <div><strong>${Number(summary.referenced || 0).toLocaleString("zh-CN")}</strong><span>已被引用</span></div>
      <div><strong>${reclaimableCount.toLocaleString("zh-CN")}</strong><span>可清理对象</span></div>
      <div><strong>${window.blog.escapeHtml(summary.reclaimableHuman || "0 B")}</strong><span>预计释放</span></div>
    </div>
    <div class="usage-detail">
      <div>
        <h4>可删除</h4>
        <p><span>孤儿媒体</span><strong>${Number(summary.orphanMedia || 0).toLocaleString("zh-CN")} 个</strong></p>
        <p><span>旧文章 Markdown</span><strong>${Number(summary.legacyPostMd || 0).toLocaleString("zh-CN")} 个</strong></p>
        <p><span>保留快照</span><strong>${Number(summary.snapshotsKept || 0).toLocaleString("zh-CN")} 个</strong></p>
        <p><span>未知前缀保留</span><strong>${Number(summary.unknownKept || 0).toLocaleString("zh-CN")} 个</strong></p>
      </div>
      <div>
        <h4>对象示例</h4>
        ${renderObjectSamples([...orphanMedia, ...legacyPostMd], "暂无可清理对象。")}
      </div>
    </div>
    ${unknown.length ? `<p class="meta">未知前缀对象不会自动删除：${window.blog.escapeHtml(unknown.slice(0, 3).map((item) => item.key).join("，"))}${unknown.length > 3 ? " 等" : ""}</p>` : ""}
  `;
}

function renderObjectSamples(items, emptyText) {
  if (!items.length) return `<p><span>${emptyText}</span><strong>0 B</strong></p>`;
  return items.slice(0, 6).map((item) => `
    <p><span>${window.blog.escapeHtml(item.key)}</span><strong>${formatAdminBytes(item.size)}</strong></p>
  `).join("");
}
