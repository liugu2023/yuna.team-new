import assert from "node:assert/strict";
import test from "node:test";
import { PACKET_RULESET, createGame, getScoreBreakdown, movePacket, solveGame } from "../dist/games/packet-engine.js";

function fixture(grid, overrides = {}) {
  const find = (symbol) => grid.flatMap((row, y) => [...row].flatMap((cell, x) => cell === symbol ? [{ x, y }] : []));
  const start = find("S")[0];
  const goal = find("G")[0];
  return {
    ...createGame("fixture"), grid, start, position: start, goal, routers: find("R"),
    ttl: 30, maxTtl: 30, trail: [`${start.x},${start.y}`], ...overrides,
  };
}

test("packet maps are reproducible and distinct seeds change the layout", () => {
  assert.deepEqual(createGame("燕大网络协会"), createGame("燕大网络协会"));
  assert.notDeepEqual(createGame("alpha").grid, createGame("beta").grid);
});

test("the v2 ruleset preserves the original yuna practice map and its TTL", () => {
  assert.equal(PACKET_RULESET, "packet-v2");
  const game = createGame("yuna");
  assert.deepEqual(game.grid, [
    "###################",
    "#S#........+.....R#",
    "#*#.###.#######.#.#",
    "#+..!..!#....~!...#",
    "###.###~#.###.#.#.#",
    "#~..*..~......#...#",
    "#*#.#########.#*#~#",
    "#R~......!.......G#",
    "###################",
  ]);
  assert.deepEqual(game.start, { x: 1, y: 1 });
  assert.deepEqual(game.goal, { x: 17, y: 7 });
  assert.deepEqual(game.routers, [{ x: 17, y: 1 }, { x: 1, y: 7 }]);
  assert.equal(game.ttl, 58);
  assert.equal(game.maxTtl, 58);
});

test("100 seeded maps spread objectives out and allow both safe router orders within TTL", () => {
  const spawns = new Set();
  const goals = new Set();
  const routerLayouts = new Set();
  for (let i = 0; i < 100; i += 1) {
    const initial = createGame(`packet-test-${i}`);
    assert.equal(initial.grid.length, 9);
    assert.ok(initial.grid.every((row) => row.length === 19));
    assert.equal(initial.grid[0], "#".repeat(19));
    assert.equal(initial.grid[8], "#".repeat(19));
    assert.ok(initial.grid.every((row) => row.startsWith("#") && row.endsWith("#")));
    assert.equal(initial.routers.length, 2);
    assert.ok(initial.ttl < 150);
    const objectives = [initial.start, initial.goal, ...initial.routers];
    for (let a = 0; a < objectives.length; a++) {
      for (let b = a + 1; b < objectives.length; b++) {
        const distance = Math.abs(objectives[a].x - objectives[b].x) + Math.abs(objectives[a].y - objectives[b].y);
        assert.ok(distance >= 6, `seed ${i}: objectives are too close`);
      }
    }
    assert.equal(initial.grid[initial.start.y][initial.start.x], "S");
    assert.equal(initial.grid[initial.goal.y][initial.goal.x], "G");
    for (const router of initial.routers) assert.equal(initial.grid[router.y][router.x], "R");
    for (const [symbol, count] of [["S", 1], ["G", 1], ["R", 2], ["~", 6], ["!", 4], ["+", 2], ["*", 4]]) {
      assert.equal([...initial.grid.join("")].filter(cell => cell === symbol).length, count, `seed ${i}: ${symbol}`);
    }
    const route = solveGame(initial);
    assert.ok(route && route.length >= 24);
    const complete = route.reduce(movePacket, initial);
    assert.equal(complete.status, "won", `seed ${i}`);
    assert.equal(complete.visitedRouters.length, 2);
    assert.equal(complete.retries >= 2, true, "solver must never enter a loss tile");
    assert.equal(initial.moves, 0, "moves must not mutate the input state");
    assert.deepEqual(initial.visitedRouters, []);
    for (let first = 0; first < 2; first++) {
      const blocked = initial.routers[1 - first];
      const grid = initial.grid.map((row, y) => y === blocked.y
        ? row.slice(0, blocked.x) + "#" + row.slice(blocked.x + 1) : row);
      // Reach either router without touching the other, then finish the real game.
      const approach = solveGame({ ...initial, grid, routers: [], goal: initial.routers[first] });
      assert.ok(approach, `seed ${i}: router ${first} cannot be visited first`);
      const reached = approach.reduce(movePacket, initial);
      assert.deepEqual(reached.visitedRouters, [`${initial.routers[first].x},${initial.routers[first].y}`]);
      const remainder = solveGame(reached);
      assert.ok(remainder, `seed ${i}: not enough TTL after router ${first}`);
      const delivered = remainder.reduce(movePacket, reached);
      assert.equal(delivered.status, "won");
      assert.ok(delivered.retries >= 2);
      assert.equal(getScoreBreakdown(delivered).total, delivered.score);
    }
    spawns.add(JSON.stringify(initial.start));
    goals.add(JSON.stringify(initial.goal));
    routerLayouts.add(JSON.stringify(initial.routers));
  }
  assert.ok(spawns.size >= 20, "new seeds should move the spawn around the maze");
  assert.ok(goals.size >= 20, "new seeds should move the destination around the maze");
  assert.ok(routerLayouts.size >= 50, "router layouts should vary beyond the corners");
});

test("walls do not consume moves, TTL, rewards or the trail", () => {
  const initial = fixture(["#####", "#SRG#", "#####"]);
  const blocked = movePacket(initial, "up");
  assert.deepEqual({ ...blocked, message: initial.message }, initial);
});

test("both routers are required and each awards points once", () => {
  let state = fixture(["#######", "#SGRR.#", "#######"]);
  state = movePacket(state, "right");
  assert.equal(state.status, "playing");
  state = movePacket(state, "right");
  state = movePacket(state, "left");
  assert.equal(state.status, "playing");
  state = movePacket(state, "right");
  assert.equal(state.score, 100);
  state = movePacket(state, "right");
  assert.equal(state.score, 200);
  state = movePacket(movePacket(state, "left"), "left");
  assert.equal(state.status, "won");
});

test("congestion costs three TTL, and expiry ends the route immediately", () => {
  const initial = fixture(["######", "#S~RG#", "######"], { ttl: 3 });
  const expired = movePacket(initial, "right");
  assert.equal(expired.ttl, 0);
  assert.equal(expired.moves, 1);
  assert.equal(expired.status, "lost");
  assert.equal(solveGame(initial), null);
  assert.strictEqual(movePacket(expired, "right"), expired);
});

test("a packet can arrive exactly at zero TTL, but not below zero", () => {
  const initial = fixture(["#####", "#SRG#", "#####"], { ttl: 2 });
  const complete = movePacket(movePacket(initial, "right"), "right");
  assert.equal(complete.ttl, 0);
  assert.equal(complete.status, "won");
  assert.deepEqual(solveGame(initial), ["right", "right"]);
  const expired = movePacket(fixture(["######", "#S~RG#", "######"], { ttl: 2 }), "right");
  assert.equal(expired.ttl, -1);
  assert.equal(expired.status, "lost");
  assert.strictEqual(movePacket(complete, "left"), complete);
  assert.deepEqual(solveGame(complete), []);
  assert.equal(solveGame(expired), null);
});

test("each entry onto packet loss consumes a retry and zero retries loses", () => {
  let state = fixture(["######", "#S!RG#", "######"], { retries: 1 });
  state = movePacket(state, "right");
  assert.deepEqual(state.position, { x: 2, y: 1 });
  assert.equal(state.retries, 0);
  assert.equal(state.ttl, 29);
  assert.equal(state.status, "playing");
  state = movePacket(movePacket(state, "left"), "right");
  assert.equal(state.status, "lost");
  assert.equal(solveGame(fixture(["######", "#S!RG#", "######"])), null);
});

test("retry pickups and cache rewards cannot be farmed by stepping back", () => {
  let state = fixture(["#######", "#S+*RG#", "#######"]);
  state = movePacket(state, "right");
  assert.equal(state.retries, 3);
  state = movePacket(state, "right");
  assert.equal(state.score, 50);
  state = movePacket(movePacket(state, "left"), "right");
  assert.equal(state.retries, 3);
  assert.equal(state.score, 50);
  assert.equal(state.collected.length, 2);
  const capped = movePacket(fixture(["######", "#S+RG#", "######"], { retries: 3 }), "right");
  assert.equal(capped.retries, 3);
  assert.deepEqual(capped.collected, ["2,1"]);
});

test("solver minimizes TTL, avoids loss, and plans from already visited routers", () => {
  const initial = fixture(["#########", "#SR~~~RG#", "#.......#", "#########"]);
  const advanced = movePacket(initial, "right");
  const route = solveGame(advanced);
  assert.ok(route);
  assert.equal(route[0], "down", "longer clear path costs less than congestion");
  const complete = route.reduce(movePacket, advanced);
  assert.equal(complete.status, "won");
  assert.equal(complete.ttl, 22);
});

test("score breakdown includes collected rewards and pays resource bonuses only on delivery", () => {
  const initial = fixture(["########", "#S*+R.G#", "########"]);
  assert.deepEqual(getScoreBreakdown(initial), { routers: 0, cache: 0, delivery: 0, ttl: 0, retries: 0, total: 0 });
  let game = initial;
  for (let step = 0; step < 5; step++) {
    game = movePacket(game, "right");
    const score = getScoreBreakdown(game);
    assert.equal(score.total, game.score);
    if (game.status === "playing") assert.equal(score.delivery + score.ttl + score.retries, 0);
  }
  assert.equal(game.status, "won");
  assert.deepEqual(getScoreBreakdown(game), { routers: 100, cache: 50, delivery: 200, ttl: 125, retries: 60, total: 535 });
  const expired = movePacket(movePacket({ ...initial, ttl: 2 }, "right"), "right");
  assert.equal(expired.status, "lost");
  assert.deepEqual(getScoreBreakdown(expired), { routers: 0, cache: 50, delivery: 0, ttl: 0, retries: 0, total: 50 });
});
