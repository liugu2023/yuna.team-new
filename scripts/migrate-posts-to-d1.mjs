const baseUrl = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
const token = process.env.MIGRATION_TOKEN || "";

if (!baseUrl || !token) {
  console.error("需要设置 PUBLIC_BASE_URL 或 SITE_URL，以及 MIGRATION_TOKEN。");
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/admin/migrate-posts`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
});
const data = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(data.error || `迁移失败：${response.status}`);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
