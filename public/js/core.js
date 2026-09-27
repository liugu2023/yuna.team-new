// 前台公共底座：接口请求、站点记录批量读取、时间格式化、转义与安全链接、弹窗关闭。
// 所有页面第一个加载；本文件创建 window.blog，其余模块往上追加各自的对外接口。
// 这些文件都是普通 <script>（非 module），顶层声明共享全局作用域，
// 加载顺序与依赖由 scripts/check-scripts.mjs 按页面校验。

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json().catch(() => ({})) : {};
  const text = isJson ? "" : await response.text().catch(() => "");
  if (!response.ok) {
    throw httpError(data.error || readableHttpError(text) || `请求失败：${response.status}`, response.status);
  }
  if (!isJson) throw httpError(`接口返回了非 JSON 响应：${response.status}`, response.status);
  return data;
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isNotFoundError(error) {
  return error?.status === 404 || error?.message === "内容不存在";
}

function readableHttpError(text) {
  const clean = String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, 160) : "";
}

let currentUserPromise;

async function currentUser() {
  if (!currentUserPromise) {
    currentUserPromise = fetchJson("/api/auth/me").catch((error) => {
      currentUserPromise = null;
      throw error;
    });
  }
  return currentUserPromise;
}

// 站点文案读取带批处理：同一轮任务里发起的 key 合并成一次 /api/site?keys=… 请求，
// 避免每个可编辑块各打一次接口。行为与逐个请求一致：命中返回 { record }，缺失按 404 抛错。
const siteRecordPending = new Map();

let siteRecordFlushScheduled = false;

function fetchSiteRecord(key) {
  let entry = siteRecordPending.get(key);
  if (entry) return entry.promise;

  entry = {};
  entry.promise = new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
  });
  siteRecordPending.set(key, entry);

  if (!siteRecordFlushScheduled) {
    siteRecordFlushScheduled = true;
    setTimeout(flushSiteRecordBatch, 0);
  }
  return entry.promise;
}

async function flushSiteRecordBatch() {
  siteRecordFlushScheduled = false;
  const batch = new Map(siteRecordPending);
  siteRecordPending.clear();
  if (!batch.size) return;

  const keys = Array.from(batch.keys());
  try {
    const data = await fetchJson(`/api/site?keys=${encodeURIComponent(keys.join(","))}`);
    for (const [key, entry] of batch) {
      const record = data.records?.[key];
      if (record) {
        entry.resolve({ record });
      } else {
        entry.reject(httpError("内容不存在", 404));
      }
    }
  } catch (error) {
    for (const entry of batch.values()) entry.reject(error);
  }
}

function formatDate(value) {
  if (!value) return "未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间无效";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

// 面向访客的日期只到“天”，具体时刻留给后台展示。
function formatDay(value) {
  if (!value) return "未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间无效";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function viewCount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function formatViews(value) {
  return `${viewCount(value).toLocaleString("zh-CN")} 次阅读`;
}

function timestampValue(value) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

// 只允许安全协议的链接，阻断 javascript:/data: 等点击型 XSS。
// 后台填入的成员/名人堂联系方式会经过这里再渲染。
function safeLinkUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") || raw.startsWith("#")) return raw;
  if (/^(https?:|mailto:)/i.test(raw)) return raw;
  return "";
}

function isQQContactLabel(label) {
  return String(label || "").trim().toLowerCase() === "qq";
}

function qqContactUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = raw.match(/^\d+$/);
  if (direct) return `https://wpa.qq.com/msgrd?v=3&uin=${direct[0]}&site=qq&menu=yes`;

  const oldQm = raw.match(/^https?:\/\/qm\.qq\.com\/q\/(\d+)\/?$/i);
  if (oldQm) return `https://wpa.qq.com/msgrd?v=3&uin=${oldQm[1]}&site=qq&menu=yes`;

  const uin = raw.match(/[?&]uin=(\d+)/i);
  if (uin) return `https://wpa.qq.com/msgrd?v=3&uin=${uin[1]}&site=qq&menu=yes`;

  return raw;
}

function safeContactLinkUrl(link) {
  const label = link?.label || "";
  const raw = link?.url || "";
  return safeLinkUrl(isQQContactLabel(label) ? qqContactUrl(raw) : raw);
}

// 弹窗通用关闭行为：Esc、点击遮罩。返回清理函数，close 时调用避免监听残留。
function setupModalDismiss(modal, close) {
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };
  modal.onclick = (event) => {
    if (event.target === modal) close();
  };
  document.addEventListener("keydown", onKeydown);
  return () => {
    modal.onclick = null;
    document.removeEventListener("keydown", onKeydown);
  };
}

function saveSiteMarkdownRecord(key, title, markdown) {
  return fetchJson(`/api/admin/site/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      kind: "markdown",
      content: markdown,
    }),
  });
}

function saveSiteJsonRecord(key, title, content) {
  return fetchJson(`/api/admin/site/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      kind: "json",
      content: JSON.stringify(content),
    }),
  });
}

window.blog = {
  fetchJson,
  fetchSiteRecord,
  formatDate,
  formatDay,
  formatViews,
  escapeHtml,
};
