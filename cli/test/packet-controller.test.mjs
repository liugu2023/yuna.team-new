import assert from "node:assert/strict";
import test from "node:test";
import { createPacketController } from "../dist/games/packet-controller.js";
import { movePacket, solveGame } from "../dist/games/packet-engine.js";
import { displayWidth, wrapText } from "../dist/ui.js";

const press = (controller, name, extra = {}) => controller.onKey({ name, ...extra });
const reverse = { up: "down", down: "up", left: "right", right: "left" };
const labels = { up: "上 ↑", down: "下 ↓", left: "左 ←", right: "右 →" };

function deliver(controller) {
  const route = solveGame(controller.getState().game);
  assert.ok(route);
  for (const direction of route) press(controller, direction);
  assert.equal(controller.getState().game.status, "won");
}

test("hints plan from the current packet without moving or spending TTL", () => {
  const controller = createPacketController({ seed: "yuna" });
  press(controller, solveGame(controller.getState().game)[0]);
  const before = controller.getState().game;
  const route = solveGame(before);
  const complete = route.reduce(movePacket, before);
  press(controller, "t");
  const hinted = controller.getState();
  assert.strictEqual(hinted.game, before);
  assert.equal(hinted.hints, 1);
  assert.ok(hinted.notice.includes(`下一步向${labels[route[0]]}`));
  assert.ok(hinted.notice.includes(`${route.length} 步`));
  assert.ok(hinted.notice.includes(`${before.ttl - complete.ttl} 点 TTL（体力）`));
  const longestHint = hinted.notice.replace(/\d+/g, "999");
  assert.ok(displayWidth(longestHint) <= 78);
  assert.ok(wrapText(longestHint, 39).length <= 2);
  press(controller, route[0]);
  assert.equal(controller.getState().notice, undefined);
});

test("hints count only new playable positions and reset on replay", () => {
  const controller = createPacketController({ seed: "yuna" });
  const initial = controller.getState().game;
  press(controller, "t");
  press(controller, "t");
  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const wall = Object.keys(delta).find(direction => {
    const [dx, dy] = delta[direction];
    return initial.grid[initial.position.y + dy]?.[initial.position.x + dx] === "#";
  });
  assert.ok(wall);
  press(controller, wall);
  press(controller, "t");
  assert.equal(controller.getState().hints, 1);
  const direction = solveGame(controller.getState().game)[0];
  press(controller, direction);
  press(controller, "t");
  assert.equal(controller.getState().hints, 2);
  press(controller, "r");
  assert.equal(controller.getState().hints, 0);
  press(controller, "t");
  assert.equal(controller.getState().hints, 1);
});

test("a delivery after using hints still earns a record", () => {
  const controller = createPacketController({ seed: "yuna" });
  press(controller, "t");
  deliver(controller);
  const { game, best } = controller.getState();
  assert.deepEqual(best, { score: game.score, moves: game.moves, hints: 1 });
});

test("a failed delivery stays visible and Enter starts a fresh attempt", () => {
  const controller = createPacketController({ seed: "yuna" });
  let direction = solveGame(controller.getState().game)[0];
  while (controller.getState().game.status === "playing") {
    press(controller, direction);
    direction = reverse[direction];
  }
  const failed = controller.getState();
  assert.equal(failed.game.status, "lost");
  assert.equal(failed.best, undefined);
  for (const name of ["p", "space", "t", "e", "b", "up"]) press(controller, name);
  assert.deepEqual(controller.getState(), failed);
  press(controller, "return");
  const replay = controller.getState();
  assert.equal(replay.game.status, "playing");
  assert.equal(replay.game.moves, 0);
  assert.equal(replay.game.ttl, replay.game.maxTtl);
  assert.equal(replay.game.seed, failed.game.seed);
});

test("unknown keys including E leave the packet and hint untouched, while A moves left", () => {
  const controller = createPacketController({ seed: "yuna" });
  press(controller, "t");
  const before = controller.getState();
  for (const name of ["e", "E", "x", "v", "tab", "return"]) {
    assert.equal(press(controller, name), undefined);
    assert.deepEqual(controller.getState(), before);
  }
  press(controller, "a");
  assert.deepEqual(controller.getState().game, movePacket(before.game, "left"));
  assert.equal(controller.getState().notice, undefined);
});

test("successful delivery remains at the result until replay or exit", () => {
  const controller = createPacketController({ seed: "yuna" });
  deliver(controller);
  const result = controller.getState();
  assert.equal(result.game.status, "won");
  assert.deepEqual(result.best, { score: result.game.score, moves: result.game.moves, hints: 0 });
  assert.ok(result.easterEgg);
  for (const name of ["p", "space", "t", "e", "b", "left"]) press(controller, name);
  assert.deepEqual(controller.getState(), result);
  press(controller, "h");
  assert.equal(controller.getState().help, true);
  press(controller, "escape");
  assert.deepEqual(controller.getState(), result);
  press(controller, "return");
  assert.equal(controller.getState().game.status, "playing");
  assert.equal(controller.getState().easterEgg, undefined);
  assert.equal(controller.getState().game.seed, "yuna");
});

test("help preserves pause and P from help resumes without a hidden pause", () => {
  const controller = createPacketController({ seed: "yuna" });
  const before = controller.getState().game;
  const direction = solveGame(before)[0];
  press(controller, "p");
  press(controller, "h");
  press(controller, direction);
  assert.strictEqual(controller.getState().game, before);
  press(controller, "h");
  assert.equal(controller.getState().help, false);
  assert.equal(controller.getState().paused, true);
  press(controller, direction);
  assert.strictEqual(controller.getState().game, before);
  press(controller, "h");
  press(controller, "p");
  assert.equal(controller.getState().help, false);
  assert.equal(controller.getState().paused, false);
  press(controller, direction);
  assert.deepEqual(controller.getState().game, movePacket(before, direction));
});

test("Esc dismisses help, then pause, before exiting; Q always exits", () => {
  const controller = createPacketController({ seed: "yuna" });
  press(controller, "p");
  press(controller, undefined, { sequence: "?" });
  assert.equal(press(controller, "escape"), undefined);
  assert.equal(controller.getState().help, false);
  assert.equal(controller.getState().paused, true);
  assert.equal(press(controller, "escape"), undefined);
  assert.equal(controller.getState().paused, false);
  assert.equal(press(controller, "escape"), "exit");
  press(controller, "h");
  assert.equal(press(controller, "q"), "exit");
});

test("pause, help and an undersized terminal stop movement and hint changes", () => {
  for (const blocker of ["p", "h", "resize"]) {
    const controller = createPacketController({ seed: "yuna" });
    const fits = blocker !== "resize";
    if (fits) press(controller, blocker);
    const before = controller.getState();
    const direction = solveGame(before.game)[0];
    controller.onKey({ name: direction }, fits);
    controller.onKey({ name: "t" }, fits);
    controller.onKey({ name: "b" }, fits);
    assert.deepEqual(controller.getState(), before);
    if (fits) press(controller, blocker);
    press(controller, direction);
    assert.deepEqual(controller.getState().game, movePacket(before.game, direction));
  }
});

test("Ctrl and Alt combinations never move, restart, change mode or quit", () => {
  const controller = createPacketController({ seed: "yuna" });
  const before = controller.getState();
  for (const modifier of ["ctrl", "meta"]) {
    for (const name of ["a", "s", "left", "r", "n", "p", "h", "t", "e", "b", "v", "q", "escape"]) {
      assert.equal(press(controller, name, { [modifier]: true }), undefined);
      assert.deepEqual(controller.getState(), before);
    }
  }
});

test("B gives a local server echo without moving, spending resources or counting a hint", () => {
  const controller = createPacketController({ seed: "yuna" });
  press(controller, "t");
  const before = controller.getState();
  press(controller, "b");
  const echoed = controller.getState();
  assert.match(echoed.notice, /^PONG！服务器说：我在终点等你。$/);
  assert.deepEqual({ ...echoed, notice: before.notice }, before);
  assert.ok(wrapText(echoed.notice, 39).length <= 2);
  press(controller, "B");
  assert.deepEqual(controller.getState(), echoed);
  press(controller, solveGame(echoed.game)[0]);
  assert.equal(controller.getState().notice, undefined);
  press(controller, "b");
  press(controller, "r");
  assert.equal(controller.getState().notice, undefined);
  assert.equal(controller.getState().easterEgg, undefined);
});

test("V switches finished games between results and review while help and Esc preserve the page stack", () => {
  for (const outcome of ["won", "lost"]) {
    const controller = createPacketController({ seed: "yuna" });
    if (outcome === "won") deliver(controller);
    else {
      let direction = solveGame(controller.getState().game)[0];
      while (controller.getState().game.status === "playing") {
        press(controller, direction);
        direction = reverse[direction];
      }
    }
    const result = controller.getState();
    assert.equal(result.game.status, outcome);
    assert.equal(result.review, false);
    for (const modifier of ["ctrl", "meta"]) {
      press(controller, "v", { [modifier]: true });
      assert.deepEqual(controller.getState(), result);
    }
    press(controller, "v");
    assert.deepEqual(controller.getState(), { ...result, review: true });
    press(controller, "v");
    assert.deepEqual(controller.getState(), result);
    press(controller, "v");
    press(controller, "h");
    press(controller, "v");
    assert.deepEqual(controller.getState(), { ...result, review: true, help: true });
    press(controller, "h");
    assert.deepEqual(controller.getState(), { ...result, review: true });
    press(controller, "h");
    assert.equal(press(controller, "escape"), undefined);
    assert.deepEqual(controller.getState(), { ...result, review: true });
    assert.equal(press(controller, "escape"), undefined);
    assert.deepEqual(controller.getState(), result);
    assert.equal(press(controller, "escape"), "exit");
  }
});

test("replay and new-map controls leave the review page and start with review disabled", () => {
  for (const key of ["r", "return", "n"]) {
    const controller = createPacketController({ seed: "yuna", nextSeed: () => "fresh-map" });
    deliver(controller);
    press(controller, "v");
    assert.equal(controller.getState().review, true);
    press(controller, key);
    const replay = controller.getState();
    assert.equal(replay.review, false);
    assert.equal(replay.game.status, "playing");
    assert.equal(replay.game.seed, key === "n" ? "fresh-map" : "yuna");
    press(controller, "v");
    assert.deepEqual(controller.getState(), replay);
  }
});

test("no safe route explains the remaining risky choice without claiming no solution", () => {
  const controller = createPacketController({ seed: "yuna" });
  const outward = solveGame(controller.getState().game)[0];
  let direction = outward;
  while (solveGame(controller.getState().game)) {
    press(controller, direction);
    direction = reverse[direction];
    assert.equal(controller.getState().game.status, "playing");
  }
  const before = controller.getState().game;
  press(controller, "t");
  const notice = controller.getState().notice;
  assert.match(notice, /TTL（体力）不够绕开所有丢包点.*!! 近路.*R 重来/);
  assert.ok(displayWidth(notice) <= 78);
  assert.ok(wrapText(notice, 39).length <= 2);
  assert.strictEqual(controller.getState().game, before);
  assert.equal(controller.getState().hints, 0);
});

test("replays keep each seed's best delivery and reset game controls", () => {
  const seeds = ["other-seed", "yuna"];
  const controller = createPacketController({ seed: "yuna", nextSeed: () => seeds.shift() });
  const outward = solveGame(controller.getState().game)[0];
  press(controller, outward);
  press(controller, reverse[outward]);
  deliver(controller);
  const slower = controller.getState().best;
  press(controller, "r");
  assert.deepEqual(controller.getState().best, slower);
  deliver(controller);
  const faster = controller.getState().best;
  assert.ok(faster.score > slower.score);
  assert.ok(faster.moves < slower.moves);
  press(controller, "r");
  press(controller, outward);
  press(controller, reverse[outward]);
  deliver(controller);
  assert.deepEqual(controller.getState().best, faster);
  press(controller, "n");
  assert.equal(controller.getState().game.seed, "other-seed");
  assert.equal(controller.getState().best, undefined);
  press(controller, "n");
  assert.deepEqual(controller.getState().best, faster);
  press(controller, "t");
  press(controller, "p");
  press(controller, "h");
  press(controller, "r");
  const replay = controller.getState();
  assert.equal(replay.game.moves, 0);
  assert.equal(replay.help, false);
  assert.equal(replay.paused, false);
  assert.equal(replay.hints, 0);
  assert.equal(replay.notice, undefined);
  assert.deepEqual(replay.best, faster);
});

test("snapshots and prior records remain stable as the session advances", () => {
  const controller = createPacketController({ seed: "yuna" });
  const initial = controller.getState();
  deliver(controller);
  assert.equal(initial.game.moves, 0);
  assert.equal(initial.best, undefined);
  const result = controller.getState();
  const expected = { ...result.best };
  result.best.score = -1;
  assert.deepEqual(controller.getState().best, expected);
  press(controller, "r");
  assert.equal(result.game.status, "won");
});

test("loaded records and previous-run comparisons stay stable until a replay", () => {
  const previous = { score: 500, moves: 60, hints: 2 };
  const oldBest = { score: 9999, moves: 20, hints: 0 };
  const records = new Map([["yuna", { best: oldBest, last: previous }]]);
  const saved = [];
  const controller = createPacketController({ seed: "yuna", records, onResult: (seed, result) => saved.push([seed, result]) });
  assert.deepEqual(controller.getState().last, previous);
  assert.deepEqual(controller.getState().previousBest, oldBest);
  press(controller, "t");
  deliver(controller);
  const finished = controller.getState();
  const result = { score: finished.game.score, moves: finished.game.moves, hints: 1 };
  assert.deepEqual(finished.last, previous);
  assert.deepEqual(finished.previousBest, oldBest);
  assert.deepEqual(finished.best, oldBest);
  assert.deepEqual(saved, [["yuna", result]]);
  for (const direction of ["up", "down", "left", "right"]) press(controller, direction);
  assert.equal(saved.length, 1);
  assert.deepEqual(records.get("yuna"), { best: oldBest, last: previous });
  press(controller, "r");
  assert.deepEqual(controller.getState().last, result);
  assert.deepEqual(controller.getState().previousBest, oldBest);
  assert.equal(controller.getState().hints, 0);
});

test("equal score and hops favor fewer hints, and callback errors do not interrupt delivery", () => {
  for (const onResult of [() => { throw new Error("disk unavailable"); }, async () => { throw new Error("disk unavailable"); }]) {
    const controller = createPacketController({ seed: "yuna", onResult });
    press(controller, "t");
    deliver(controller);
    const hinted = controller.getState().best;
    assert.equal(hinted.hints, 1);
    press(controller, "r");
    deliver(controller);
    assert.deepEqual(controller.getState().best, { ...hinted, hints: 0 });
    assert.deepEqual(controller.getState().previousBest, hinted);
    assert.deepEqual(controller.getState().last, hinted);
  }
});

test("failed and abandoned attempts never replace the last successful result or invoke saving", () => {
  const previous = { score: 900, moves: 35, hints: 0 };
  const records = new Map([["yuna", { best: previous, last: previous }]]);
  let saves = 0;
  const controller = createPacketController({ seed: "yuna", records, onResult: () => { saves += 1; } });
  let direction = solveGame(controller.getState().game)[0];
  while (controller.getState().game.status === "playing") {
    press(controller, direction);
    direction = reverse[direction];
  }
  assert.deepEqual(controller.getState().last, previous);
  assert.deepEqual(controller.getState().best, previous);
  press(controller, "r");
  assert.deepEqual(controller.getState().last, previous);
  assert.equal(press(controller, "q"), "exit");
  assert.equal(saves, 0);
});
