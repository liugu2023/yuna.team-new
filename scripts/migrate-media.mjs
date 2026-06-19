import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = requiredEnv("SITE_BASE_URL").replace(/\/+$/, "");
const token = requiredEnv("MIGRATION_TOKEN");
const sourceRoot = process.env.SOURCE_ROOT || "../yuna.team/docs";

await uploadAvatars();

async function uploadAvatars() {
  const avatarDir = path.resolve(sourceRoot, "public/avatars");
  const files = await readdir(avatarDir);

  for (const file of files) {
    const absolutePath = path.join(avatarDir, file);
    const body = await readFile(absolutePath);
    await putBinary(`/api/admin/media/avatars/${encodeURIComponent(file)}`, body, contentType(file));
    console.log(`uploaded /media/avatars/${file}`);
  }
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
  return "application/octet-stream";
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
