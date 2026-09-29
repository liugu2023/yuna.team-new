// 发版前自检：tag 与 cli/package.json 的版本号必须一致，且 private 必须已移除。
// 本地可以随时跑：node scripts/check-cli-release.mjs cli-v0.1.0
// CI 里不传参数，从 GITHUB_REF_NAME 读 tag。
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkgPath = path.join(root, "cli", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const tag = (process.argv[2] || process.env.GITHUB_REF_NAME || "").trim();
const problems = [];

if (!tag) {
  problems.push("没有给 tag：本地跑请加参数（node scripts/check-cli-release.mjs cli-v0.1.0），CI 里应有 GITHUB_REF_NAME。");
} else if (tag !== `cli-v${pkg.version}`) {
  problems.push(`tag「${tag}」与 cli/package.json 的版本「${pkg.version}」不一致，应为「cli-v${pkg.version}」。`);
}

if (pkg.private === true) {
  problems.push('cli/package.json 里还有 "private": true，npm publish 会被拒绝——发布前删掉这一行。');
}

// 编译成单文件二进制后读不到 package.json，会退回 src/index.ts 里的兜底版本号，两边必须一致。
const indexPath = path.join(root, "cli", "src", "index.ts");
const fallback = readFileSync(indexPath, "utf8").match(/export const VERSION = "([^"]+)"/)?.[1];
if (!fallback) {
  problems.push("cli/src/index.ts 里找不到兜底版本号 VERSION。");
} else if (fallback !== pkg.version) {
  problems.push(`cli/src/index.ts 的兜底 VERSION「${fallback}」与 package.json 的「${pkg.version}」不一致。`);
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}

console.log(`✓ 可以发布：${pkg.name}@${pkg.version}（tag ${tag}）`);
console.log(`  下一步：cd cli && npm publish`);
