#!/usr/bin/env node
// yuna CLI 启动器：版本号优先读 cli/package.json（编译成单文件二进制后读不到就退回内置版本），
// 并把 --proxy 传给主程序（代理的启用在 src/net.ts 里做）。
import { readFile } from "node:fs/promises";

const ARGV = process.argv.slice(2);

function flagValue(name) {
  const index = ARGV.findIndex((value) => value === name || value.startsWith(`${name}=`));
  if (index === -1) return "";
  const value = ARGV[index];
  if (value.includes("=")) return value.slice(value.indexOf("=") + 1);
  const next = ARGV[index + 1];
  return next && !next.startsWith("-") ? next : "";
}

const { main } = await import("../dist/index.js");

let version;
try {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof pkg.version === "string") version = pkg.version;
} catch {
  version = undefined;
}

const proxy = flagValue("--proxy");
process.exitCode = await main(ARGV, version ? { version, proxy } : { proxy });
