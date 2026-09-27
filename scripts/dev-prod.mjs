// 本地前端 + 线上数据（只读）预览服务。
// 页面、样式、脚本读本地 public/，/api、/media、/sitemap.xml 转发到线上站点，
// 只放行 GET / HEAD，任何写请求在本地直接拒绝，不会改动线上数据。
// 不转发 Cookie，所以线上登录态不会被带过去，后台接口会返回 401，属预期。
//
// 用法：npm run dev:prod            （默认 http://127.0.0.1:8790，数据源 https://www.yuna.team）
//       PORT=8791 PROD_ORIGIN=https://yuna-team-new.pages.dev npm run dev:prod
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.PORT || 8790);
const PROD_ORIGIN = (process.env.PROD_ORIGIN || "https://www.yuna.team").replace(/\/+$/, "");
const ROOT = path.resolve("public");
const PROXY_PREFIXES = ["/api/", "/media/", "/sitemap.xml"];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

async function proxy(req, res, url) {
  const upstream = await fetch(PROD_ORIGIN + url.pathname + url.search, {
    method: req.method,
    headers: { accept: req.headers.accept || "*/*", "user-agent": "yuna-dev-prod-preview" },
    redirect: "manual",
  });
  const headers = {};
  for (const name of ["content-type", "content-length", "location", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  headers["cache-control"] = "no-store";
  res.writeHead(upstream.status, headers);
  if (req.method === "HEAD") return res.end();
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

// 与 Cloudflare Pages 一致：/foo 依次尝试 /foo、/foo.html、/foo/index.html
async function resolveStatic(pathname) {
  const clean = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const base = path.join(ROOT, clean);
  if (!base.startsWith(ROOT)) return null;
  for (const candidate of [base, `${base}.html`, path.join(base, "index.html")]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, JSON.stringify({ error: "只读预览：已拦截写请求，不会发送到线上" }), TYPES[".json"]);
    }
    if (PROXY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
      return await proxy(req, res, url);
    }
    const file = await resolveStatic(url.pathname);
    if (!file) return send(res, 404, "Not found");
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") return res.end();
    res.end(await readFile(file));
  } catch (error) {
    send(res, 502, `预览服务出错：${error.message}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`只读预览：http://127.0.0.1:${PORT}  （数据来自 ${PROD_ORIGIN}，写请求一律拦截）`);
});
