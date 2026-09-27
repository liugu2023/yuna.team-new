// 样式自检：括号配平、var(--x) 是否都有定义、!important 只允许出现在 [hidden] 与 reduced-motion 里。
// 用法：node scripts/check-css.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "public", "styles");
// 由 public/yuna-ui.js 在运行时写入的变量
const JS_VARS = ["--x", "--y", "--i", "--indicator-x", "--indicator-w", "--progress", "--reveal-delay"];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".css")) files.push(full);
  }
})(root);

const issues = [];
const defined = new Set(JS_VARS);
const used = [];

for (const file of files) {
  const rel = path.relative(process.cwd(), file).replaceAll("\\", "/");
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  let braces = 0;
  let parens = 0;
  for (const ch of css) {
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "(") parens++;
    else if (ch === ")") parens--;
    if (braces < 0) break;
  }
  if (braces !== 0) issues.push(`${rel}: 花括号不配平（${braces}）`);
  if (parens !== 0) issues.push(`${rel}: 圆括号不配平（${parens}）`);

  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) used.push({ rel, name: m[1], fallback: Boolean(m[2]) });

  // !important：只允许 [hidden] 与 prefers-reduced-motion 块
  const lines = css.split("\n");
  let inReduced = false;
  let depth = 0;
  let reducedDepth = -1;
  lines.forEach((line, index) => {
    if (/@media[^{]*prefers-reduced-motion:\s*reduce/.test(line)) {
      inReduced = true;
      reducedDepth = depth;
    }
    if (line.includes("!important") && !inReduced && !/\[hidden\]/.test(line)) {
      issues.push(`${rel}:${index + 1}: 不允许的 !important：${line.trim()}`);
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (inReduced && depth === reducedDepth) inReduced = false;
      }
    }
  });
}

const missing = new Set(used.filter((u) => !defined.has(u.name) && !u.fallback).map((u) => `${u.rel}: 未定义的变量 ${u.name}`));
issues.push(...missing);

if (issues.length) {
  console.error(issues.join("\n"));
  console.error(`\n样式检查失败：${issues.length} 个问题。`);
  process.exit(1);
}
console.log(`样式检查通过（${files.length} 个文件）。`);
