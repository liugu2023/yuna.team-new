import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { runTerminalSession } from "../dist/games/terminal-session.js";
import { createGame, movePacket, solveGame } from "../dist/games/packet-engine.js";
import { createPacketController } from "../dist/games/packet-controller.js";
import { MIN_COLUMNS, MIN_ROWS, renderPacketFrame } from "../dist/games/packet-renderer.js";
import { displayWidth, stripAnsi } from "../dist/ui.js";
import { isTerminalOutputOwned } from "../dist/terminal-errors.js";

function terminal({ raw = false, flowing = false, columns = 40, rows = 10, slow = false } = {}) {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = raw;
  const rawModes = [];
  input.setRawMode = (value) => { rawModes.push(value); input.isRaw = value; };
  if (flowing) input.resume();
  else input.pause();
  const writes = [];
  const pendingWrites = [];
  const output = new Writable({ highWaterMark: slow ? 1 : 16384,
    write(chunk, _encoding, callback) {
      writes.push(chunk.toString());
      if (slow) pendingWrites.push(callback);
      else callback();
    },
  });
  Object.assign(output, { isTTY: true, columns, rows });
  return { input, output, writes, rawModes, pendingWrites };
}

function listenerCounts(input, output) {
  return [
    ...["data", "error", "end", "close", "keypress", "newListener"].map((event) => input.listenerCount(event)),
    ...["resize", "error", "close", "drain"].map((event) => output.listenerCount(event)),
    process.listenerCount("SIGINT"), process.listenerCount("SIGTERM"),
  ];
}

// Model the terminal cells, so overwriting a shorter line leaves old text unless
// the session actually erases it. Wide Chinese characters occupy two cells.
function terminalScreen(columns, rows) {
  let cells = Array.from({ length: rows }, () => Array(columns).fill(" "));
  let x = 0;
  let y = 0;
  const erase = (row, start, end) => {
    if (start > 0 && cells[row][start] === "") cells[row][start - 1] = " ";
    if (end < columns && cells[row][end] === "") cells[row][end] = " ";
    cells[row].fill(" ", start, end);
  };
  return {
    write(text) {
      for (const token of text.matchAll(/\x1b\[([0-?]*)[ -/]*([@-~])|([\s\S])/gu)) {
        if (token[2]) {
          const mode = Number(token[1] || 0);
          if (token[2] === "H") {
            const [row = 1, column = 1] = token[1].split(";").map(value => Number(value) || 1);
            x = Math.min(columns - 1, Math.max(0, column - 1));
            y = Math.min(rows - 1, Math.max(0, row - 1));
          }
          if (token[2] === "K") erase(y, mode === 0 ? x : 0, mode === 1 ? x + 1 : columns);
          if (token[2] === "J") {
            if (mode === 2) cells.forEach((_row, row) => erase(row, 0, columns));
            else if (mode === 0) {
              erase(y, x, columns);
              for (let row = y + 1; row < rows; row++) erase(row, 0, columns);
            }
          }
          continue;
        }
        const char = token[3];
        if (char === "\r") { x = 0; continue; }
        if (char === "\n") { y = Math.min(rows - 1, y + 1); continue; }
        const width = displayWidth(char);
        if (!width || x + width > columns) continue;
        erase(y, x, x + width);
        cells[y][x] = char;
        for (let extra = 1; extra < width; extra++) cells[y][x + extra] = "";
        x += width;
      }
    },
    resize(nextColumns, nextRows) {
      cells = Array.from({ length: nextRows }, (_, row) =>
        Array.from({ length: nextColumns }, (_, column) => cells[row]?.[column] ?? " "));
      columns = nextColumns;
      rows = nextRows;
      x = Math.min(x, columns - 1);
      y = Math.min(y, rows - 1);
    },
    assertFrame(frame) {
      const expected = stripAnsi(frame).split("\n").map((line) => line.trimEnd());
      while (expected.length < rows) expected.push("");
      assert.deepEqual(cells.map((row) => row.join("").trimEnd()), expected);
    },
  };
}

test("terminal session parses arrow keys and quit, then restores screen, raw mode, flow and listeners", async () => {
  const tty = terminal();
  const counts = listenerCounts(tty.input, tty.output);
  const keys = [];
  const task = runTerminalSession({ ...tty, render: () => "packet", onKey(key) {
    keys.push(key.name);
    if (key.name === "q") return "exit";
  } });
  tty.input.write("\x1b[A");
  tty.input.write("q");
  await task;
  assert.deepEqual(keys, ["up", "q"]);
  assert.deepEqual(tty.rawModes, [true, false]);
  assert.equal(tty.input.readableFlowing, false);
  assert.deepEqual(listenerCounts(tty.input, tty.output), counts);
  assert.match(tty.writes[0], /\x1b\[\?1049h\x1b\[\?25l/);
  assert.equal(tty.writes.at(-1), "\x1b[0m\x1b[?25h\x1b[?1049l");
});

test("existing raw mode, flowing input and unrelated listeners survive a game", async () => {
  const tty = terminal({ raw: true, flowing: true });
  const seen = [];
  tty.input.on("data", (chunk) => seen.push(chunk.toString()));
  const counts = listenerCounts(tty.input, tty.output);
  const task = runTerminalSession({ ...tty, render: () => "", onKey: () => "exit" });
  tty.input.write("q");
  await task;
  assert.deepEqual(tty.rawModes, [true, true]);
  assert.equal(tty.input.readableFlowing, true);
  assert.deepEqual(seen, ["q"]);
  assert.deepEqual(listenerCounts(tty.input, tty.output), counts);
  tty.input.pause();
});

test("repeated keys do not repaint an unchanged frame, while resize always restores it", async () => {
  const tty = terminal();
  let frame = "packet";
  let keys = 0;
  const task = runTerminalSession({ ...tty, render: () => frame, onKey(key) {
    if (key.name === "q") return "exit";
    keys++;
  } });
  try {
    const initialWrites = tty.writes.length;
    tty.input.write("xxxxx");
    assert.equal(keys, 5, "every input still reaches the game");
    assert.equal(tty.writes.length, initialWrites);
    frame = "moved";
    tty.input.write("x");
    assert.equal(tty.writes.length, initialWrites + 1);
    assert.match(stripAnsi(tty.writes.at(-1)), /moved/);
    tty.output.emit("resize");
    assert.equal(tty.writes.length, initialWrites + 2);
    assert.match(stripAnsi(tty.writes.at(-1)), /moved/);
  } finally {
    tty.input.write("q");
    await task;
  }
});

test("changed rows use cursor positioning and erase tails without repainting the map", async () => {
  const tty = terminal({ columns: 60, rows: 8 });
  const screen = terminalScreen(60, 8);
  let frame = "地图保持可见\n################\n原来很长的中文提示\n准备重玩\n旧页脚";
  let redraw;
  let consumed = 0;
  const check = () => {
    for (; consumed < tty.writes.length; consumed++) screen.write(tty.writes[consumed]);
    screen.assertFrame(frame);
  };
  const task = runTerminalSession({ ...tty, render: () => frame, onKey: () => "exit", onReady: refresh => { redraw = refresh; } });
  try {
    check();
    frame = "地图保持可见\n################\n收到。\n\n旧页脚";
    redraw();
    assert.doesNotMatch(tty.writes.at(-1), /地图保持可见|################|旧页脚/);
    check();
    frame = "地图保持可见\n################\n收到。";
    redraw();
    check();
    const writes = tty.writes.length;
    redraw();
    assert.equal(tty.writes.length, writes);
  } finally {
    tty.input.write("q");
    await task;
  }
  const writes = tty.writes.length;
  redraw();
  assert.equal(tty.writes.length, writes, "late async notifications are harmless");
});

test("backpressure merges the latest frame without dropping input and waits for screen restoration", async () => {
  const tty = terminal({ columns: 60, rows: 8, slow: true });
  const counts = listenerCounts(tty.input, tty.output);
  const screen = terminalScreen(60, 8);
  let moves = 0;
  let redraw;
  const render = () => `固定地图\n第 ${moves} 步\n中文提示`;
  const releaseOne = async () => {
    assert.ok(tty.pendingWrites.length);
    tty.pendingWrites.shift()();
    await new Promise(resolve => setImmediate(resolve));
  };
  const task = runTerminalSession({ ...tty, render, onKey(key) {
    if (key.name === "q") return "exit";
    moves++;
  }, onReady: refresh => { redraw = refresh; } });
  let exited = false;
  task.then(() => { exited = true; });
  try {
    assert.equal(tty.writes.length, 1, "startup backpressure holds the first frame");
    tty.input.write("xxx");
    assert.equal(moves, 3);
    assert.equal(tty.writes.length, 1);
    await releaseOne();
    assert.equal(tty.writes.length, 2);
    for (const write of tty.writes) screen.write(write);
    screen.assertFrame(render());
    tty.input.write("x".repeat(50));
    assert.equal(moves, 53);
    assert.equal(tty.writes.length, 2, "only one latest frame is pending outside the stream");
    tty.output.columns = 42;
    screen.resize(42, 8);
    tty.output.emit("resize");
    redraw();
    await releaseOne();
    assert.equal(tty.writes.length, 3);
    assert.match(tty.writes[2], /固定地图/, "resize forces a complete frame");
    screen.write(tty.writes[2]);
    screen.assertFrame(render());
    tty.input.write("xq");
    assert.equal(moves, 54, "even the final queued move is processed before quitting");
    assert.deepEqual(tty.rawModes, [true, false], "raw input is restored immediately");
    assert.equal(exited, false);
    redraw();
    await releaseOne();
    assert.equal(exited, false, "wait for the queued restore sequence too");
    assert.equal(tty.writes.at(-1), "\x1b[0m\x1b[?25h\x1b[?1049l");
    await releaseOne();
    await task;
    assert.equal(exited, true);
    assert.deepEqual(listenerCounts(tty.input, tty.output), counts);
    assert.equal(isTerminalOutputOwned(tty.output), false);
    assert.doesNotMatch(tty.writes.join(""), /第 54 步/, "unsent frames are discarded on exit");
  } finally {
    tty.input.write("q");
    while (tty.pendingWrites.length) await releaseOne();
    await task;
  }
});

test("external update failures restore the terminal just like render and setup failures", async () => {
  for (const location of ["ready", "refresh"]) {
    const tty = terminal();
    const expected = new Error(`bad ${location}`);
    let redraw;
    let failRender = false;
    const task = runTerminalSession({ ...tty, render() { if (failRender) throw expected; return "ready"; }, onKey() {},
      onReady(refresh) { redraw = refresh; if (location === "ready") throw expected; },
    });
    if (location === "refresh") { failRender = true; redraw(); }
    await assert.rejects(task, error => error === expected);
    assert.deepEqual(tty.rawModes, [true, false]);
    assert.equal(isTerminalOutputOwned(tty.output), false);
    assert.equal(tty.writes.at(-1), "\x1b[0m\x1b[?25h\x1b[?1049l");
  }
});

test("output errors stay owned for all listeners in the dispatch and always restore raw input", async () => {
  for (const failure of ["error", "close"]) {
    const tty = terminal();
    const ownership = [];
    const globalHandler = () => {
      ownership.push(isTerminalOutputOwned(tty.output));
      if (!isTerminalOutputOwned(tty.output)) throw new Error("global handler stole the error");
    };
    tty.output.on("error", globalHandler);
    const task = runTerminalSession({ ...tty, render: () => "ready", onKey() {} });
    tty.output.on("error", globalHandler);
    const expected = new Error("terminal disconnected");
    const writes = tty.writes.length;
    tty.output.emit(failure, expected);
    assert.deepEqual(tty.rawModes, [true, false]);
    assert.equal(tty.writes.length, writes, "an unavailable output cannot restore the screen");
    if (failure === "error") {
      assert.deepEqual(ownership, [true, true]);
      await assert.rejects(task, error => error === expected);
    } else await task;
    assert.equal(isTerminalOutputOwned(tty.output), false);
    assert.equal(tty.output.listenerCount("drain"), 0);
    tty.output.removeAllListeners("error");
  }
});

test("asynchronous write failures during drawing or shutdown restore input without an unhandled error", async () => {
  for (const stage of ["drawing", "shutdown"]) {
    const tty = terminal({ slow: true });
    const ownership = [];
    tty.output.on("error", () => { ownership.push(isTerminalOutputOwned(tty.output)); });
    const task = runTerminalSession({ ...tty, render: () => "ready", onKey: () => "exit" });
    if (stage === "shutdown") {
      tty.pendingWrites.shift()();
      await new Promise(resolve => setImmediate(resolve));
      tty.input.write("q");
      tty.pendingWrites.shift()();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(tty.writes.at(-1), "\x1b[0m\x1b[?25h\x1b[?1049l");
    }
    const expected = new Error(`failed ${stage}`);
    const rejected = assert.rejects(task, error => error === expected);
    tty.pendingWrites.shift()(expected);
    await rejected;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(tty.rawModes, [true, false]);
    assert.deepEqual(ownership, [true]);
    assert.equal(isTerminalOutputOwned(tty.output), false);
    assert.equal(tty.output.listenerCount("error"), 1);
    assert.equal(tty.output.listenerCount("drain"), 0);
  }
});

test("render and key-handler errors restore terminal state before rejecting", async () => {
  for (const location of ["render", "key"]) {
    const tty = terminal();
    const counts = listenerCounts(tty.input, tty.output);
    const expected = new Error(`bad ${location}`);
    const task = runTerminalSession({ ...tty,
      render() { if (location === "render") throw expected; return "ok"; },
      onKey() { throw expected; },
    });
    if (location === "key") tty.input.write("x");
    await assert.rejects(task, (error) => error === expected);
    assert.deepEqual(tty.rawModes, [true, false]);
    assert.equal(tty.input.readableFlowing, false);
    assert.deepEqual(listenerCounts(tty.input, tty.output), counts);
    assert.match(tty.writes.at(-1), /\x1b\[\?25h\x1b\[\?1049l/);
  }
});

test("Ctrl+C and process signals restore the terminal without calling process.exit", async () => {
  const previousCode = process.exitCode;
  try {
    for (const signal of ["Ctrl+C", "SIGINT", "SIGTERM"]) {
      const tty = terminal();
      const counts = listenerCounts(tty.input, tty.output);
      const task = runTerminalSession({ ...tty, render: () => "ready", onKey() { assert.fail("signal reached game"); } });
      if (signal === "Ctrl+C") tty.input.write("\x03");
      else process.emit(signal);
      await task;
      assert.equal(process.exitCode, signal === "SIGTERM" ? 143 : 130);
      assert.deepEqual(tty.rawModes, [true, false]);
      assert.deepEqual(listenerCounts(tty.input, tty.output), counts);
      assert.match(tty.writes.at(-1), /\x1b\[\?25h\x1b\[\?1049l/);
    }
  } finally {
    process.exitCode = previousCode;
  }
});

test("frames resize and clip to the viewport without wrapping or scrolling", async () => {
  const tty = terminal({ columns: 10, rows: 3 });
  const dimensions = [];
  const task = runTerminalSession({ ...tty, render(columns, rows) {
    dimensions.push([columns, rows]);
    return "\x1b[31m中文abcdefghi\x1b[0m\nsecond\nthird\nfourth\n";
  }, onKey: () => "exit" });
  const first = stripAnsi(tty.writes[1]).split("\r\n");
  assert.equal(first.length, 3);
  assert.ok(first.every((line) => displayWidth(line) <= 9));
  tty.output.columns = 5;
  tty.output.rows = 1;
  tty.output.emit("resize");
  assert.deepEqual(dimensions, [[10, 3], [5, 1]]);
  const resized = stripAnsi(tty.writes.at(-1));
  assert.ok(displayWidth(resized) <= 4);
  assert.ok(!resized.includes("\n"));
  tty.input.write("q");
  await task;
});

test("redraw erases shortened Chinese lines, blank lines and rows removed after resize", async () => {
  const tty = terminal({ columns: 60, rows: 6 });
  const screen = terminalScreen(60, 6);
  let frame = "\x1b[32m> 先激活两个 R 路由节点，再抵达 G 服务器。\x1b[0m\n还有节点等待激活\n原来的页脚";
  let consumed = 0;
  const check = () => {
    for (; consumed < tty.writes.length; consumed++) screen.write(tty.writes[consumed]);
    screen.assertFrame(frame);
  };
  const task = runTerminalSession({ ...tty, render: () => frame, onKey: key => key.name === "q" ? "exit" : undefined });
  try {
    check();
    frame = "\x1b[32m> 收到。\x1b[0m\n\n新页脚";
    tty.input.write("x");
    check();
    frame = "已退出地图";
    tty.output.columns = 20;
    screen.resize(20, 6);
    tty.output.emit("resize");
    check();
  } finally {
    tty.input.write("q");
    await task;
  }
});

test("packet delivery replaces wrapped instructions without leaving old Chinese text", async () => {
  for (const columns of [60, 80, 96]) {
    const tty = terminal({ columns, rows: 24 });
    const screen = terminalScreen(columns, 24);
    let game = createGame("yuna");
    const render = () => renderPacketFrame(game, columns, 24, { color: true });
    const task = runTerminalSession({ ...tty, render, onKey(key) {
      if (key.name === "q") return "exit";
      for (const direction of solveGame(game)) game = movePacket(game, direction);
    } });
    try {
      for (const write of tty.writes) screen.write(write);
      screen.assertFrame(render());
      const consumed = tty.writes.length;
      tty.input.write("x");
      assert.equal(game.status, "won");
      for (const write of tty.writes.slice(consumed)) screen.write(write);
      screen.assertFrame(render());
    } finally {
      tty.input.write("q");
      await task;
    }
  }
});

test("the full-screen game resizes without stale cells or changes to the current run", async () => {
  const tty = terminal({ columns: 80, rows: 24 });
  const screen = terminalScreen(80, 24);
  const controller = createPacketController({ seed: "yuna" });
  const render = () => {
    const { game, ...view } = controller.getState();
    return renderPacketFrame(game, tty.output.columns, tty.output.rows, { ...view, color: true });
  };
  let consumed = 0;
  const check = () => {
    for (; consumed < tty.writes.length; consumed++) screen.write(tty.writes[consumed]);
    screen.assertFrame(render());
  };
  const task = runTerminalSession({ ...tty, render,
    onKey: key => controller.onKey(key, tty.output.columns >= MIN_COLUMNS && tty.output.rows >= MIN_ROWS),
  });
  try {
    const directionKeys = { up: "w", down: "s", left: "a", right: "d" };
    const direction = solveGame(controller.getState().game)[0];
    tty.input.write(directionKeys[direction]);
    assert.equal(controller.getState().game.moves, 1);
    check();
    tty.input.write("t");
    check();
    const before = controller.getState().game;
    for (const [columns, rows] of [[120, 40], [42, 18], [35, 14], [160, 50], [80, 24]]) {
      tty.output.columns = columns;
      tty.output.rows = rows;
      screen.resize(columns, rows);
      tty.output.emit("resize");
      check();
      assert.strictEqual(controller.getState().game, before);
      if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
        tty.input.write(directionKeys[direction]);
        assert.strictEqual(controller.getState().game, before);
        check();
      }
    }
    for (const key of ["p", "h", "h", "p"]) {
      tty.input.write(key);
      check();
      assert.strictEqual(controller.getState().game, before);
    }
  } finally {
    tty.input.write("q");
    await task;
  }
});

test("redirected input or output is rejected before changing the terminal", async () => {
  for (const stream of ["input", "output"]) {
    const tty = terminal();
    tty[stream].isTTY = false;
    const counts = listenerCounts(tty.input, tty.output);
    await assert.rejects(runTerminalSession({ ...tty, render: () => "", onKey() {} }), /交互式终端/);
    assert.deepEqual(tty.rawModes, []);
    assert.deepEqual(tty.writes, []);
    assert.deepEqual(listenerCounts(tty.input, tty.output), counts);
  }
});

test("input EOF and stream errors clean up the session", async () => {
  for (const event of ["end", "error"]) {
    const tty = terminal();
    const counts = listenerCounts(tty.input, tty.output);
    const expected = new Error("input disconnected");
    const task = runTerminalSession({ ...tty, render: () => "ready", onKey() {} });
    tty.input.emit(event, expected);
    if (event === "error") await assert.rejects(task, (error) => error === expected);
    else await task;
    assert.deepEqual(tty.rawModes, [true, false]);
    assert.deepEqual(listenerCounts(tty.input, tty.output), counts);
    assert.match(tty.writes.at(-1), /\x1b\[\?25h\x1b\[\?1049l/);
  }
});

test("a raw-mode setup failure restores the input without entering the alternate screen", async () => {
  const tty = terminal();
  const counts = listenerCounts(tty.input, tty.output);
  const expected = new Error("raw mode unavailable");
  tty.input.setRawMode = (mode) => { tty.rawModes.push(mode); if (mode) throw expected; };
  await assert.rejects(runTerminalSession({ ...tty, render: () => "", onKey() {} }), (error) => error === expected);
  assert.deepEqual(tty.rawModes, [true, false]);
  assert.deepEqual(tty.writes, []);
  assert.deepEqual(listenerCounts(tty.input, tty.output), counts);
});
