import assert from "node:assert/strict";
import test from "node:test";
import { createGame, movePacket, solveGame } from "../dist/games/packet-engine.js";
import { MIN_COLUMNS, MIN_ROWS, renderPacketFrame } from "../dist/games/packet-renderer.js";
import { getPacketEasterEgg } from "../dist/games/packet-review.js";
import { displayWidth, stripAnsi } from "../dist/ui.js";

const sizes = [[42, 18], [60, 24], [80, 24], [120, 40], [180, 60]];

function deliver(game) {
  for (const direction of solveGame(game)) game = movePacket(game, direction);
  return game;
}

function mapLines(frame) {
  const lines = stripAnsi(frame).split("\n");
  const first = lines.findIndex(line => line.startsWith("┌"));
  const last = lines.findIndex(line => line.startsWith("└"));
  assert.ok(first >= 0 && last > first, "the complete map remains visible");
  return lines.slice(first, last + 1);
}

test("every state fills the safe terminal viewport without losing instructions", () => {
  assert.equal(MIN_COLUMNS, 42);
  assert.equal(MIN_ROWS, 18);
  const initial = createGame("地图种子".repeat(16));
  const won = deliver(initial);
  const lost = { ...initial, ttl: 0, status: "lost", message: "TTL（体力）耗尽，数据包超时。试试更短的路，或绕开拥塞链路。" };
  const states = [
    [initial, {}], [initial, { paused: true }], [initial, { help: true }],
    [initial, { help: true, paused: true }],
    [initial, { paused: true, notice: "路线提示：下一步向右。" }],
    [{ ...initial, ttl: 1 }, {}],
    [initial, { notice: "下一步向右；还需 38 步，消耗 44 点 TTL（体力）。" }],
    [won, {}], [won, { best: { score: won.score, moves: won.moves } }],
    [won, { hints: 123, best: { score: won.score, moves: won.moves, hints: 123 }, last: { score: won.score - 100, moves: won.moves + 5, hints: 0 }, previousBest: { score: won.score - 10, moves: won.moves } }],
    [{ ...initial, ttl: 1, score: 1234, moves: 123 }, { hints: 123 }],
    [won, { help: true }], [lost, {}], [lost, { help: true, paused: true }],
    [initial, { review: true }], [won, { review: true }], [lost, { review: true }],
    [won, { help: true, review: true }],
    [won, { recordStatus: "成绩已保存" }],
    [won, { recordStatus: "保存失败，本局成绩仅在本次保留" }],
    [won, { review: true, recordStatus: "保存失败，本局成绩仅在本次保留" }],
  ];
  for (const [columns, rows] of sizes) {
    for (const color of [false, true]) {
      for (const [game, view] of states) {
        const frame = renderPacketFrame(game, columns, rows, { ...view, color });
        const lines = stripAnsi(frame).split("\n");
        assert.equal(lines.length, rows - 1);
        for (const [index, line] of lines.entries()) {
          assert.equal(displayWidth(line), columns - 1, `${columns}×${rows}: ${line}`);
          if (index !== 0) assert.ok(!line.includes("…"), `truncated content: ${line}`);
        }
        assert.match(lines.at(-1), /Q/);
        if (!view.help && !view.review) {
          assert.match(frame, /TTL（体力）(?:余|剩余)/);
          assert.match(frame, /重传（护盾）(?:余|剩余)\d+次/);
          assert.ok(frame.includes(`得分${game.score}`));
          assert.ok(frame.includes(`已走${game.moves}步`));
        }
        assert.ok(mapLines(frame).length >= 11);
        if (!color) assert.ok(!frame.includes("\x1b["));
      }
    }
  }
});

test("the same logical map expands across the available area as the terminal grows", () => {
  const game = createGame("yuna");
  const before = structuredClone(game);
  let previousWidth = 0;
  let previousHeight = 0;
  for (const [columns, rows] of sizes) {
    const frame = renderPacketFrame(game, columns, rows, { color: false });
    const map = mapLines(frame);
    assert.equal(displayWidth(map[0]), columns - 1);
    assert.ok(displayWidth(map[0]) > previousWidth);
    assert.ok(map.length >= previousHeight);
    assert.match(map[1], /^│█+│$/);
    assert.match(map.at(-2), /^│█+│$/);
    const contents = map.join("\n");
    assert.equal(contents.match(/\[\]/g).length, 1);
    assert.equal(contents.match(/R/g).length, game.routers.length);
    assert.equal(contents.match(/G\?/g).length, 1);
    previousWidth = displayWidth(map[0]);
    previousHeight = map.length;
  }
  assert.ok(previousWidth > 96);
  assert.ok(previousHeight > 40);
  assert.deepEqual(game, before);
});

test("minimum-size controls remain playable and smaller screens always expose Q", () => {
  const game = createGame("yuna");
  const compact = renderPacketFrame(game, 42, 18, { color: false });
  assert.match(compact, /WASD\/方向键 移动 P\/空格 暂停 T提示/);
  assert.match(compact, /H\/\?规则 按R重开 N新图 Q\/Esc退出/);
  assert.match(compact, /你是\[\]，两个R路由各打卡，再到G终点。/);
  for (const [columns, rows] of [[41, 18], [42, 17], [25, 6], [8, 3], [2, 2]]) {
    const small = renderPacketFrame(game, columns, rows, { paused: true, help: true, color: false });
    assert.equal(small.split("\n").length, rows - 1);
    assert.ok(small.split("\n").every(line => displayWidth(line) === columns - 1));
    assert.match(small, /Q/);
    assert.doesNotMatch(small, /Esc|┌/);
  }
});

test("pause and help retain the expanded map and describe the actual return state", () => {
  const game = createGame("yuna");
  const notice = "路线提示：下一步向右。";
  for (const [columns, rows] of sizes) {
    const normal = renderPacketFrame(game, columns, rows, { color: false });
    const paused = renderPacketFrame(game, columns, rows, { paused: true, notice, color: false });
    const help = renderPacketFrame(game, columns, rows, { paused: true, help: true, color: false });
    assert.deepEqual(mapLines(paused), mapLines(normal));
    assert.deepEqual(mapLines(help), mapLines(normal));
    assert.match(paused, /已暂停，体力不会减少。/);
    assert.match(paused, /P\s*\/\s*Space\s*\/\s*Esc.*继续/);
    assert.doesNotMatch(paused, /路线提示|T\s*提示/);
    assert.match(help, /返回暂停/);
    assert.doesNotMatch(help.split("\n")[0], /已暂停|投递成功/);
    assert.match(help, /体力用完(?:还没|未)通关才输/);
    assert.match(help, /没护盾时再遇(?:丢包|到)才输/);
    assert.match(help, /\+\+重传补给加1护盾\(最多3\)/);
    assert.match(help, /~~(?:链路)?拥塞(?:，每次)?扣3/);
    assert.match(help, /!!丢包，?每次扣1护盾/);
    assert.ok(renderPacketFrame(game, columns, rows, { notice, color: false }).includes(notice));
    const resultHelp = renderPacketFrame(deliver(game), columns, rows, { help: true, paused: true, color: false });
    assert.match(resultHelp, /返回结果/);
    assert.ok(mapLines(resultHelp).join("\n").includes("OK"));
  }
});

test("objectives, low TTL and complete route notices describe the current run", () => {
  const game = createGame("yuna");
  const oneRouter = { ...game, visitedRouters: [`${game.routers[0].x},${game.routers[0].y}`] };
  assert.match(renderPacketFrame(oneRouter, 60, 24, { color: false }), /还差1个R路由打卡点/);
  const ready = { ...game, visitedRouters: game.routers.map(({ x, y }) => `${x},${y}`) };
  assert.match(renderPacketFrame(ready, 60, 24, { color: false }), /路由都打过卡了，走到G服务器就能通关/);
  for (const [columns, rows] of sizes) {
    const low = renderPacketFrame({ ...game, ttl: 1, message: "数据包前进了一步。" }, columns, rows, { color: false });
    assert.match(low, /TTL（体力）只剩1/);
    const notice = "下一步向右；还需 38 步，消耗 44 点 TTL（体力）。";
    const hint = renderPacketFrame(game, columns, rows, { notice, color: false });
    assert.ok(hint.replace(/\s/g, "").includes(notice.replace(/\s/g, "")));
    assert.doesNotMatch(hint, /你是\[\]，两个R路由各打卡/);
    assert.match(hint, /T\s*提示/);
  }
});

test("results show local best, hints, score comparisons and replay at every supported size", () => {
  const won = deliver(createGame("yuna"));
  for (const [columns, rows] of sizes) {
    const result = renderPacketFrame(won, columns, rows, { hints: 3, best: { score: 999, moves: 35, hints: 1 }, last: { score: won.score - 25, moves: won.moves + 2, hints: 8 }, color: false });
    assert.match(result, /提示3/);
    assert.match(result, /本地(?:同图)?最佳[： ]999\s*分\s*\/\s*35\s*步\s*\/\s*提示1次/);
    assert.match(result, /与本图上次通关相比 \+25分 \/ 少2步/);
    assert.match(result, /Enter\s*\/\s*R.*重玩/);
    assert.match(result, /Q \/ Esc 退出/);
    assert.doesNotMatch(result, /WASD|P \/ Space|还差.*打卡点|自动|demo|E 自动/);
    assert.ok(mapLines(result).join("\n").includes("r"));
    assert.ok(mapLines(result).join("\n").includes("OK"));
    if (columns >= 60) {
      assert.ok(result.includes(`送达！${won.moves} 步，${won.score} 分。`));
      assert.match(result, /复盘：拥塞\d+次，多耗\d+ TTL；丢包\d+次；R还差0/);
      const review = renderPacketFrame(won, columns, rows, { review: true, color: false });
      assert.match(review, /路由打卡 200 \+ 缓存奖励 \d+ \+ 送达 200/);
      assert.match(review, /TTL加分 \d+ \+ 重传加分 \d+；总分 \d+/);
    } else assert.ok(result.includes(`得分${won.score} 已走${won.moves}步 提示3次`));
    const lost = renderPacketFrame({ ...won, status: "lost", message: "没有重传机会（护盾）又遇到丢包，数据包丢失了。换条路再试。" }, columns, rows, { color: false });
    assert.match(lost, /没(?:有)?重传(?:机会)?（护盾）又遇(?:到)?丢包/);
    assert.match(lost, /Enter\s*\/\s*R.*重玩/);
    assert.match(lost, /Q \/ Esc 退出/);
    const expired = renderPacketFrame({ ...won, ttl: -2, status: "lost", message: "TTL（体力）耗尽。" }, columns, rows, { color: false });
    assert.ok(expired.includes(columns < 60 ? "TTL（体力）余0" : `TTL（体力）剩余0 初始${won.maxTtl}`));
    assert.doesNotMatch(expired, /TTL（体力）(?:余|剩余)-2/);
  }
});

test("review keeps the map and shows costs, unfinished routers, save failures and result flavor", () => {
  const initial = createGame("yuna");
  const won = deliver(initial);
  const cell = tile => {
    for (const [y, row] of initial.grid.entries()) {
      const x = row.indexOf(tile);
      if (x >= 0) return `${x},${y}`;
    }
    throw new Error(`missing fixture tile ${tile}`);
  };
  const failed = {
    ...initial, status: "lost", ttl: 0, moves: 3, score: 150,
    message: "TTL（体力）耗尽，数据包超时。",
    trail: [`${initial.start.x},${initial.start.y}`, cell("~"), cell("~"), cell("!")],
    visitedRouters: [`${initial.routers[0].x},${initial.routers[0].y}`],
    collected: [cell("*")],
  };
  const recordStatus = "保存失败，本局成绩仅在本次保留";
  for (const [columns, rows] of sizes) {
    const normal = renderPacketFrame(won, columns, rows, { recordStatus, color: false });
    assert.ok(normal.includes(recordStatus));
    assert.match(normal, /V 复盘/);
    const review = renderPacketFrame(won, columns, rows, { review: true, recordStatus, color: false });
    assert.deepEqual(mapLines(review), mapLines(normal));
    assert.ok(review.includes(getPacketEasterEgg(won)));
    assert.match(review, /V\s*\/\s*Esc.*成绩/);
    assert.match(review, /Q\s*退出/);
    const help = renderPacketFrame(won, columns, rows, { help: true, review: true, color: false });
    assert.match(help, /返回复盘/);
    assert.deepEqual(mapLines(help), mapLines(review));
    const failedReview = renderPacketFrame(failed, columns, rows, { review: true, color: false });
    assert.match(failedReview, /拥塞2次，多耗4 TTL；丢包1次/);
    assert.match(failedReview, /R路由还差1个；缓存收集1\/\d+/);
    assert.doesNotMatch(failedReview, /\bACK\b|200 OK|服务器已签收/);
    assert.deepEqual(mapLines(failedReview), mapLines(renderPacketFrame(failed, columns, rows, { color: false })));
    const colored = renderPacketFrame(won, columns, rows, { recordStatus, color: true });
    assert.ok(colored.includes(`\x1b[1;31m${recordStatus}\x1b[0m`));
  }
});

test("large cells have visible boundaries and the player remains distinct in either color mode", () => {
  const game = createGame("yuna");
  for (const [columns, rows] of [[120, 40], [180, 60], [240, 80]]) {
    const plain = renderPacketFrame(game, columns, rows, { color: false });
    const colored = renderPacketFrame(game, columns, rows, { color: true });
    assert.equal(stripAnsi(colored), plain);
    const map = mapLines(plain).join("\n");
    assert.match(map, /╔═+╗/);
    assert.match(map, /╚═+╝/);
    assert.ok(map.match(/┌/g).length > 1);
    assert.match(map, /·/);
    assert.doesNotMatch(map, /#/);
    assert.match(colored, /\x1b\[1;7m/);
    const codes = [...colored.matchAll(/\x1b\[([0-9;]+)m/g)].flatMap(match => match[1].split(";").map(Number));
    assert.ok(codes.every(code => code < 90 && code !== 37), "text does not assume a dark terminal background");
  }
  const compact = mapLines(renderPacketFrame(game, 42, 18, { color: false })).join("\n");
  assert.match(compact, /\[\]/);
  assert.doesNotMatch(compact, /╔|╚/);
});

test("hints and previous successful runs remain visible without changing score or map", () => {
  const game = createGame("yuna");
  const won = deliver(game);
  for (const [columns, rows] of sizes) {
    const frame = renderPacketFrame(game, columns, rows, { hints: 7, color: false });
    assert.match(frame, /提示7/);
    assert.deepEqual(mapLines(frame), mapLines(renderPacketFrame(game, columns, rows, { color: false })));
    const first = renderPacketFrame(won, columns, rows, { hints: 0, best: { score: won.score, moves: won.moves }, color: false });
    assert.match(first, /本图首次通关，暂无上次成绩可比较。/);
    assert.match(first, /提示0/);
    const slower = renderPacketFrame(won, columns, rows, { hints: 2, best: { score: won.score + 20, moves: won.moves - 3, hints: 0 }, last: { score: won.score + 20, moves: won.moves - 3, hints: 0 }, color: false });
    assert.match(slower, /与本图上次通关相比 -20分 \/ 多3步/);
    const tied = renderPacketFrame(won, columns, rows, { hints: 4, last: { score: won.score, moves: won.moves, hints: 2 }, color: false });
    assert.match(tied, /与本图上次通关相比 \+0分 \/ 步数一样/);
    const improved = renderPacketFrame(won, columns, rows, { previousBest: { score: won.score - 1, moves: won.moves }, color: false });
    assert.match(improved, /新纪录/);
    const fewerHints = renderPacketFrame(won, columns, rows, { hints: 1, previousBest: { score: won.score, moves: won.moves, hints: 2 }, color: false });
    assert.match(fewerHints, /新纪录/);
  }
});

test("resize and shorter status frames overwrite every cell of the new viewport", () => {
  let game = createGame("地图种子".repeat(16));
  const initial = structuredClone(game);
  for (const [columns, rows] of [...sizes, ...[...sizes].reverse()]) {
    const initialFrame = renderPacketFrame(initial, columns, rows, { color: false });
    game = deliver(initial);
    const result = renderPacketFrame(game, columns, rows, { color: false });
    const before = initialFrame.split("\n");
    const after = result.split("\n");
    assert.equal(before.length, after.length);
    for (let row = 0; row < after.length; row++) {
      assert.equal(displayWidth(before[row]), columns - 1);
      assert.equal(displayWidth(after[row]), columns - 1);
    }
    assert.doesNotMatch(after.slice(-6).join("\n"), /你是\[\]，两个R路由各打卡|再到G终点/);
  }
});
