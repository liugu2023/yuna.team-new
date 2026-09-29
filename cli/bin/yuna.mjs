#!/usr/bin/env node
// yuna CLI 启动器：版本号优先读 cli/package.json（编译成单文件二进制后读不到就退回内置版本），
// 参数与代理统一由主程序解析。
//
// 这里刻意不用顶层 await：bun build --minify / 其它打包器对入口的顶层 await 支持不一，
// 用 async 函数 + catch 更稳。
import { readFile } from "node:fs/promises";

const ARGV = process.argv.slice(2);

async function run() {
  const { main } = await import("../dist/index.js");

  let version;
  try {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    if (typeof pkg.version === "string") version = pkg.version;
  } catch {
    version = undefined;
  }

  process.exitCode = await main(ARGV, version ? { version } : {});
}

run().catch((error) => {
  process.stderr.write(`✗ 启动失败：${error?.message ?? error}\n`);
  process.exitCode = 1;
});
