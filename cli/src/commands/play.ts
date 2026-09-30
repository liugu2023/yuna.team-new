import { randomBytes } from "node:crypto";
import { UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { createGame, getScoreBreakdown, PACKET_RULESET, type GameState } from "../games/packet-engine.js";
import { createPacketController } from "../games/packet-controller.js";
import { loadPacketRecords, savePacketResultOutcome } from "../games/packet-records.js";
import { MIN_COLUMNS, MIN_ROWS, renderPacketFrame } from "../games/packet-renderer.js";
import { runTerminalSession } from "../games/terminal-session.js";

function snapshot(game: GameState) {
  return {
    game: "packet", ruleset: PACKET_RULESET, seed: game.seed, status: game.status, ttl: game.ttl, maxTtl: game.maxTtl,
    retries: game.retries, moves: game.moves, score: game.score,
    routersVisited: game.visitedRouters.length, routersTotal: game.routers.length,
    position: game.position, goal: game.goal, grid: game.grid, scoreBreakdown: getScoreBreakdown(game),
  };
}

export async function runPlay(ctx: CommandContext): Promise<void> {
  if (ctx.positionals[0] !== "packet") throw new UsageError("目前只有数据包冒险：yuna play packet。用 --help 查看玩法。");
  const seed = (ctx.flags.seed ?? randomBytes(3).toString("hex")).trim();
  if (!seed || seed.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(seed)) throw new UsageError("地图名字需要 1–64 个字符，不能含换行等特殊控制符。");
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stdin.setRawMode);

  if (ctx.flags.json) {
    ctx.out(JSON.stringify(snapshot(createGame(seed)), null, 2));
    return;
  }
  if (!interactive) throw new UsageError("小游戏需要真实交互终端。请在 PowerShell / Windows Terminal / WSL 中运行 yuna play packet；也可加 --json 查看初始地图。");

  const loaded = await loadPacketRecords();
  let recordWarning = loaded.warning;
  let recordStatus: string | undefined;
  let recordedGame: GameState | undefined;
  let refresh = (): void => {};
  let saveRevision = 0;
  let pendingSaves = Promise.resolve();
  const controller = createPacketController({ seed, records: loaded.records, onResult: (resultSeed, result) => {
    const revision = ++saveRevision;
    recordedGame = controller.getState().game;
    recordStatus = "正在保存成绩…";
    refresh();
    pendingSaves = pendingSaves.then(async () => {
      try {
        const outcome = await savePacketResultOutcome(resultSeed, result);
        if (outcome.status !== "saved") recordWarning = outcome.message;
        if (revision === saveRevision) {
          recordStatus = outcome.status === "saved" ? "成绩已保存"
            : outcome.status === "busy" ? "未保存：成绩文件被占用"
            : "未保存：请检查本地成绩文件";
        }
      } catch {
        recordWarning = "本地成绩未能保存，本次成绩仅在当前会话中保留。";
        if (revision === saveRevision) recordStatus = "未保存：本局成绩仅在本次保留";
      }
      refresh();
    });
  } });
  let columns = process.stdout.columns || 80;
  let rows = process.stdout.rows || 24;
  const fits = (): boolean => columns >= MIN_COLUMNS && rows >= MIN_ROWS;
  try {
    await runTerminalSession({
      render: (nextColumns, nextRows) => {
        columns = nextColumns; rows = nextRows;
        const { game: current, ...view } = controller.getState();
        return renderPacketFrame(current, columns, rows, { ...view,
          recordStatus: current === recordedGame ? recordStatus : loaded.warning ? "本地成绩暂时无法读取" : undefined,
        });
      },
      onKey: key => controller.onKey(key, fits()),
      onReady: redraw => { refresh = redraw; },
    });
  } finally {
    await pendingSaves;
    if (recordWarning) process.stderr.write(`提示：${recordWarning}\n`);
  }
  const { game, hints } = controller.getState();
  ctx.out(`数据包冒险 · ${game.status === "won" ? "投递成功" : game.status === "lost" ? "投递失败" : "已退出"} · ${game.moves} 步 · ${game.score} 分 · 提示 ${hints} 次 · 地图: ${game.seed}`);
}
