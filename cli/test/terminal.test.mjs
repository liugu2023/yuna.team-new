import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { displayWidth, stripAnsi, truncateWidth, wrapText } from "../dist/ui.js";
import { inlineMarkdown, renderMarkdown } from "../dist/markdown.js";
import { openInBrowser } from "../dist/open.js";

test("English wraps at spaces while long words remain within the terminal width", () => {
  assert.deepEqual(wrapText("hello brave world", 11), ["hello brave", "world"]);
  assert.deepEqual(wrapText("abcdefghijklmnopq", 8), ["abcdefgh", "ijklmnop", "q"]);
  assert.deepEqual(wrapText("hello world", 8, "  "), ["  hello", "  world"]);
});

test("mixed Chinese and English keep the author's spacing and closing punctuation", () => {
  assert.deepEqual(wrapText("B站与PS基础", 40), ["B站与PS基础"]);
  assert.deepEqual(wrapText("中文测试。", 8), ["中文测", "试。"]);
  assert.deepEqual(wrapText("中文abc测试", 7), ["中文abc", "测试"]);
});

test("ANSI colors are zero width and never split during wrapping", () => {
  const colored = "\x1b[38;2;60;100;240mhello brave world\x1b[0m";
  const lines = wrapText(colored, 11);
  assert.deepEqual(lines.map(stripAnsi), ["hello brave", "world"]);
  assert.equal(lines.join("\n").match(/\x1b\[[0-?]*[ -/]*[@-~]/g)?.join(""), "\x1b[38;2;60;100;240m\x1b[0m");
  for (const line of lines) {
    assert.ok(displayWidth(line) <= 11);
    assert.ok(!stripAnsi(line).includes("\x1b"));
  }
  assert.deepEqual(wrapText("\x1b[31mabc\x1b[0mdefghij", 4).map(stripAnsi), ["abcd", "efgh", "ij"]);
});

test("ANSI truncation preserves the width limit and resets the truncated color", () => {
  const output = truncateWidth("\x1b[31m中文abc\x1b[0m", 5);
  assert.equal(stripAnsi(output), "中文…");
  assert.equal(displayWidth(output), 5);
  assert.ok(output.endsWith("\x1b[0m"));
  assert.equal(truncateWidth("中文", 0), "");
  assert.equal(truncateWidth("中文", 1), "…");
  assert.equal(displayWidth("e\u0301\x1b[31m中文\x1b[0m"), 5);
});

test("malformed numeric entities cannot crash Markdown reading", () => {
  const invalid = "&#999999999999999999999; &#x110000; &#55296; &#xDFFF; &#0; &#12af;";
  assert.equal(inlineMarkdown(invalid), invalid);
  assert.equal(inlineMarkdown("&#65; &#x1f600; &#X4e2d; &amp;"), "A 😀 中 &");
  assert.doesNotThrow(() => renderMarkdown(`## 标题\n\n${invalid}`, 80));
});

test("Markdown preserves email autolinks and aligns wrapped list text", () => {
  assert.equal(inlineMarkdown("联系 <team@example.com> 或 <mailto:help@example.com>"), "联系 team@example.com 或 mailto:help@example.com");
  assert.equal(renderMarkdown("- hello brave world", 15), "  • hello brave\n    world");
});

test("headings and blockquotes account for their terminal indentation", () => {
  for (const source of ["## hello brave world", "> hello brave world"]) {
    const output = renderMarkdown(source, 15);
    for (const line of output.split("\n")) assert.ok(displayWidth(line) <= 15, line);
  }
});

function spawnResult(code = 0, error) {
  const calls = [];
  const spawn = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    queueMicrotask(() => {
      if (error) child.emit("error", error);
      else {
        child.emit("spawn");
        child.emit("close", code);
      }
    });
    return child;
  };
  return { spawn, calls };
}

test("opening a browser waits for a successful launcher exit", async () => {
  const child = new EventEmitter();
  let settled = false;
  const result = openInBrowser("https://example.test", { platform: "linux", spawn: () => child })
    .then((value) => { settled = true; return value; });
  child.emit("spawn");
  await Promise.resolve();
  assert.equal(settled, false);
  child.emit("close", 3);
  assert.equal(await result, false);
  for (const code of [0, 1, null]) {
    const mock = spawnResult(code);
    assert.equal(await openInBrowser("https://example.test", { platform: "linux", spawn: mock.spawn }), code === 0);
  }
});

test("browser launch failures return false instead of claiming the link opened", async () => {
  const mock = spawnResult(0, new Error("ENOENT"));
  assert.equal(await openInBrowser("https://example.test", { spawn: mock.spawn }), false);
  assert.equal(await openInBrowser("https://example.test", { spawn: () => { throw new Error("spawn failed"); } }), false);
});

test("Windows query strings and shell syntax are passed as data through a hidden launcher", async () => {
  const url = `https://example.test/page?a=1&b=";$(Start-Process calc);'&c=%PATH%`;
  const mock = spawnResult();
  assert.equal(await openInBrowser(url, { platform: "win32", spawn: mock.spawn }), true);
  const [command, args, options] = mock.calls[0];
  assert.equal(command, "powershell.exe");
  assert.deepEqual(args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  const script = Buffer.from(args[3], "base64").toString("utf16le");
  const encodedUrl = script.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)?.[1];
  assert.ok(encodedUrl);
  assert.equal(Buffer.from(encodedUrl, "base64").toString("utf8"), url);
  assert.ok(!script.includes("Start-Process calc"));
  assert.ok(script.endsWith("Start-Process -FilePath $url"));
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
});

test("Unix browser launchers also pass URLs without a shell", async () => {
  for (const [platform, command] of [["darwin", "open"], ["linux", "xdg-open"]]) {
    const url = "https://example.test/?q=$(touch%20bad)&other=value";
    const mock = spawnResult();
    assert.equal(await openInBrowser(url, { platform, spawn: mock.spawn }), true);
    assert.deepEqual(mock.calls[0].slice(0, 2), [command, [url]]);
    assert.equal(mock.calls[0][2].shell, false);
  }
});

test("only valid web URLs reach the browser launcher", async () => {
  const mock = spawnResult();
  for (const url of ["javascript:alert(1)", "file:///tmp/file", "not a url"]) {
    assert.equal(await openInBrowser(url, { spawn: mock.spawn }), false);
  }
  assert.equal(mock.calls.length, 0);
});
