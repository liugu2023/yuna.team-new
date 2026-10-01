import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseCli, UsageError } from "../dist/args.js";

const exec = promisify(execFile);
const entry = fileURLToPath(new URL("../bin/yuna.mjs", import.meta.url));
const mainUrl = new URL("../dist/index.js", import.meta.url).href;
const offlineEnv = {
  ...process.env,
  NO_COLOR: "1",
  YUNA_API_BASE: "this is deliberately not a URL",
  HTTP_PROXY: "not a proxy",
  HTTPS_PROXY: "not a proxy",
};

async function cli(args) {
  try {
    return { code: 0, ...await exec(process.execPath, [entry, ...args], {
      env: offlineEnv, windowsHide: true, timeout: 10000,
    }) };
  } catch (error) {
    return { code: error.code, stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}

test("play accepts its offline flags and rejects unrelated options", () => {
  const parsed = parseCli(["play", "packet", "--seed", "hello yuna", "--json"]);
  assert.deepEqual(parsed.positionals, ["play", "packet"]);
  assert.equal(parsed.flags.seed, "hello yuna");
  assert.equal(parsed.flags.json, true);
  assert.doesNotThrow(() => parseCli(["play", "--help"]));
  for (const args of [
    ["play"], ["play", "packet", "extra"],
    ["play", "packet", "--proxy", "http://localhost:7890"],
    ["play", "packet", "--base", "http://localhost:8788"],
    ["play", "packet", "--tag", "网络"], ["play", "packet", "--all"],
    ["posts", "--seed", "yuna"], ["join", "--demo"],
  ]) assert.throws(() => parseCli(args), UsageError, args.join(" "));
  assert.throws(() => parseCli(["play", "packet", "--demo"]), /未知参数「--demo」/);
});

test("help and JSON snapshots neither fetch nor initialize the supplied proxy", async () => {
  for (const args of [["play", "--help"], ["play", "packet", "--json"]]) {
    const script = `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      // Node 18.17 的 --eval 模块没有 import.meta.url，使用实际入口的文件 URL。
      const require = createRequire(${JSON.stringify(mainUrl)});
      let requests = 0;
      globalThis.fetch = async () => { requests++; throw new Error("unexpected network request"); };
      const { main } = await import(${JSON.stringify(mainUrl)});
      const code = await main(${JSON.stringify(args)}, { proxy: "invalid proxy: must not initialize" });
      assert.equal(code, 0);
      assert.equal(requests, 0);
      assert.equal(Object.keys(require.cache).some(key => /[\\\\/]undici[\\\\/]/.test(key)), false);
    `;
    const result = await exec(process.execPath, ["--input-type=module", "--eval", script], {
      env: offlineEnv, windowsHide: true, timeout: 10000,
    });
    assert.equal(result.stderr, "");
    if (args.includes("--json")) assert.equal(JSON.parse(result.stdout).status, "playing");
    else {
      assert.match(result.stdout, /离线/);
      assert.doesNotMatch(result.stdout, /--demo|自动演示/);
    }
  }
});

test("JSON snapshots are deterministic and contain the initial state and score breakdown", async () => {
  const initial = await cli(["play", "packet", "--seed", "  yuna  ", "--json"]);
  const repeated = await cli(["play", "packet", "--seed", "yuna", "--json"]);
  assert.equal(initial.code, 0, initial.stderr);
  assert.equal(repeated.code, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(initial.stdout), JSON.parse(repeated.stdout));
  const snapshot = JSON.parse(initial.stdout);
  assert.equal(snapshot.game, "packet");
  assert.equal(snapshot.seed, "yuna");
  assert.equal(snapshot.status, "playing");
  assert.equal(snapshot.moves, 0);
  assert.equal(snapshot.score, 0);
  assert.equal(snapshot.ttl, snapshot.maxTtl);
  assert.equal(snapshot.routersVisited, 0);
  assert.equal(snapshot.routersTotal, 2);
  assert.notDeepEqual(snapshot.position, snapshot.goal);
  assert.equal(snapshot.grid[snapshot.position.y][snapshot.position.x], "S");
  assert.equal(snapshot.grid[snapshot.goal.y][snapshot.goal.x], "G");
  assert.deepEqual(snapshot.scoreBreakdown, { routers: 0, cache: 0, delivery: 0, ttl: 0, retries: 0, total: 0 });
});

test("noninteractive play explains the terminal requirement and initial JSON snapshot", async () => {
  const ordinary = await cli(["play", "packet"]);
  assert.equal(ordinary.code, 1);
  assert.equal(ordinary.stdout, "");
  assert.match(ordinary.stderr, /真实交互终端.*--json.*初始地图/);
  assert.doesNotMatch(ordinary.stderr, /--demo|演示/);
});

test("the removed demo option is rejected before starting a game or producing a snapshot", async () => {
  for (const args of [["play", "packet", "--demo"], ["play", "packet", "--demo", "--json"]]) {
    const result = await cli(args);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /未知参数「--demo」/);
  }
});

test("unknown games and invalid seeds fail with usage guidance", async () => {
  for (const args of [
    ["play", "snake", "--json"], ["play", "packet", "--seed", "", "--json"],
    ["play", "packet", "--seed", "a".repeat(65), "--json"],
    ["play", "packet", "--seed", "bad\nseed", "--json"],
  ]) {
    const result = await cli(args);
    assert.equal(result.code, 1, args.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /数据包冒险|地图名字/);
    assert.doesNotMatch(result.stderr, /demo|演示/);
  }
});

test("help and JSON do not create local game records", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yuna-packet-json-"));
  try {
    for (const args of [["play", "--help"], ["play", "packet", "--json"]]) {
      await exec(process.execPath, [entry, ...args], {
        env: { ...offlineEnv, YUNA_CACHE_DIR: directory }, windowsHide: true, timeout: 10000,
      });
      assert.deepEqual(await readdir(directory), []);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("interactive play saves on delivery, waits on immediate quit and reloads the prior result", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yuna-packet-play-"));
  const playUrl = new URL("../dist/commands/play.js", import.meta.url).href;
  const engineUrl = new URL("../dist/games/packet-engine.js", import.meta.url).href;
  const recordsUrl = new URL("../dist/games/packet-records.js", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { PassThrough, Writable } from "node:stream";
    import { runPlay } from ${JSON.stringify(playUrl)};
    import { createGame, solveGame } from ${JSON.stringify(engineUrl)};
    import { loadPacketRecords } from ${JSON.stringify(recordsUrl)};
    const realInput = Object.getOwnPropertyDescriptor(process, "stdin");
    const realOutput = Object.getOwnPropertyDescriptor(process, "stdout");
    async function round(useHint) {
      const input = new PassThrough();
      input.isTTY = true;
      input.isRaw = false;
      input.setRawMode = value => { input.isRaw = value; };
      input.pause();
      const writes = [];
      const summaries = [];
      let sent = false;
      const output = new Writable({ write(chunk, encoding, callback) {
        const text = chunk.toString();
        writes.push(text);
        callback();
        if (!useHint && text.includes("成绩已保存")) queueMicrotask(() => input.write("q"));
        if (!sent && text.includes("PACKET RUN")) {
          sent = true;
          queueMicrotask(() => {
            if (useHint) input.write("tt");
            const keys = { up: "w", down: "s", left: "a", right: "d" };
            for (const direction of solveGame(createGame("yuna"))) input.write(keys[direction]);
            if (useHint) input.write("q");
          });
        }
      } });
      Object.assign(output, { isTTY: true, columns: 80, rows: 24 });
      Object.defineProperty(process, "stdin", { configurable: true, value: input });
      Object.defineProperty(process, "stdout", { configurable: true, value: output });
      try {
        await runPlay({ flags: { seed: "yuna" }, positionals: ["packet"], out: text => summaries.push(text) });
        assert.equal(input.isRaw, false);
        assert.equal(input.readableFlowing, false);
        assert.match(summaries.join(""), /投递成功/);
        assert.ok(summaries.join("").includes("提示 " + (useHint ? 1 : 0) + " 次"));
        const loaded = await loadPacketRecords();
        assert.equal(loaded.warning, undefined);
        assert.equal(loaded.records.get("yuna").last.hints, useHint ? 1 : 0);
        return writes.join("");
      } finally {
        Object.defineProperty(process, "stdin", realInput);
        Object.defineProperty(process, "stdout", realOutput);
        input.destroy(); output.destroy();
      }
    }
    await round(true);
    const repeated = await round(false);
    assert.match(repeated, /与本图上次通关相比/);
    assert.match(repeated, /新纪录/);
    assert.match(repeated, /成绩已保存/);
    const loaded = await loadPacketRecords();
    assert.equal(loaded.records.get("yuna").best.hints, 0);
  `;
  try {
    const result = await exec(process.execPath, ["--input-type=module", "--eval", script], {
      env: { ...offlineEnv, YUNA_CACHE_DIR: directory }, windowsHide: true, timeout: 15000,
    });
    assert.equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the CLI's global output handler lets the game restore input after an output failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yuna-packet-output-"));
  const script = `
    import assert from "node:assert/strict";
    import { PassThrough, Writable } from "node:stream";
    import { main } from ${JSON.stringify(mainUrl)};
    const inputDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
    const outputDescriptor = Object.getOwnPropertyDescriptor(process, "stdout");
    const input = new PassThrough();
    input.isTTY = true; input.isRaw = false;
    input.setRawMode = value => { input.isRaw = value; };
    input.pause();
    let fired = false;
    const output = new Writable({ write(chunk, encoding, callback) {
      callback();
      if (!fired && chunk.toString().includes("PACKET RUN")) {
        fired = true;
        queueMicrotask(() => output.emit("error", Object.assign(new Error("terminal disconnected"), { code: "EIO" })));
      }
    } });
    Object.assign(output, { isTTY: true, columns: 80, rows: 24 });
    Object.defineProperty(process, "stdin", { configurable: true, value: input });
    Object.defineProperty(process, "stdout", { configurable: true, value: output });
    try {
      const code = await main(["play", "packet", "--seed", "yuna"]);
      assert.equal(fired, true);
      assert.equal(code, 1);
      assert.equal(input.isRaw, false);
      assert.equal(input.readableFlowing, false);
      assert.equal(input.listenerCount("data"), 0);
    } finally {
      Object.defineProperty(process, "stdin", inputDescriptor);
      Object.defineProperty(process, "stdout", outputDescriptor);
      input.destroy(); output.destroy();
    }
  `;
  try {
    const result = await exec(process.execPath, ["--input-type=module", "--eval", script], {
      env: { ...offlineEnv, YUNA_CACHE_DIR: directory }, windowsHide: true, timeout: 10000,
    });
    assert.match(result.stderr, /terminal disconnected/);
    assert.equal(result.stdout, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
