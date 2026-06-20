import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const contentRoot = path.join(root, "public", "content");
const allowedDynamicPrefixes = ["/page.html", "/post.html", "/media/", "/api/", "/auth/"];
const issues = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function report(file, message) {
  issues.push(`${path.relative(root, file)}: ${message}`);
}

function checkLocalLink(file, href) {
  if (!href.startsWith("/") || allowedDynamicPrefixes.some((prefix) => href.startsWith(prefix))) {
    return;
  }

  const cleanHref = decodeURIComponent(href.split(/[?#]/, 1)[0]);
  const target = path.join(root, "public", ...cleanHref.split("/").filter(Boolean));
  if (!existsSync(target)) {
    report(file, `missing local asset: ${href}`);
  }
}

if (!existsSync(contentRoot)) {
  console.log("No repository Markdown content to check.");
  process.exit(0);
}

for (const file of await walk(contentRoot)) {
  const markdown = await readFile(file, "utf8");

  if (/<a\s/i.test(markdown)) report(file, "contains raw HTML anchor");
  if (/<具体|<其他/.test(markdown)) report(file, "contains placeholder text");
  if (/```mermaid/i.test(markdown)) report(file, "contains Mermaid block without renderer");

  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    checkLocalLink(file, match[1].trim());
  }
}

if (issues.length) {
  console.error(issues.join("\n"));
  process.exit(1);
}

console.log("Content links and markdown conventions look good.");
