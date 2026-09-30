// 发版前自检：tag、版本号、发布权限和实际 npm 包内容。
// 本地：node scripts/check-cli-release.mjs cli-v<版本号>
// 只检查包：node scripts/check-cli-release.mjs --package-only
// CI 里不传 tag 时，从 GITHUB_REF_NAME 读取。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkgPath = path.join(root, "cli", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const packageOnly = process.argv[2] === "--package-only";
const tag = (packageOnly ? "" : process.argv[2] || process.env.GITHUB_REF_NAME || "").trim();
const problems = [];

if (!packageOnly) {
  if (!tag) {
    problems.push(`没有给 tag：本地跑请加参数（node scripts/check-cli-release.mjs cli-v${pkg.version}），CI 里应有 GITHUB_REF_NAME。`);
  } else if (tag !== `cli-v${pkg.version}`) {
    problems.push(`tag「${tag}」与 cli/package.json 的版本「${pkg.version}」不一致，应为「cli-v${pkg.version}」。`);
  }
}

if (pkg.private === true) {
  problems.push('cli/package.json 里还有 "private": true，npm publish 会被拒绝——发布前删掉这一行。');
}

// npm Trusted Publisher 要求包的来源仓库与运行工作流的仓库一致。
const expectedRepository = process.env.GITHUB_REPOSITORY || "liugu2023/yuna.team-new";
const repositoryUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
const repository = String(repositoryUrl || "").replace(/^git\+/, "").replace(/\.git\/?$/, "").replace(/\/$/, "");
if (repository !== `https://github.com/${expectedRepository}`) {
  problems.push(`cli/package.json 的 repository.url 必须指向 https://github.com/${expectedRepository}.git，才能匹配 npm Trusted Publisher。`);
}

// 编译成单文件二进制后读不到 package.json，会退回 src/index.ts 里的兜底版本号，两边必须一致。
const indexPath = path.join(root, "cli", "src", "index.ts");
const fallback = readFileSync(indexPath, "utf8").match(/export const VERSION = "([^"]+)"/)?.[1];
if (!fallback) {
  problems.push("cli/src/index.ts 里找不到兜底版本号 VERSION。");
} else if (fallback !== pkg.version) {
  problems.push(`cli/src/index.ts 的兜底 VERSION「${fallback}」与 package.json 的「${pkg.version}」不一致。`);
}

const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
if (lock.packages?.cli?.version !== pkg.version) {
  problems.push("package-lock.json 中 CLI workspace 的版本与 cli/package.json 不一致。");
}

// 读取 npm 真正打包的清单，不依赖文件总数或 npm 的人类可读日志格式。
let fileCount = 0;
try {
  // Windows 的 npm.cmd 需要 cmd.exe；命令文本固定，不插入路径或外部输入。
  const executable = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd pack --dry-run --json --ignore-scripts"]
    : ["pack", "--dry-run", "--json", "--ignore-scripts"];
  const output = execFileSync(executable, args, {
    cwd: path.dirname(pkgPath),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const packs = JSON.parse(output);
  if (!Array.isArray(packs) || packs.length !== 1 || !Array.isArray(packs[0]?.files)) {
    throw new Error("npm pack 没有返回唯一包的文件清单。");
  }
  const packed = packs[0];
  if (packed.name !== pkg.name || packed.version !== pkg.version) {
    problems.push("npm pack 的包名或版本与 cli/package.json 不一致。");
  }
  const files = new Set(packed.files.map((file) => file.path.replaceAll("\\", "/")));
  fileCount = files.size;
  for (const required of ["package.json", "bin/yuna.mjs", "dist/index.js", "README.md", "LICENSE",
    "dist/commands/play.js", "dist/terminal-errors.js", "dist/games/packet-engine.js",
    "dist/games/packet-controller.js", "dist/games/packet-renderer.js", "dist/games/packet-records.js",
    "dist/games/packet-review.js", "dist/games/terminal-session.js"]) {
    if (!files.has(required)) problems.push(`npm 包缺少必要文件：${required}。请先运行 npm run cli:build。`);
  }
  for (const file of files) {
    if (/^(?:src|tests?|node_modules|\.git)\//.test(file) ||
        /(?:^|\/)(?:tsconfig[^/]*\.json|PUBLISHING\.md|(?:package-lock|npm-shrinkwrap)\.json|\.env(?:\.[^/]*)?)$/.test(file) ||
        /\.(?:test|spec)\.[cm]?js$/.test(file)) {
      problems.push(`npm 包包含不应发布的文件：${file}。`);
    }
  }
} catch (error) {
  problems.push(`无法检查 npm 包：${error instanceof Error ? error.message : String(error)}`);
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}

console.log(`✓ npm 包检查通过：${pkg.name}@${pkg.version}（${fileCount} 个文件）`);
if (!packageOnly) console.log(`✓ 发版检查通过：tag ${tag}`);
