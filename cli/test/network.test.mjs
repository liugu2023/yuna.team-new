import assert from "node:assert/strict";
import test, { after, before, afterEach, beforeEach, describe } from "node:test";
import http from "node:http";
import { configureProxy, fetchImpl, shutdownProxy } from "../dist/net.js";

// 显式套件让 Node 18.17 在测试结束时执行 after，不必等监听中的服务器自行退出。
describe("network lifecycle", () => {
const originalFetch = globalThis.fetch;
let server, base, requests, nativeCalls;

function connectionError(code = "ETIMEDOUT") {
  return new TypeError("fetch failed", { cause: Object.assign(new Error("connection failed"), { code }) });
}

before(async () => {
  server = http.createServer((request, response) => {
    requests++;
    if (request.url === "/disconnect") { request.socket.destroy(); return; }
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url === "/body-stall") { response.write('{"ok":'); return; }
    response.end(JSON.stringify({ ok: true, method: request.method }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await shutdownProxy();
  requests = 0;
  nativeCalls = 0;
  globalThis.fetch = async () => { nativeCalls++; throw connectionError(); };
});

afterEach(async () => {
  await shutdownProxy();
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
});

after(async () => {
  await new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  });
});

test("native fetch stays preferred when it succeeds, including HTTP error responses", async () => {
  for (const status of [200, 503]) {
    globalThis.fetch = async () => { nativeCalls++; return new Response("native", { status }); };
    const response = await fetchImpl()(base);
    assert.equal(response.status, status);
    assert.equal(await response.text(), "native");
  }
  assert.equal(nativeCalls, 2);
  assert.equal(requests, 0);
});

test("a connection failure retries through undici and reuses it for later requests", async () => {
  const start = Date.now();
  assert.deepEqual(await (await fetchImpl()(base)).json(), { ok: true, method: "GET" });
  assert.ok(Date.now() - start >= 150, "retry should include the brief delay");
  assert.deepEqual(await (await fetchImpl()(base)).json(), { ok: true, method: "GET" });
  assert.equal(nativeCalls, 1);
  assert.equal(requests, 2);
});

test("connection errors nested in AggregateError and cause can trigger the single retry", async () => {
  for (const code of ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ENETUNREACH", "EHOSTUNREACH"]) {
    await shutdownProxy();
    const nested = new AggregateError([new Error("unrelated"), connectionError(code)], "all attempts failed");
    globalThis.fetch = async () => { nativeCalls++; throw new TypeError("fetch failed", { cause: nested }); };
    const response = await fetchImpl()(base);
    assert.equal(response.status, 200);
    await response.text();
  }
  assert.equal(requests, 4);
  assert.equal(nativeCalls, 4);
});

test("HEAD retries, but POST does not retry a connection failure", async () => {
  await assert.rejects(fetchImpl()(base, { method: "POST", body: "example" }), /fetch failed/);
  assert.equal(requests, 0);
  const head = await fetchImpl()(base, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(requests, 1);
});

test("certificate, DNS, abort and other non-connection failures are preserved", async () => {
  const failures = [
    connectionError("CERT_HAS_EXPIRED"), connectionError("UNABLE_TO_VERIFY_LEAF_SIGNATURE"),
    connectionError("ENOTFOUND"), connectionError("ECONNRESET"),
    new DOMException("cancelled", "AbortError"), new DOMException("deadline", "TimeoutError"),
  ];
  for (const error of failures) {
    globalThis.fetch = async () => { throw error; };
    await assert.rejects(fetchImpl()(base), actual => actual === error);
  }
  assert.equal(requests, 0);
});

test("already aborted requests and aborting during the retry delay never reconnect", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already stopped"));
  await assert.rejects(fetchImpl()(base, { signal: controller.signal }));
  const deadline = AbortSignal.timeout(30);
  await assert.rejects(fetchImpl()(base, { signal: deadline }), error => error === deadline.reason);
  assert.equal(requests, 0);
});

test("the original deadline still applies while reading the retried response body", async () => {
  const deadline = AbortSignal.timeout(500);
  const response = await fetchImpl()(base + "/body-stall", { signal: deadline });
  await assert.rejects(response.text());
  assert.equal(deadline.aborted, true);
  assert.equal(requests, 1);
});

test("a failed fallback is returned without any further request", async () => {
  await assert.rejects(fetchImpl()(base + "/disconnect", { signal: AbortSignal.timeout(1500) }));
  assert.equal(nativeCalls, 1);
  assert.equal(requests, 1);
});

test("shutdown releases fallback state and restores the native first attempt", async () => {
  await (await fetchImpl()(base)).text();
  await shutdownProxy();
  globalThis.fetch = async () => { nativeCalls++; return new Response("native restored"); };
  assert.equal(await (await fetchImpl()(base)).text(), "native restored");
  assert.equal(nativeCalls, 2);
  assert.equal(requests, 1);
});

test("an explicit failing proxy is never replaced with a direct connection", async () => {
  let proxyRequests = 0;
  const sockets = new Set();
  const proxy = http.createServer();
  proxy.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  proxy.on("connect", (_request, socket) => {
    proxyRequests++;
    socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  try {
    await configureProxy(`http://127.0.0.1:${proxy.address().port}`);
    await assert.rejects(fetchImpl()(base, { signal: AbortSignal.timeout(1500) }));
    assert.equal(proxyRequests, 1);
    assert.equal(nativeCalls, 0);
    assert.equal(requests, 0);
  } finally {
    await shutdownProxy();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
  }
});

test("an explicitly empty proxy is invalid rather than interpreted as direct mode", async () => {
  assert.equal(await configureProxy(undefined), null);
  for (const proxy of ["", "  ", "socks5://127.0.0.1:1080"]) {
    await assert.rejects(configureProxy(proxy), /HTTP\(S\)/);
  }
  assert.equal(nativeCalls, 0);
  assert.equal(requests, 0);
});
});
