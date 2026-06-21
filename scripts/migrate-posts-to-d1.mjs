const baseUrl = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");

if (!baseUrl) {
  console.error("需要设置 PUBLIC_BASE_URL 或 SITE_URL。");
  process.exit(1);
}

const authHeaders = adminAuthHeaders();

const response = await fetch(`${baseUrl}/api/admin/migrate-posts`, {
  method: "POST",
  headers: authHeaders,
});
const data = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(data.error || `迁移失败：${response.status}`);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));

function adminAuthHeaders() {
  const session = process.env.ADMIN_SESSION_COOKIE || "";
  if (session) return { cookie: session.includes("=") ? session : `yuna_session=${session}` };
  console.error("需要设置 ADMIN_SESSION_COOKIE。登录后台后复制 yuna_session Cookie 值即可。");
  process.exit(1);
}
