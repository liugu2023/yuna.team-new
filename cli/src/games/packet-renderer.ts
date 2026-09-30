import { COLOR, displayWidth, padEndWidth, truncateWidth, wrapText } from "../ui.js";
import { getScoreBreakdown, type GameState } from "./packet-engine.js";
import { getPacketEasterEgg, getPacketReview } from "./packet-review.js";

export const MIN_COLUMNS = 42;
export const MIN_ROWS = 18;

type PacketRecord = { score: number; moves: number; hints?: number };

export interface PacketView {
  paused?: boolean;
  help?: boolean;
  color?: boolean;
  notice?: string;
  hints?: number;
  best?: PacketRecord;
  last?: PacketRecord;
  previousBest?: PacketRecord;
  review?: boolean;
  recordStatus?: string;
}

/** Reserve the terminal's final column and row to avoid wrapping or scrolling. */
export function renderPacketFrame(game: GameState, columns = 80, rows = 24, view: PacketView = {}): string {
  const width = Math.max(1, Math.floor(columns) - 1);
  const height = Math.max(1, Math.floor(rows) - 1);
  const color = view.color ?? COLOR;
  const paint = (code: string, value: string): string => color ? `\x1b[${code}m${value}\x1b[0m` : value;
  const accent = (text: string): string => paint("1;34", text);
  const green = (text: string): string => paint("1;32", text);
  const attention = (text: string): string => paint("1;35", text);
  const red = (text: string): string => paint("1;31", text);
  const dim = (text: string): string => paint("2", text);
  const label = (text: string): string => paint("1", text);
  const line = (text: string): string => padEndWidth(truncateWidth(text, width), width);
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    const small = ["数据包冒险", `至少 ${MIN_COLUMNS} 列 × ${MIN_ROWS} 行可游玩`, `当前 ${columns} × ${rows}，已暂停`];
    const visible = small.slice(0, Math.max(0, height - 1));
    visible.push(width < 6 ? "Q" : "Q 退出");
    while (visible.length < height) visible.push("");
    return visible.map(line).join("\n");
  }

  const compact = width < 59 || height < 23;
  const playing = game.status === "playing";
  const reviewing = !playing && Boolean(view.review);
  const hints = view.hints ?? 0;
  const newRecord = game.status === "won" && view.previousBest && (game.score > view.previousBest.score
    || (game.score === view.previousBest.score && (game.moves < view.previousBest.moves
      || (game.moves === view.previousBest.moves && hints < (view.previousBest.hints ?? 0)))));
  const remaining = game.routers.filter(({ x, y }) => !game.visitedRouters.includes(`${x},${y}`)).length;
  const complete = remaining === 0;
  const lowTtl = playing && game.ttl / Math.max(1, game.maxTtl) <= 0.25;
  const status = view.help ? compact ? "规则" : "玩法说明"
    : reviewing ? "投递复盘"
    : game.status === "won" ? `投递成功${newRecord ? " · 新纪录" : ""}`
    : game.status === "lost" ? "投递失败"
    : view.paused ? "已暂停" : "正在传输";
  const statusColor = view.help || (playing && view.paused) ? attention
    : game.status === "won" ? green : game.status === "lost" ? red : accent;
  const title = `${accent(width < 79 ? "数据包冒险" : "PACKET RUN  数据包冒险")} · ${statusColor(status)}  ${dim(`地图种子（复现用）：${game.seed}`)}`;
  const ttlRemaining = Math.max(0, game.ttl);
  const shortTtl = (lowTtl ? red : accent)(`${ttlRemaining}${lowTtl ? "!" : ""}`);
  const compactStatus = statusColor(view.paused && playing ? "暂停" : playing ? "传输" : newRecord ? "新纪录" : game.status === "won" ? "成功" : "失败");
  const resources = compact
    ? `${compactStatus} TTL（体力）余${shortTtl} 重传（护盾）余${game.retries}次`
    : `TTL（体力）剩余${shortTtl} 初始${game.maxTtl}；重传（护盾）剩余${game.retries}次`;
  const progress = compact
    ? `路由${game.visitedRouters.length}/${game.routers.length} 得分${game.score} 已走${game.moves}步 提示${hints}次`
    : `路由已过${game.visitedRouters.length}个（共${game.routers.length}个） 得分${game.score}分 已走${game.moves}步 使用提示${hints}次`;
  const objective = game.status === "won" ? "任务完成，数据包已送达G服务器（终点）。"
    : game.status === "lost" ? "这次没送到，重试这张地图，或换一张试试。"
    : complete ? "路由都打过卡了，走到G服务器就能通关。"
    : `还差${remaining}个R路由打卡点，再到G服务器终点。`;
  const introduction = playing && !view.notice && game.message.startsWith("你是");
  const introMessage = "你是[]，两个R路由各打卡，再到G终点。";
  const best = view.best ? compact
    ? `本地最佳 ${view.best.score}分/${view.best.moves}步/提示${view.best.hints ?? 0}次`
    : `本地同图最佳：${view.best.score} 分 / ${view.best.moves} 步 / 提示${view.best.hints ?? 0}次`
    : "本地暂无同图通关记录。";
  const scoreDelta = game.score - (view.last?.score ?? 0);
  const movesDelta = game.moves - (view.last?.moves ?? 0);
  const scoreChange = (scoreDelta > 0 ? green : scoreDelta < 0 ? red : label)(`${scoreDelta >= 0 ? "+" : ""}${scoreDelta}分`);
  const comparison = view.last ? `与本图上次通关相比 ${scoreChange} / ${movesDelta < 0 ? `少${-movesDelta}步` : movesDelta > 0 ? `多${movesDelta}步` : "步数一样"}`
    : game.status === "won" ? "本图首次通关，暂无上次成绩可比较。" : "本图尚无上次通关成绩可比较。";
  const score = getScoreBreakdown(game);
  const report = !playing ? getPacketReview(game) : undefined;
  const easterEgg = !playing ? getPacketEasterEgg(game) : undefined;
  const cacheTotal = game.grid.reduce((total, row) => total + [...row].filter(tile => tile === "*").length, 0);
  const reviewTraffic = report ? `复盘：${(report.congestionVisits ? red : dim)(`拥塞${report.congestionVisits}次，多耗${report.extraTtl} TTL`)}；${(report.lossVisits ? red : dim)(`丢包${report.lossVisits}次`)}` : "";
  const reviewProgress = report ? `${accent(`R路由还差${report.routersRemaining}个`)}；${green(`缓存收集${report.cacheCollected}/${cacheTotal}`)}` : "";
  const reviewSummary = report ? `${reviewTraffic}；${accent(`R还差${report.routersRemaining}`)}` : "";
  const recordLine = view.recordStatus ? (/失败|未保存|仅|只/.test(view.recordStatus) ? red
    : /已保存/.test(view.recordStatus) ? green : dim)(view.recordStatus) : undefined;
  const celebration = easterEgg ? green(easterEgg) : undefined;
  const celebrationAndRecord = celebration && recordLine ? `${celebration} · ${recordLine}` : undefined;
  const resultNote = celebrationAndRecord && displayWidth(celebrationAndRecord) <= width ? celebrationAndRecord
    : recordLine ?? celebration ?? best;
  const shortLoss = game.message.includes("丢包") ? "没重传（护盾）又遇丢包。"
    : game.ttl <= 0 ? "TTL（体力）用完，还没通关。" : game.message.split(/[。！]/u)[0];
  const header = compact ? view.help ? [
    `TTL（体力）初始${game.maxTtl} · 地图种子：${game.seed}`,
    "R先去哪个都行，体力用完未通关才输。",
  ] : reviewing ? [celebration ?? red(`失败复盘：${shortLoss}`), resources] : [resources, progress]
    : [title, resources, progress,
      view.help ? `[]是你；两个${accent("R")}路由各打卡一次(顺序随意)，再到${accent("G")}服务器终点。`
        : reviewing ? celebration ?? red(shortLoss) : !playing ? comparison : objective];

  const returnTo = reviewing ? "复盘" : !playing ? "结果" : view.paused ? "暂停" : "游戏";
  const message = view.help ? "用方向键或WASD移动；普通一步扣1体力，停着、撞墙都不扣。"
    : game.status === "won" ? `送达！${game.moves} 步，${game.score} 分。`
    : game.status === "lost" ? game.message
    : view.paused ? compact ? "已暂停，体力不会减少。" : "已暂停，体力不会减少。按 P / Space / Esc 继续。"
    : view.notice ?? (introduction ? introMessage : game.message);
  const feedback = wrapText(message, width - 2);
  const feedbackTail = feedback.length > 2 ? truncateWidth(feedback.slice(1).join(" "), width - 2) : feedback[1];
  const context = view.help ? "体力用完还没通关才输；没护盾时再遇丢包才输。"
    : game.status === "won" ? best
    : lowTtl ? `TTL（体力）只剩${ttlRemaining}，尽量绕开 ~~ 拥塞。`
    : introduction && !view.paused ? compact ? "R顺序随意；一步扣1体力，停着、撞墙不扣。" : "R顺序随意。普通一步扣1体力，停着思考、撞墙不扣。"
    : compact ? `${red("~~拥塞扣3")} ${red("!!丢包扣护盾")} ${green("++补给")} ${green("**缓存")}`
    : `得分 ${game.score}   已走 ${game.moves} 步   停着思考、撞墙不扣体力。`;
  const messageColor = view.help ? label : game.status === "lost" ? red : game.status === "won" ? green : label;
  const contextLine = compact && playing && !view.help && !lowTtl ? context
    : (lowTtl && !view.help ? red : game.status === "won" && !view.help ? label : dim)(context);
  const feedbackLines = [messageColor("> " + (feedback[0] ?? "")),
    feedbackTail ? "  " + feedbackTail : contextLine];
  let footer: string[];
  if (view.help) {
    footer = compact ? [
      `一步扣1体力，停着、撞墙不扣；${red("~~拥塞扣3")}。`,
      `${red("!!丢包每次扣1护盾")}，没护盾时再遇到才输。`,
      `${green("++重传补给加1护盾(最多3)")}，${green("**缓存加50分")}。`,
      `${label("H/?/Esc")} 返回${returnTo} · ${label("Q")} 退出`,
    ] : [
      ...feedbackLines,
      `${red("~~链路拥塞，每次扣3体力")}；${red("!!丢包，每次扣1护盾")}。`,
      `${green("++重传补给加1护盾(最多3)")}；${green("**缓存加50分")}；路由各加100分。`,
      green("通关加200分，每点剩余体力加5分，每个护盾加20分。"),
      `${label("H / ? / Esc")} 返回${returnTo} · ${label("Q")} 退出`,
    ];
  } else if (reviewing) {
    footer = compact ? [
      reviewTraffic,
      reviewProgress,
      comparison,
      `${label("V/Esc")}成绩 ${label("R")}重玩 ${label("N")}新图 ${label("H")}规则 ${label("Q")}退出`,
    ] : [
      reviewTraffic,
      reviewProgress,
      `路由打卡 ${score.routers} + 缓存奖励 ${score.cache} + 送达 ${score.delivery}`,
      `TTL加分 ${score.ttl} + 重传加分 ${score.retries}；总分 ${score.total}`,
      recordLine ?? best,
      `${label("V / Esc")} 成绩 · ${label("R")} 重玩 · ${label("N")} 新图 · ${label("H")} 规则 · ${label("Q")} 退出`,
    ];
  } else if (!playing) {
    footer = compact ? [
      best,
      recordLine ?? (game.status === "lost" ? red(shortLoss) : comparison),
      `${label("Enter/R")} 重玩 ${label("N")} 新图 ${label("H/?")} 规则`,
      `${label("V")} 复盘 · ${label("Q / Esc")} 退出`,
    ] : [
      ...feedbackLines,
      reviewSummary,
      resultNote,
      `${label("Enter / R")} 原图重玩 · ${label("N")} 新地图 · ${label("H / ?")} 规则`,
      `${label("V")} 复盘 · ${label("Q / Esc")} 退出`,
    ];
  } else if (compact) {
    footer = [
      ...feedbackLines,
      view.paused ? `${label("P/Space/Esc")} 继续 ${label("H/?")} 规则` : `${label("WASD/方向键")} 移动 ${label("P/空格")} 暂停 ${label("T")}提示`,
      view.paused ? `按${label("R")}重开 ${label("N")}换图 ${label("Q")}退出` : `${label("H/?")}规则 按${label("R")}重开 ${label("N")}新图 ${label("Q/Esc")}退出`,
    ];
  } else {
    footer = [
      ...feedbackLines,
      `${accent("[]")}你 · ${accent("R")}路由(打卡点) · ${green("r")}已打卡 · ${green("G")}/${accent("G?")}服务器(终点)`,
      `${red("~~拥塞扣3体力")} · ${red("!!丢包扣1护盾")} · ${green("++补1护盾")} · ${green("**缓存加50分")}`,
      view.paused ? `${label("P / Space / Esc")} 继续 · ${label("H / ?")} 规则` : `${label("WASD / 方向键")} 移动 · ${label("P / Space")} 暂停 · ${label("T")} 提示`,
      view.paused ? `按键 ${label("R")} 重开 · ${label("N")} 换张地图 · ${label("Q")} 退出` : `${label("H / ?")} 规则 · 按键 ${label("R")} 重开 · ${label("N")} 新图 · ${label("Q / Esc")} 退出`,
    ];
  }

  // Divide every available cell of the viewport among the unchanged logical
  // grid. Remainders are distributed evenly, rather than left as empty margins.
  const mapHeight = height - header.length - footer.length;
  const innerWidth = width - 2;
  const innerHeight = mapHeight - 2;
  const gridWidth = game.grid[0]?.length ?? 19;
  const sizes = (total: number, count: number): number[] => Array.from({ length: count }, (_, index) =>
    Math.floor((index + 1) * total / count) - Math.floor(index * total / count));
  const cellWidths = sizes(innerWidth, gridWidth);
  const cellHeights = sizes(innerHeight, game.grid.length);
  const collected = new Set(game.collected);
  const visited = new Set(game.visitedRouters);
  const trail = new Set(game.trail);
  const mapLines = [dim("┌" + "─".repeat(innerWidth) + "┐")];
  for (let y = 0; y < game.grid.length; y++) {
    const cellHeight = cellHeights[y]!;
    for (let row = 0; row < cellHeight; row++) {
      let content = "";
      for (let x = 0; x < gridWidth; x++) {
        const cellWidth = cellWidths[x]!;
        const outlined = cellWidth >= 4 && cellHeight >= 3;
        const key = `${x},${y}`;
        const tile = game.grid[y]![x];
        const player = game.position.x === x && game.position.y === y;
        let marker = "";
        let tint = dim;
        if (player) {
          marker = game.status === "lost" ? "XX" : game.status === "won" ? "OK" : "[]";
          tint = (value: string): string => paint("1;7", value);
        } else if (tile === "#") {
          content += dim("█".repeat(cellWidth));
          continue;
        } else if (tile === "S") marker = "S";
        else if (tile === "G") { marker = complete ? "G" : "G?"; tint = complete ? green : accent; }
        else if (tile === "R") { marker = visited.has(key) ? "r" : "R"; tint = visited.has(key) ? green : accent; }
        else if (tile === "~") { marker = "~~"; tint = red; }
        else if (tile === "!") { marker = "!!"; tint = red; }
        else if (tile === "+" && !collected.has(key)) { marker = "++"; tint = green; }
        else if (tile === "*" && !collected.has(key)) { marker = "**"; tint = green; }
        else if (trail.has(key)) marker = ".";
        else if (cellWidth >= 4 || cellHeight >= 3) marker = "·";
        const center = row === Math.floor((cellHeight - 1) / 2) ? marker : "";
        if (outlined) {
          const border = player ? ["╔", "═", "╗", "║", "╚", "╝"] : ["┌", "─", "┐", "│", "└", "┘"];
          if (row === 0 || row === cellHeight - 1) {
            const edge = (row === 0 ? border[0]! : border[4]!) + border[1]!.repeat(cellWidth - 2) + (row === 0 ? border[2]! : border[5]!);
            content += (player ? tint : dim)(edge);
          } else {
            const inside = cellWidth - 2;
            const left = Math.floor((inside - displayWidth(center)) / 2);
            const padded = " ".repeat(left) + padEndWidth(center, inside - left);
            content += player ? tint(border[3]! + padded + border[3]!) : dim(border[3]!) + tint(padded) + dim(border[3]!);
          }
        } else {
          const left = Math.floor((cellWidth - displayWidth(center)) / 2);
          content += tint(" ".repeat(left) + padEndWidth(center, cellWidth - left));
        }
      }
      mapLines.push(dim("│") + content + dim("│"));
    }
  }
  mapLines.push(dim("└" + "─".repeat(innerWidth) + "┘"));
  return [...header, ...mapLines, ...footer].map(line).join("\n");
}
