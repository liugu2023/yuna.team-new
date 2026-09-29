import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { YunaApi, ApiError } from "../dist/api.js";
import { configureProxy, fetchImpl, shutdownProxy } from "../dist/net.js";

const exec = promisify(execFile);
const entry = fileURLToPath(new URL("../bin/yuna.mjs", import.meta.url));
const makePost = (slug, kind = "article", tag = "常规") => ({
  id: slug, slug, title: `标题 ${slug}`, kind, tag, status: "published", author_name: "测试作者",
});
const fixture = Array.from({ length: 600 }, (_, index) => makePost(`post-${index + 1}`, "article", index === 550 ? "运维" : "开发"));
let posts, mode, requests, directory, base, server;

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "yuna-cli-test-"));
  server = http.createServer((request, response) => {
    requests++;
    const url = new URL(request.url, "http://localhost");
    response.setHeader("content-type", "application/json");
    if (mode === "timeout") return;
    if (mode === "body-timeout") { response.writeHead(200); response.write('{"posts":'); return; }
    if (mode === "html") { response.setHeader("content-type", "text/html"); response.end('<h1>Unavailable</h1>'); return; }
    if (mode === "error") { response.writeHead(503); response.end('{"error":"服务维护中"}'); return; }
    if (mode === "null") { response.end("null"); return; }
    if (mode === "bad-list") { response.end('{"posts":{}}'); return; }
    if (mode === "bad-details") { response.end('{"post":null}'); return; }
    if (url.pathname === "/api/posts") {
      const kind = url.searchParams.get("kind") || "article";
      const selected = posts.filter(post => post.kind === kind);
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get("perPage")) || 10));
      const offset = mode === "repeat" ? 0 : (page - 1) * perPage;
      response.end(JSON.stringify({ posts: selected.slice(offset, offset + perPage), pagination: {
        page, perPage, total: selected.length, totalPages: Math.max(1, Math.ceil(selected.length / perPage)),
      } }));
    } else if (url.pathname.startsWith("/api/posts/")) {
      const slug = decodeURIComponent(url.pathname.slice("/api/posts/".length));
      const post = posts.find(item => item.slug === slug) || (slug === "2026" ? makePost("2026") : null);
      if (!post) { response.writeHead(404); response.end('{"error":"文章不存在"}'); return; }
      response.end(JSON.stringify({ post, markdown: `# ${post.title}\n\nHello from the CLI fixture.` }));
    } else response.end('{"records":{}}');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  posts = [...fixture, makePost("knowledge-one", "knowledge")];
  mode = "normal";
  requests = 0;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), "yuna-cli-test-")));
  await rm(directory, { recursive: true, force: true });
});

async function cli(args, options = {}) {
  try {
    const result = await exec(process.execPath, [entry, ...args, "--base", options.base || base], {
      timeout: 10000, windowsHide: true,
      env: { ...process.env, NO_COLOR: "1", YUNA_CACHE_DIR: options.cache || path.join(directory, "cache") },
    });
    return { code: 0, ...result };
  } catch (error) { return { code: error.code, stdout: error.stdout || "", stderr: error.stderr || "" }; }
}

test("lists paginate past 50 and 500 and find tags on later pages", async () => {
  for (const [args, length] of [[['-n', '60'], 60], [['--all'], 600], [['--tag', '运维'], 1]]) {
    const result = await cli(["posts", ...args, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).length, length);
  }
});

test("numeric reading preserves the filtered list even after a new post arrives", async () => {
  const cache = path.join(directory, "filtered");
  assert.equal((await cli(["posts", "--tag", "运维", "--json"], { cache })).code, 0);
  posts.unshift(makePost("new-arrival", "article", "运维"));
  const result = await cli(["read", "1", "--json"], { cache });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).post.slug, "post-551");
  assert.equal((await cli(["posts", "--kind", "knowledge", "--json"], { cache })).code, 0);
  const knowledge = await cli(["read", "1", "--json"], { cache });
  assert.equal(JSON.parse(knowledge.stdout).post.slug, "knowledge-one");
  const elsewhere = await cli(["read", "1", "--json"], { cache, base: base.replace("127.0.0.1", "localhost") });
  assert.equal(elsewhere.code, 1);
  assert.match(elsewhere.stderr, /先运行 yuna posts/);
});

test("empty lists replace stale history and missing history fails explicitly", async () => {
  const cache = path.join(directory, "empty");
  assert.equal((await cli(["read", "1", "--json"], { cache })).code, 1);
  await cli(["posts", "-n", "2", "--json"], { cache });
  await cli(["posts", "--tag", "不存在的标签", "--json"], { cache });
  const result = await cli(["read", "1", "--json"], { cache });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /只有 0 篇/);
});

test("explicit filters work without a saved list and numeric slugs can be read", async () => {
  for (const [flags, expected] of [[['--tag', '运维'], 'post-551'], [['--kind', 'knowledge'], 'knowledge-one']]) {
    const result = await cli(["read", "1", ...flags, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).post.slug, expected);
  }
  const result = await cli(["read", "2026", "--slug", "--json"]);
  assert.equal(JSON.parse(result.stdout).post.slug, "2026");
});

test("unwritable cache switches the list to slugs instead of misleading numbers", async () => {
  const cache = path.join(directory, "not-a-directory");
  await writeFile(cache, "occupied");
  const result = await cli(["posts", "-n", "1"], { cache });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /无法保存/);
  assert.match(result.stdout, /post-1  标题/);
});

test("invalid and irrelevant options fail before requesting data", async () => {
  for (const args of [
    ["posts", "--status", "planned"], ["read", "1", "extra"], ["posts", "--nope"],
    ["posts", "-n", "1e2"], ["posts", "-n", "9007199254740992"], ["posts", "-n", "0"],
    ["posts", "--all", "-n", "3"], ["posts", "--page", "2"], ["toString"], ["open", "constructor", "--json"],
    ["posts", "--kind", ""], ["posts", "--proxy", ""],
  ]) {
    const result = await cli(args);
    assert.equal(result.code, 1, args.join(" "));
    assert.notEqual(result.stderr, "");
  }
  assert.equal(requests, 0);
});

test("JSON web commands resolve URLs without opening a browser", async () => {
  const read = await cli(["read", "post-1", "--web", "--json"]);
  assert.deepEqual(JSON.parse(read.stdout), { slug: "post-1", url: base + "/post?slug=post-1" });
  const open = await cli(["open", "recap", "--json"]);
  assert.deepEqual(JSON.parse(open.stdout), { target: "recap", url: base + "/recap" });
  assert.equal(requests, 0);
});

test("API failures and malformed data produce useful failures", async () => {
  for (const value of ["html", "error", "null", "bad-list", "repeat"]) {
    mode = value;
    const result = await cli(["posts", "--all", "--json"]);
    assert.equal(result.code, 1, value);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /JSON|服务维护中|格式无效|下一页/);
  }
  mode = "bad-details";
  assert.equal((await cli(["read", "post-1", "--json"])).code, 1);
  assert.throws(() => new YunaApi({ base: "file:///tmp" }), ApiError);
  assert.throws(() => new YunaApi({ base: "https://example.test?wrong=path" }), ApiError);
});

test("timeouts include response-body stalls", async () => {
  const api = new YunaApi({ base, timeoutMs: 60 });
  for (const value of ["timeout", "body-timeout"]) {
    mode = value;
    await assert.rejects(api.listPosts(), error => error instanceof ApiError && /无法连接/.test(error.message));
    server.closeAllConnections();
  }
});

test("an explicit proxy really routes traffic and invalid proxies never silently go direct", async () => {
  let connections = 0;
  const sockets = new Set();
  const proxy = http.createServer();
  proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  proxy.on('connect', (request, socket, head) => {
    connections++;
    assert.equal(request.url, `127.0.0.1:${server.address().port}`);
    const upstream = net.connect(server.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
    });
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${proxy.address().port}`;
    const result = await cli(['posts', '-n', '1', '--json', '--proxy', 'invalid', '--proxy', address]);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(connections > 0);
    const beforeInvalid = requests;
    const invalid = await cli(['posts', '--json', '--proxy', 'socks5://localhost:1']);
    assert.equal(invalid.code, 1);
    assert.equal(requests, beforeInvalid);
    await configureProxy(address);
    await fetchImpl()(base + '/api/site');
    await shutdownProxy();
    const beforeDirect = connections;
    await fetchImpl()(base + '/api/site');
    assert.equal(connections, beforeDirect);
  } finally {
    await shutdownProxy();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
  }
});
