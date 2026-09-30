import type { GameState } from "./packet-engine.js";

export interface PacketReview {
  congestionVisits: number;
  extraTtl: number;
  lossVisits: number;
  routersRemaining: number;
  cacheCollected: number;
}

function tileAt(game: GameState, location: string): string | undefined {
  const [x, y] = location.split(",").map(Number);
  return game.grid[y]?.[x];
}

/** Count actual entries, including revisits and a final fatal step, without changing the game. */
export function getPacketReview(game: GameState): PacketReview {
  let congestionVisits = 0;
  let lossVisits = 0;
  for (const location of game.trail.slice(1)) {
    const tile = tileAt(game, location);
    if (tile === "~") congestionVisits += 1;
    if (tile === "!") lossVisits += 1;
  }
  const visited = new Set(game.visitedRouters);
  return {
    congestionVisits,
    extraTtl: congestionVisits * 2,
    lossVisits,
    routersRemaining: game.routers.filter(({ x, y }) => !visited.has(`${x},${y}`)).length,
    cacheCollected: [...new Set(game.collected)].filter(location => tileAt(game, location) === "*").length,
  };
}

/** Result flavor only: last-second delivery, all caches, clean route, then a plain ACK. */
export function getPacketEasterEgg(game: GameState): string | undefined {
  if (game.status !== "won") return undefined;
  if (game.ttl === 0) return "TTL=0，ACK 刚好赶到（已送达）。";
  const review = getPacketReview(game);
  const caches = game.grid.reduce((total, row) => total + [...row].filter(tile => tile === "*").length, 0);
  if (caches > 0 && review.cacheCollected === caches) return "缓存命中率 100%，一个奖励也没落下。";
  if (review.congestionVisits === 0 && review.lossVisits === 0) return "200 OK：一路畅通，服务器已签收。";
  return "ACK！服务器已签收，数据包可以下班了。";
}
