/** Offline, seeded packet-routing game. No terminal or network state lives here. */
export const PACKET_RULESET = "packet-v2";

export type Direction = "up" | "down" | "left" | "right";
export type Point = { x: number; y: number };
export type Cell = "#" | "." | "S" | "G" | "R" | "~" | "!" | "+" | "*";
export type GameState = {
  seed: string;
  grid: string[];
  position: Point;
  start: Point;
  goal: Point;
  routers: Point[];
  visitedRouters: string[];
  collected: string[];
  ttl: number;
  maxTtl: number;
  retries: number;
  moves: number;
  score: number;
  status: "playing" | "won" | "lost";
  message: string;
  trail: string[];
};

const DIRECTIONS: ReadonlyArray<{ direction: Direction; dx: number; dy: number }> = [
  { direction: "up", dx: 0, dy: -1 },
  { direction: "right", dx: 1, dy: 0 },
  { direction: "down", dx: 0, dy: 1 },
  { direction: "left", dx: -1, dy: 0 },
];
const WIDTH = 19;
const HEIGHT = 9;
const key = (point: Point): string => `${point.x},${point.y}`;
const cellAt = (grid: string[], point: Point): string => grid[point.y]?.[point.x] ?? "#";
const POINTS = { router: 100, cache: 50, delivery: 200, ttl: 5, retry: 20 } as const;

/** Only delivered packets earn the delivery and remaining-resource bonuses. */
export function getScoreBreakdown(state: GameState) {
  const delivered = state.status === "won";
  const routers = state.visitedRouters.length * POINTS.router;
  const cache = state.collected.filter(location => {
    const [x, y] = location.split(",").map(Number);
    return state.grid[y]?.[x] === "*";
  }).length * POINTS.cache;
  const delivery = delivered ? POINTS.delivery : 0;
  const ttl = delivered ? state.ttl * POINTS.ttl : 0;
  const retries = delivered ? state.retries * POINTS.retry : 0;
  return { routers, cache, delivery, ttl, retries, total: routers + cache + delivery + ttl + retries };
}

function seededRandom(seed: string): () => number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  }
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function traceRoute(grid: string[], start: Point, route: Direction[]) {
  const locations = new Set([key(start)]);
  let cursor = start;
  let cost = 0;
  for (const direction of route) {
    const { dx, dy } = DIRECTIONS.find((entry) => entry.direction === direction)!;
    cursor = { x: cursor.x + dx, y: cursor.y + dy };
    locations.add(key(cursor));
    cost += cellAt(grid, cursor) === "~" ? 3 : 1;
  }
  return { locations, cost };
}

/** Spread the objectives out and keep both router orders available from spawn. */
function chooseObjectives(state: GameState, cells: Cell[][], random: () => number) {
  const rooms: Point[] = [];
  for (let y = 1; y < HEIGHT - 1; y += 2) {
    for (let x = 1; x < WIDTH - 1; x += 2) rooms.push({ x, y });
  }
  const distance = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  let grid = state.grid;
  const plan = ([start, goal, ...routers]: Point[]) => {
    const candidate = { ...state, grid, start, position: start, goal, routers };
    const first = findSafeRoute(candidate, 0);
    const second = findSafeRoute(candidate, 1);
    if (!first || !second) return null;
    const shorter = Math.min(first.length, second.length);
    const longer = Math.max(first.length, second.length);
    if (shorter < 24 || longer > 64 || longer > shorter * 1.5) return null;
    const protectedCells = new Set([
      ...traceRoute(grid, start, first).locations,
      ...traceRoute(grid, start, second).locations,
    ]);
    // Even if all six congestion tiles land elsewhere, four loss cells remain.
    const openCells = grid.join("").replace(/#/g, "").length;
    if (openCells - protectedCells.size < 10) return null;
    return { start, goal, routers, routes: [first, second] };
  };
  for (let attempt = 0; attempt < 128; attempt++) {
    const points: Point[] = [];
    for (const point of shuffle([...rooms], random)) {
      if (points.every(other => distance(point, other) >= 6)) points.push(point);
      if (points.length === 4) break;
    }
    if (points.length === 4) {
      const result = plan(points);
      if (result) return result;
    }
  }
  // A rare bottleneck-heavy maze may reject every sampled placement. Open a
  // connected rectangle for a bounded fallback with the same spacing guarantees.
  for (let x = 3; x <= 15; x++) { cells[1][x] = "."; cells[7][x] = "."; }
  for (let y = 1; y <= 7; y++) { cells[y][3] = "."; cells[y][15] = "."; }
  grid = cells.map(row => row.join(""));
  const corners = shuffle([{ x: 3, y: 1 }, { x: 15, y: 1 }, { x: 3, y: 7 }, { x: 15, y: 7 }], random);
  const start = corners[0];
  const goal = corners.find(point => point.x !== start.x && point.y !== start.y)!;
  const result = plan([start, goal, ...corners.filter(point => point !== start && point !== goal)]);
  if (!result) throw new Error("Packet objective placement failed");
  return result;
}

/** Every generated map has a safe route through both routers within its TTL. */
export function createGame(seed: string): GameState {
  const random = seededRandom(seed);
  const cells: Cell[][] = Array.from({ length: HEIGHT }, () => Array<Cell>(WIDTH).fill("#"));
  const start = { x: 1, y: 1 };
  const goal = { x: WIDTH - 2, y: HEIGHT - 2 };
  const routers = [{ x: WIDTH - 2, y: 1 }, { x: 1, y: HEIGHT - 2 }];
  const stack: Point[] = [start];
  cells[start.y][start.x] = ".";
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const candidates = DIRECTIONS.map(({ dx, dy }) => ({ x: current.x + dx * 2, y: current.y + dy * 2 }))
      .filter(({ x, y }) => x > 0 && y > 0 && x < WIDTH - 1 && y < HEIGHT - 1 && cells[y][x] === "#");
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const next = candidates[Math.floor(random() * candidates.length)];
    cells[(current.y + next.y) / 2][(current.x + next.x) / 2] = ".";
    cells[next.y][next.x] = ".";
    stack.push(next);
  }

  // Add loops so a route can trade distance, congestion, rewards and packet loss.
  const connectors: Point[] = [];
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      if ((x + y) % 2 === 1 && cells[y][x] === "#") connectors.push({ x, y });
    }
  }
  for (const { x, y } of shuffle(connectors, random).slice(0, 10)) cells[y][x] = ".";
  let initial: GameState = {
    seed,
    grid: cells.map((row) => row.join("")),
    position: start,
    start,
    goal,
    routers,
    visitedRouters: [],
    collected: [],
    ttl: Number.MAX_SAFE_INTEGER,
    maxTtl: 0,
    retries: 2,
    moves: 0,
    score: 0,
    status: "playing",
    message: "你是数据包 []。先经过两个 R 路由（打卡点），再到 G 服务器（终点）。",
    trail: [key(start)],
  };
  // Preserve the original practice map, including its random draw sequence.
  const objectives = seed === "yuna" ? null : chooseObjectives(initial, cells, random);
  if (objectives) {
    initial = { ...initial, start: objectives.start, position: objectives.start, goal: objectives.goal,
      routers: objectives.routers, trail: [key(objectives.start)] };
  }
  cells[initial.start.y][initial.start.x] = "S";
  cells[initial.goal.y][initial.goal.x] = "G";
  for (const { x, y } of initial.routers) cells[y][x] = "R";
  const available: Point[] = [];
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      if (cells[y][x] === ".") available.push({ x, y });
    }
  }
  shuffle(available, random);
  for (const { x, y } of available.splice(0, 6)) cells[y][x] = "~";
  initial.grid = cells.map(row => row.join(""));
  let routes = objectives?.routes;
  if (!routes) {
    const route = solveGame(initial);
    if (!route) throw new Error("Packet map has no safe route");
    routes = [route];
  }
  const traces = routes.map(route => traceRoute(initial.grid, initial.start, route));
  const protectedCells = new Set(traces.flatMap(trace => [...trace.locations]));
  const routeCost = Math.max(...traces.map(trace => trace.cost));
  // Protect both orders on varied maps; loss tiles still offer risky shortcuts.
  const traps = available.filter((point) => !protectedCells.has(key(point))).slice(0, 4);
  for (const { x, y } of traps) cells[y][x] = "!";
  const rewards = available.filter(({ x, y }) => cells[y][x] === ".");
  for (const { x, y } of rewards.splice(0, 2)) cells[y][x] = "+";
  for (const { x, y } of rewards.splice(0, 4)) cells[y][x] = "*";
  const ttl = routeCost + Math.max(12, Math.ceil(routeCost * 0.3));
  return { ...initial, grid: cells.map((row) => row.join("")), ttl, maxTtl: ttl };
}

/** Invalid moves cost nothing; inputs and finished games remain untouched. */
export function movePacket(state: GameState, direction: Direction): GameState {
  if (state.status !== "playing") return state;
  const delta = DIRECTIONS.find((entry) => entry.direction === direction);
  if (!delta) return state;
  const position = { x: state.position.x + delta.dx, y: state.position.y + delta.dy };
  const cell = cellAt(state.grid, position);
  if (cell === "#") return { ...state, message: "前面是墙，换个方向吧。这一步不消耗 TTL（体力）。" };

  const location = key(position);
  const next: GameState = {
    ...state,
    position,
    ttl: state.ttl - (cell === "~" ? 3 : 1),
    moves: state.moves + 1,
    visitedRouters: [...state.visitedRouters],
    collected: [...state.collected],
    trail: [...state.trail, location],
    message: "数据包前进了一步。",
  };
  if (cell === "~") next.message = "链路拥塞，这一步消耗 3 点 TTL（体力）。";
  if (cell === "!") {
    if (next.retries > 0) {
      next.retries -= 1;
      next.message = "遇到丢包！消耗 1 次重传机会（护盾），继续前进。";
    } else {
      next.status = "lost";
      next.message = "没有重传机会（护盾）又遇到丢包，数据包丢失了。换条路再试。";
    }
  }
  if (cell === "R" && !next.visitedRouters.includes(location)) {
    next.visitedRouters.push(location);
    next.score += POINTS.router;
    next.message = `R 路由已激活（打卡 ${next.visitedRouters.length}/${next.routers.length}），+${POINTS.router} 分。`;
  }
  if ((cell === "+" || cell === "*") && !next.collected.includes(location)) {
    next.collected.push(location);
    if (cell === "+") {
      const previous = next.retries;
      next.retries = Math.min(3, next.retries + 1);
      next.message = previous < 3 ? "获得重传补给，重传机会（护盾）+1，最多 3 次。" : "已拾取重传补给，重传机会（护盾）已达上限 3 次。";
    } else {
      next.score += POINTS.cache;
      next.message = `获得缓存奖励，+${POINTS.cache} 分。`;
    }
  }
  const allRouters = next.routers.every((router) => next.visitedRouters.includes(key(router)));
  if (cell === "G" && !allRouters) next.message = "服务器还不能接收：先经过两个 R 路由（打卡点）。";
  if (next.status === "playing" && cell === "G" && allRouters && next.ttl >= 0) {
    next.status = "won";
    next.score += POINTS.delivery + next.ttl * POINTS.ttl + next.retries * POINTS.retry;
    next.message = "送达服务器，赢了！剩余 TTL（体力）和重传机会（护盾）已换成奖励。";
  } else if (next.status === "playing" && next.ttl <= 0) {
    next.status = "lost";
    next.message = "TTL（体力）耗尽，数据包超时。试试更短的路，或绕开拥塞链路。";
  }
  return next;
}

/** A minimum-TTL route through every router, avoiding all packet-loss tiles. */
export function solveGame(state: GameState): Direction[] | null {
  return findSafeRoute(state);
}

/** Generation can require either router to be visited first, without changing hint semantics. */
function findSafeRoute(state: GameState, firstRouter?: number): Direction[] | null {
  if (state.status === "won") return [];
  if (state.status !== "playing") return null;
  const routerKeys = state.routers.map(key);
  const completeMask = (1 << routerKeys.length) - 1;
  const initialMask = routerKeys.reduce((mask, location, index) => (
    state.visitedRouters.includes(location) ? mask | (1 << index) : mask
  ), 0);
  const routeKey = (point: Point, mask: number): string => `${key(point)}:${mask}`;
  type SearchNode = { position: Point; mask: number; cost: number; id: string };
  const startId = routeKey(state.position, initialMask);
  const pending: SearchNode[] = [{ position: state.position, mask: initialMask, cost: 0, id: startId }];
  const costs = new Map([[startId, 0]]);
  const previous = new Map<string, { from: string; direction: Direction }>();
  while (pending.length > 0) {
    let cheapest = 0;
    for (let i = 1; i < pending.length; i += 1) {
      if (pending[i].cost < pending[cheapest].cost) cheapest = i;
    }
    const [current] = pending.splice(cheapest, 1);
    if (current.cost !== costs.get(current.id)) continue;
    if (current.mask === completeMask && key(current.position) === key(state.goal)) {
      const route: Direction[] = [];
      let id = current.id;
      while (id !== startId) {
        const step = previous.get(id)!;
        route.push(step.direction);
        id = step.from;
      }
      return route.reverse();
    }
    for (const { direction, dx, dy } of DIRECTIONS) {
      const position = { x: current.position.x + dx, y: current.position.y + dy };
      const cell = cellAt(state.grid, position);
      if (cell === "#" || cell === "!") continue;
      const cost = current.cost + (cell === "~" ? 3 : 1);
      if (cost > state.ttl) continue;
      const routerIndex = routerKeys.indexOf(key(position));
      if (firstRouter !== undefined && current.mask === 0 && routerIndex >= 0 && routerIndex !== firstRouter) continue;
      const mask = routerIndex < 0 ? current.mask : current.mask | (1 << routerIndex);
      // TTL may reach zero only on a completed delivery, never mid-route.
      if (cost === state.ttl && !(mask === completeMask && key(position) === key(state.goal))) continue;
      const id = routeKey(position, mask);
      if (cost >= (costs.get(id) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(id, cost);
      previous.set(id, { from: current.id, direction });
      pending.push({ position, mask, cost, id });
    }
  }
  return null;
}
