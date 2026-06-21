// R2 孤儿媒体对账 / 清理。
//
//   node scripts/clean-orphan-media.mjs          # dry-run，只列清单
//   node scripts/clean-orphan-media.mjs --delete # 实际删除孤儿
//
// 需要环境变量：
//   PUBLIC_BASE_URL（或 SITE_URL） + ADMIN_SESSION_COOKIE
// 也可登录后用浏览器直接访问 GET /api/admin/media-orphans 看 dry-run 结果。

const baseUrl = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
const doDelete = process.argv.includes("--delete");

if (!baseUrl) {
  console.error("需要设置 PUBLIC_BASE_URL 或 SITE_URL。");
  process.exit(1);
}

const authHeaders = adminAuthHeaders();

const url = doDelete
  ? `${baseUrl}/api/admin/media-orphans?confirm=delete`
  : `${baseUrl}/api/admin/media-orphans`;

const response = await fetch(url, {
  method: doDelete ? "POST" : "GET",
  headers: authHeaders,
});
const data = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(`请求失败：${response.status}`, data.error || data);
  process.exit(1);
}

const { summary } = data;
console.log(doDelete ? "=== 已执行删除 ===" : "=== Dry-run（未删除任何对象）===");
console.log(`R2 对象总数      ${summary.totalObjects}`);
console.log(`被引用           ${summary.referenced}`);
console.log(`media 孤儿       ${summary.orphanMedia}`);
console.log(`旧 db/posts/*.md ${summary.legacyPostMd}`);
console.log(`快照(保留)       ${summary.snapshotsKept}`);
console.log(`未知前缀(保留)   ${summary.unknownKept}`);
console.log(`可回收空间       ${summary.reclaimableHuman}`);

if (!doDelete) {
  const candidates = [...data.orphanMedia, ...data.legacyPostMd];
  if (candidates.length) {
    console.log("\n待删除候选：");
    for (const entry of candidates) console.log(`  ${entry.key}  (${entry.size} B)`);
    console.log("\n确认无误后加 --delete 执行。");
  } else {
    console.log("\n没有发现孤儿对象。");
  }
} else {
  console.log(`\n已删除 ${data.deletedCount} 个对象。`);
}

if (data.unknown?.length) {
  console.log("\n⚠️ 未知前缀对象（未自动处理，请人工确认）：");
  for (const entry of data.unknown) console.log(`  ${entry.key}`);
}

function adminAuthHeaders() {
  const session = process.env.ADMIN_SESSION_COOKIE || "";
  if (session) return { cookie: session.includes("=") ? session : `yuna_session=${session}` };
  console.error("需要设置 ADMIN_SESSION_COOKIE。登录后台后复制 yuna_session Cookie 值即可。");
  process.exit(1);
}
