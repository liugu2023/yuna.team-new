#!/usr/bin/env node
// yuna CLI 启动器。版本号优先读 cli/package.json；编译成单文件二进制后读不到就退回内置版本。
import { readFile } from "node:fs/promises";
import { main } from "../dist/index.js";

let version;
try {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof pkg.version === "string") version = pkg.version;
} catch {
  version = undefined;
}

process.exitCode = await main(process.argv.slice(2), version ? { version } : {});
