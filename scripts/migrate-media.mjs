import { open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const baseUrl = requiredEnv("SITE_BASE_URL").replace(/\/+$/, "");
const token = requiredEnv("MIGRATION_TOKEN");
const sourceRoot = process.env.SOURCE_ROOT || "../yuna.team/docs";
const directUploadLimit = 8 * 1024 * 1024;

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
    const mediaPath = ["activates", ...file.split(path.sep)];
    await uploadFile(mediaPath, absolutePath, contentType(file));
    console.log(`uploaded /media/${mediaPath.join("/")}`);
  }
}

async function uploadFile(mediaPath, absolutePath, type) {
  const fileStat = await stat(absolutePath);
  if (fileStat.size <= directUploadLimit) {
    await putBinary(mediaRoute(mediaPath), await readFile(absolutePath), type);
    return;
  }

  await putMultipart(mediaPath.join("/"), absolutePath, fileStat.size, type);
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

function uploadRoute(name) {
  return `${baseUrl}/api/admin/uploads/${name}`;
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

async function putMultipart(mediaPath, absolutePath, size, type) {
  const init = await postJson(uploadRoute("init"), {
    path: mediaPath,
    contentType: type,
    size,
  });
  const parts = [];
  const partSize = init.partSize || directUploadLimit;
  const file = await open(absolutePath, "r");

  try {
    for (let offset = 0, partNumber = 1; offset < size; offset += partSize, partNumber += 1) {
      const length = Math.min(partSize, size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      if (!bytesRead) break;

      const response = await fetch(
        `${uploadRoute("part")}?path=${encodeURIComponent(mediaPath)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": type,
          },
          body: buffer.subarray(0, bytesRead),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`multipart part ${partNumber} failed: ${response.status} ${JSON.stringify(data)}`);
      }
      parts.push(data);
      console.log(`uploaded part ${partNumber} ${Math.min(size, offset + bytesRead)}/${size}`);
    }

    await postJson(uploadRoute("complete"), {
      path: mediaPath,
      uploadId: init.uploadId,
      parts,
    });
  } catch (error) {
    await postJson(uploadRoute("abort"), {
      path: mediaPath,
      uploadId: init.uploadId,
    }).catch(() => {});
    throw error;
  } finally {
    await file.close();
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
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
