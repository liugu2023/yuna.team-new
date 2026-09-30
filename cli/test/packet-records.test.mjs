import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PACKET_RULESET } from "../dist/games/packet-engine.js";
import { isBetterPacketResult, loadPacketRecords, savePacketResult, savePacketResultOutcome } from "../dist/games/packet-records.js";

const exec = promisify(execFile);
const record = (score = 600, moves = 40, hints = 0) => ({ score, moves, hints });
const recordsUrl = new URL("../dist/games/packet-records.js", import.meta.url).href;
const target = cache => path.join(cache, "games", PACKET_RULESET, "records.json");
const document = entries => JSON.stringify({ version: 1, ruleset: PACKET_RULESET, entries });

async function cacheDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "yuna-packet-records-"));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), "yuna-packet-records-")));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("a first read does not create directories, and saved results survive a fresh process", async t => {
  const root = await cacheDirectory(t);
  const cache = path.join(root, "cache");
  const empty = await loadPacketRecords(cache);
  assert.equal(empty.records.size, 0);
  assert.equal(empty.warning, undefined);
  await assert.rejects(access(cache), { code: "ENOENT" });
  assert.equal(await savePacketResult("yuna", record(), cache), true);
  const source = `import { loadPacketRecords } from ${JSON.stringify(recordsUrl)}; const loaded = await loadPacketRecords(); process.stdout.write(JSON.stringify([...loaded.records]));`;
  const child = await exec(process.execPath, ["--input-type=module", "--eval", source], {
    env: { ...process.env, YUNA_CACHE_DIR: cache }, windowsHide: true, timeout: 10000,
  });
  assert.deepEqual(JSON.parse(child.stdout), [["yuna", { best: record(), last: record() }]]);
  assert.deepEqual(await readdir(path.dirname(target(cache))), ["records.json"]);
});

test("best ranks score, hops and hints while last tracks each completed run", async t => {
  const cache = await cacheDirectory(t);
  for (const value of [record(600, 40, 2), record(600, 39, 5), record(600, 39, 1), record(590, 30, 0)]) {
    assert.equal(await savePacketResult("yuna", value, cache), true);
  }
  const loaded = await loadPacketRecords(cache);
  assert.deepEqual(loaded.records.get("yuna"), { best: record(600, 39, 1), last: record(590, 30, 0) });
  assert.equal(isBetterPacketResult(record(601, 90, 90), record(600, 39, 1)), true);
  assert.equal(isBetterPacketResult(record(600, 39, 1), record(600, 39, 1)), false);
});

test("parallel processes merge results without dropping other seeds or a higher score", async t => {
  const cache = await cacheDirectory(t);
  await Promise.all(Array.from({ length: 6 }, (_, index) => {
    const source = `
      import { savePacketResult } from ${JSON.stringify(recordsUrl)};
      const cache = ${JSON.stringify(cache)};
      const result = ${JSON.stringify(record(600 + index * 10, 40 - index, index))};
      if (!await savePacketResult(${JSON.stringify(`seed-${index}`)}, result, cache)) throw new Error("seed save failed");
      if (!await savePacketResult("shared", result, cache)) throw new Error("shared save failed");
    `;
    return exec(process.execPath, ["--input-type=module", "--eval", source], { windowsHide: true, timeout: 10000 });
  }));
  const loaded = await loadPacketRecords(cache);
  assert.equal(loaded.warning, undefined);
  assert.equal(loaded.records.size, 7);
  assert.deepEqual(loaded.records.get("shared").best, record(650, 35, 5));
  for (let index = 0; index < 6; index++) assert.deepEqual(loaded.records.get(`seed-${index}`).best, record(600 + index * 10, 40 - index, index));
  assert.deepEqual(await readdir(path.dirname(target(cache))), ["records.json"]);
});

test("corrupt, incompatible and invalid records are preserved rather than overwritten", async t => {
  const cache = await cacheDirectory(t);
  const file = target(cache);
  await mkdir(path.dirname(file), { recursive: true });
  for (const content of [
    "not JSON",
    JSON.stringify({ version: 99, ruleset: PACKET_RULESET, entries: [] }),
    JSON.stringify({ version: 1, ruleset: "other-rules", entries: [] }),
    document([["yuna", { best: record(-1) }]]),
    document([["yuna", { best: record(600, 1.5) }]]),
    document([["yuna", { best: record(600, 40, null) }]]),
    document([["yuna", { last: record() }]]),
    document([["yuna", { best: record(500), last: record(600) }]]),
    document([["bad\nseed", { best: record() }]]),
    document([["yuna", {}]]),
    document([["yuna", { best: record() }], ["yuna", { best: record() }]]),
    "x".repeat(256 * 1024 + 1),
  ]) {
    await writeFile(file, content);
    const loaded = await loadPacketRecords(cache);
    assert.equal(loaded.records.size, 0);
    assert.ok(loaded.warning);
    assert.equal(await savePacketResult("new-seed", record(), cache), false);
    assert.equal(await readFile(file, "utf8"), content);
    assert.deepEqual(await readdir(path.dirname(file)), ["records.json"]);
  }
});

test("an unavailable cache or a busy lock does not throw or modify existing records", async t => {
  const root = await cacheDirectory(t);
  const blocked = path.join(root, "not-a-directory");
  await writeFile(blocked, "keep");
  assert.ok((await loadPacketRecords(blocked)).warning);
  assert.equal((await savePacketResultOutcome("yuna", record(), blocked)).status, "unavailable");
  assert.equal(await readFile(blocked, "utf8"), "keep");
  const cache = path.join(root, "cache");
  assert.equal(await savePacketResult("yuna", record(), cache), true);
  const before = await readFile(target(cache), "utf8");
  await writeFile(`${target(cache)}.lock`, "another process");
  const busy = await savePacketResultOutcome("yuna", record(700), cache);
  assert.equal(busy.status, "busy");
  assert.ok(busy.message.includes(`${target(cache)}.lock`));
  assert.match(busy.message, /没有游戏运行/);
  assert.equal(await readFile(target(cache), "utf8"), before);
  assert.equal(await readFile(`${target(cache)}.lock`, "utf8"), "another process");
});

test("rulesets are isolated and only the 200 most recently played seeds are retained", async t => {
  const cache = await cacheDirectory(t);
  const oldPath = path.join(cache, "games", "packet-v1", "records.json");
  await mkdir(path.dirname(oldPath), { recursive: true });
  await writeFile(oldPath, "old version stays untouched");
  assert.equal((await loadPacketRecords(cache)).records.size, 0);
  const entries = Array.from({ length: 200 }, (_, index) => [`seed-${index}`, { best: record(), last: record() }]);
  await mkdir(path.dirname(target(cache)), { recursive: true });
  await writeFile(target(cache), document(entries));
  assert.equal(await savePacketResult("seed-0", record(700), cache), true);
  assert.equal(await savePacketResult("seed-200", record(), cache), true);
  const loaded = await loadPacketRecords(cache);
  assert.equal(loaded.records.size, 200);
  assert.equal(loaded.records.has("seed-0"), true);
  assert.equal(loaded.records.has("seed-1"), false);
  assert.equal(loaded.records.has("seed-200"), true);
  assert.equal(await readFile(oldPath, "utf8"), "old version stays untouched");
});

test("seed names are data, and invalid results never create a cache", async t => {
  const root = await cacheDirectory(t);
  const cache = path.join(root, "cache");
  for (const [seed, value] of [["", record()], ["bad\nseed", record()], ["x".repeat(65), record()], ["yuna", record(NaN)], ["yuna", record(600, 40, -1)]]) {
    assert.equal(await savePacketResult(seed, value, cache), false);
  }
  await assert.rejects(access(cache), { code: "ENOENT" });
  for (const seed of ["__proto__", "constructor", "中文地图"]) assert.equal(await savePacketResult(seed, record(), cache), true);
  const loaded = await loadPacketRecords(cache);
  assert.equal(loaded.records.size, 3);
  for (const seed of ["__proto__", "constructor", "中文地图"]) assert.deepEqual(loaded.records.get(seed), { best: record(), last: record() });
});
