import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = requiredEnv("SITE_BASE_URL").replace(/\/+$/, "");
const token = requiredEnv("MIGRATION_TOKEN");
const sourceRoot = process.env.SOURCE_ROOT || "../yuna.team/docs";

await uploadActivates();

async function uploadActivates() {
  const activatesDir = path.resolve(sourceRoot, "public/activates");
  const files = await listFiles(activatesDir);
  if (!files.length) {
    console.log(`no lesson materials found in ${activatesDir}`);
    return;
  }

  for (const file of files) {
    const absolutePath = path.join(activatesDir, file);
    const body = await readFile(absolutePath);
    const mediaPath = ["activates", ...file.split(path.sep)];
    await putBinary(mediaRoute(mediaPath), body, contentType(file));
    console.log(`uploaded /media/${mediaPath.join("/")}`);
  }
}

async function listFiles(root, prefix = "") {
  const entries = await safeReaddir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

async function safeReaddir(dir, options) {
  try {
    return await readdir(dir, options);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function mediaRoute(parts) {
  return `/api/admin/media/${parts.map(encodeURIComponent).join("/")}`;
}

async function putBinary(route, body, type) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": type,
    },
    body,
  });
  if (response.ok) return;
  throw new Error(`${route} failed: ${response.status} ${await response.text()}`);
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
