import { randomBytes } from "node:crypto";
import { createGame, movePacket, solveGame, type Direction, type GameState } from "./packet-engine.js";
import { isBetterPacketResult, type PacketRecords, type PacketResult } from "./packet-records.js";
import { getPacketEasterEgg } from "./packet-review.js";
import type { TerminalKey } from "./terminal-session.js";

export interface PacketControllerState {
  game: GameState;
  paused: boolean;
  help: boolean;
  review: boolean;
  hints: number;
  notice?: string;
  easterEgg?: string;
  best?: PacketResult;
  last?: PacketResult;
  previousBest?: PacketResult;
}

export interface PacketControllerOptions {
  seed: string;
  nextSeed?: () => string;
  records?: PacketRecords;
  onResult?: (seed: string, result: PacketResult) => void;
}

const directions: Record<string, Direction> = {
  up: "up", w: "up", down: "down", s: "down",
  left: "left", a: "left", right: "right", d: "right",
};
const directionLabels: Record<Direction, string> = { up: "上 ↑", down: "下 ↓", left: "左 ←", right: "右 →" };
const noSafeRoute = "TTL（体力）不够绕开所有丢包点。可试 !! 近路，或按 R 重来。";

/** Owns one play session, including replay records, without timers or terminal I/O. */
export function createPacketController(options: PacketControllerOptions) {
  let game = createGame(options.seed);
  let paused = false;
  let help = false;
  let review = false;
  let hints = 0;
  let hintedAt: string | undefined;
  let notice: string | undefined;
  const records: PacketRecords = new Map([...(options.records ?? [])].map(([seed, record]) => [seed, {
    best: record.best && { ...record.best }, last: record.last && { ...record.last },
  }]));
  let last = records.get(game.seed)?.last;
  let previousBest = records.get(game.seed)?.best;
  const nextSeed = options.nextSeed ?? (() => randomBytes(3).toString("hex"));

  const restart = (seed: string): void => {
    game = createGame(seed);
    paused = false;
    help = false;
    review = false;
    hints = 0;
    hintedAt = undefined;
    notice = undefined;
    last = records.get(seed)?.last;
    previousBest = records.get(seed)?.best;
  };

  const advance = (direction: Direction): void => {
    notice = undefined;
    game = movePacket(game, direction);
    if (game.status === "won") {
      const result = { score: game.score, moves: game.moves, hints };
      const best = records.get(game.seed)?.best;
      records.set(game.seed, { best: isBetterPacketResult(result, best) ? result : best, last: result });
      try {
        void Promise.resolve(options.onResult?.(game.seed, { ...result })).catch(() => {});
      } catch { /* Recording must never interrupt a completed game. */ }
    }
  };

  return {
    getState(): PacketControllerState {
      const best = records.get(game.seed)?.best;
      return { game, paused, help, review, hints, notice, easterEgg: getPacketEasterEgg(game), best: best && { ...best }, last: last && { ...last }, previousBest: previousBest && { ...previousBest } };
    },

    onKey(key: TerminalKey, fits = true): "exit" | void {
      if (key.ctrl || key.meta) return;
      const name = key.name?.toLowerCase();
      if (name === "q") return "exit";
      if (name === "escape") {
        if (help) help = false;
        else if (review) review = false;
        else if (paused) paused = false;
        else return "exit";
        return;
      }
      if (name === "r") { restart(game.seed); return; }
      if (name === "n") { restart(nextSeed()); return; }
      if (name === "return" && game.status !== "playing") { restart(game.seed); return; }
      if (name === "h" || key.sequence === "?") { help = !help; return; }
      if (name === "v" && game.status !== "playing" && !help) { review = !review; return; }
      if (game.status !== "playing") return;
      if (name === "p" || name === "space") {
        if (help) { help = false; paused = false; }
        else paused = !paused;
        return;
      }
      if (!name || paused || help || !fits) return;
      if (name === "b") {
        notice = "PONG！服务器说：我在终点等你。";
        return;
      }
      if (name === "t") {
        const hint = solveGame(game);
        if (!hint?.length) notice = noSafeRoute;
        else {
          const location = `${game.moves}:${game.position.x},${game.position.y}`;
          if (hintedAt !== location) { hints += 1; hintedAt = location; }
          const delivery = hint.reduce(movePacket, game);
          notice = `下一步向${directionLabels[hint[0]]}；还需 ${hint.length} 步，消耗 ${game.ttl - delivery.ttl} 点 TTL（体力）。`;
        }
        return;
      }
      const direction = directions[name];
      if (direction) advance(direction);
    },
  };
}
