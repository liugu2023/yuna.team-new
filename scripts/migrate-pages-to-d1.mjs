import { execFileSync } from "node:child_process";

const baseUrl = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
const token = process.env.MIGRATION_TOKEN || "";
const sourceRef = process.env.CONTENT_SOURCE_REF || "HEAD^";

if (!baseUrl || !token) {
  console.error("需要设置 PUBLIC_BASE_URL 或 SITE_URL，以及 MIGRATION_TOKEN。");
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function listMarkdownFiles() {
  return git(["-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", sourceRef, "--", "public/content", "public/activates"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((file) => file.endsWith(".md"));
}

function readGitFile(path) {
  return git(["show", `${sourceRef}:${path}`]);
}

function pageKey(path) {
  if (path.startsWith("public/content/")) {
    return path.replace(/^public\/content\//, "").replace(/\.md$/i, "");
  }
  return `asset/${utf8Hex(path.replace(/^public\//, "").replace(/\.md$/i, ""))}`;
}

function firstHeading(markdown, fallback) {
  const match = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function pageApiPath(key) {
  return `${baseUrl}/api/pages/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function utf8Hex(value) {
  return Buffer.from(value, "utf8").toString("hex");
}

const files = listMarkdownFiles();
let imported = 0;

for (const file of files) {
  const content = readGitFile(file);
  const key = pageKey(file);
  const title = firstHeading(content, key.split("/").pop() || key);

  const response = await fetch(pageApiPath(key), {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ title, content }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(`${file}: ${data.error || `导入失败：${response.status}`}`);
    process.exit(1);
  }

  imported += 1;
  console.log(`imported ${key}`);
}

const defaultPages = [
  {
    key: "services/index",
    title: "相关服务",
    content: "# 相关服务\n\n这里用于放置协会相关服务入口。\n\n- 校园常用服务入口\n- 协会内部工具入口\n- 授课、活动、报名相关链接\n",
  },
  {
    key: "contact-us/index",
    title: "联系我们",
    content: "# 联系我们\n\n这里用于放置协会联系方式。\n\n- 招新咨询\n- 课程与活动咨询\n- 合作与反馈\n",
  },
];

for (const page of defaultPages) {
  const response = await fetch(pageApiPath(page.key), {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: page.title,
      content: page.content,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(`${page.key}: ${data.error || `导入失败：${response.status}`}`);
    process.exit(1);
  }

  imported += 1;
  console.log(`imported ${page.key}`);
}

console.log(JSON.stringify({ imported, sourceRef }, null, 2));
