import assert from "node:assert/strict";
import test from "node:test";
import { createGame, movePacket } from "../dist/games/packet-engine.js";
import { getPacketEasterEgg, getPacketReview } from "../dist/games/packet-review.js";
import { displayWidth, wrapText } from "../dist/ui.js";

function fixture(grid, overrides = {}) {
  const find = symbol => grid.flatMap((row, y) => [...row].flatMap((tile, x) => tile === symbol ? [{ x, y }] : []));
  const start = find("S")[0];
  return {
    ...createGame("review"), grid, start, position: start, goal: find("G")[0], routers: find("R"),
    visitedRouters: [], collected: [], ttl: 40, maxTtl: 40, trail: [`${start.x},${start.y}`], ...overrides,
  };
}

const walk = (game, directions) => directions.reduce(movePacket, game);

test("review counts repeated congestion and loss visits, excluding supply pickups and duplicate caches", () => {
  const initial = fixture(["##########", "#S~!*+R.G#", "##########"]);
  assert.deepEqual(getPacketReview(initial), { congestionVisits: 0, extraTtl: 0, lossVisits: 0, routersRemaining: 1, cacheCollected: 0 });
  const complete = walk(initial, ["right", "left", "right", "right", "right", "left", "right", "right", "right", "right", "right"]);
  assert.equal(complete.status, "won");
  assert.equal(complete.retries, 1, "supply restores a shield without erasing previous losses");
  assert.equal(complete.collected.length, 2, "both a cache and a supply were collected");
  const before = structuredClone(complete);
  assert.deepEqual(getPacketReview(complete), { congestionVisits: 2, extraTtl: 4, lossVisits: 2, routersRemaining: 0, cacheCollected: 1 });
  assert.deepEqual(complete, before);
});

test("a fatal final tile is included in the review, while blocked moves add no visits", () => {
  for (const [tile, overrides, expected] of [
    ["!", { retries: 0 }, { congestionVisits: 0, extraTtl: 0, lossVisits: 1, routersRemaining: 1, cacheCollected: 0 }],
    ["~", { ttl: 3 }, { congestionVisits: 1, extraTtl: 2, lossVisits: 0, routersRemaining: 1, cacheCollected: 0 }],
  ]) {
    const initial = fixture(["######", `#S${tile}RG#`, "######"], overrides);
    const blocked = movePacket(initial, "up");
    assert.deepEqual(getPacketReview(blocked), getPacketReview(initial));
    const failed = movePacket(blocked, "right");
    assert.equal(failed.status, "lost");
    assert.deepEqual(getPacketReview(failed), expected);
    assert.equal(getPacketEasterEgg(failed), undefined);
  }
});

test("result eggs prioritize zero TTL, all caches, a clean route, then an ordinary ACK", () => {
  const examples = [
    [fixture(["######", "#S*RG#", "######"], { ttl: 3 }), ["right", "right", "right"], /TTL=0.*ACK/],
    [fixture(["######", "#S*RG#", "######"]), ["right", "right", "right"], /缓存命中率 100%/],
    [fixture(["#####", "#SRG#", "#####"]), ["right", "right"], /200 OK/],
    [fixture(["#######", "#SRG*.#", "#######"]), ["right", "right"], /200 OK/],
    [fixture(["######", "#S~RG#", "######"]), ["right", "right", "right"], /^ACK！服务器已签收/],
    [fixture(["######", "#S!RG#", "######"]), ["right", "right", "right"], /^ACK！服务器已签收/],
  ];
  for (const [initial, directions, pattern] of examples) {
    assert.equal(getPacketEasterEgg(initial), undefined);
    const complete = walk(initial, directions);
    assert.equal(complete.status, "won");
    const before = structuredClone(complete);
    const egg = getPacketEasterEgg(complete);
    assert.match(egg, pattern);
    assert.ok(displayWidth(egg) <= 78);
    assert.ok(wrapText(egg, 39).length <= 2);
    assert.deepEqual(complete, before);
  }
});
