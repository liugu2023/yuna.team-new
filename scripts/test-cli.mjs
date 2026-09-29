// 显式列举文件，让 Windows 与最低支持的 Node 18 使用相同的测试集合。
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "cli", "test");
const files = readdirSync(directory).filter((name) => name.endsWith(".test.mjs")).sort();
if (!files.length) throw new Error("没有找到 CLI 回归测试。");
const result = spawnSync(process.execPath, ["--test", ...files.map((name) => path.join(directory, name))], {
  cwd: root, stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
