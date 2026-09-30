// yuna CLI 入口：命令表、帮助、统一错误处理。
import { ApiError, YunaApi } from "./api.js";
import { parseCli, UsageError } from "./args.js";
import { runJoin } from "./commands/join.js";
import { runLesson } from "./commands/lesson.js";
import { runOpen } from "./commands/open.js";
import { runPlay } from "./commands/play.js";
import { runPosts } from "./commands/posts.js";
import { runProjects } from "./commands/projects.js";
import { runRead } from "./commands/read.js";
import type { CommandContext } from "./context.js";
import { configureProxy, shutdownProxy } from "./net.js";
import { style } from "./ui.js";
import { isTerminalOutputOwned } from "./terminal-errors.js";

/** 兜底版本号；bin/yuna.mjs 会优先传 cli/package.json 里的版本。 */
export const VERSION = "0.3.0";

interface CommandDefinition {
  summary: string;
  usage: string;
  offline?: boolean;
  run: (ctx: CommandContext) => Promise<void>;
}

const COMMANDS: Record<string, CommandDefinition> = {
  join: { summary: "招新与加入信息", usage: "yuna join [--with curiosity]", run: runJoin },
  posts: {
    summary: "已发布文章列表",
    usage: "yuna posts [-n 数量] [--tag 标签] [--kind article|knowledge] [--all]",
    run: runPosts,
  },
  read: { summary: "在终端读一篇文章", usage: "yuna read <编号|slug> [--tag 标签] [--kind article|knowledge] [--slug] [--web]", run: runRead },
  projects: {
    summary: "协会项目目录",
    usage: "yuna projects [关键词] [--network public|internal|unspecified] [--status planning|building|maintaining|archived] [--tag 标签]",
    run: runProjects,
  },
  lesson: {
    summary: "授课计划",
    usage: "yuna lesson [--term 关键词] [--all] [-n 数量] [--status planned|completed|cancelled]",
    run: runLesson,
  },
  open: { summary: "在浏览器打开页面", usage: "yuna open <页面|路径|地址>", run: runOpen },
  play: {
    summary: "离线小游戏：数据包冒险",
    usage: "yuna play packet [--seed 地图名字] [--json]",
    offline: true,
    run: runPlay,
  },
};

export interface MainOptions {
  version?: string;
  proxy?: string;
}

function terminalWidth(): number {
  return Math.min(Math.max(process.stdout.columns ?? 84, 40), 100);
}

let pipeClosed = false;
let pipeHandlersInstalled = false;

/** 下游提前关闭管道（`yuna posts | head`）时 node 会抛 EPIPE；这属于正常用法，安静退出即可。
 *  注意不要在 uv 的错误回调里直接 process.exit：Windows 上偶发 libuv 断言
 *  （uv_async_send on closing handle），改成置好退出码、下一轮事件循环再退，并停掉后续写入。 */
function ignorePipeErrors(): void {
  if (pipeHandlersInstalled) return;
  pipeHandlersInstalled = true;
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      // An interactive session must restore raw input before handling output failure.
      if (isTerminalOutputOwned(stream)) return;
      if (error.code !== "EPIPE") throw error;
      if (pipeClosed) return;
      pipeClosed = true;
      process.exitCode = 0;
      setTimeout(() => process.exit(0), 0);
    });
  }
}

function printHelp(version: string, stream: NodeJS.WriteStream = process.stdout): void {
  const flagRows: Array<[string, string]> = [
    ["--json", "以 JSON 输出，便于脚本处理"],
    ["--base", "联网命令指定站点地址（默认 https://www.yuna.team，也可用环境变量 YUNA_API_BASE）"],
    ["--proxy", "联网命令指定代理地址，例如 --proxy http://127.0.0.1:7890"],
    ["-h, --help", "显示帮助；yuna <命令> --help 查看单个命令"],
    ["-v, --version", "显示版本"],
  ];
  const commandRows = Object.entries(COMMANDS).map(([name, command]) => [name, command.summary] as [string, string]);
  const flagWidth = Math.max(...flagRows.map(([flag]) => flag.length));
  const commandWidth = Math.max(...commandRows.map(([name]) => name.length));

  const lines = [
    "",
    `  ${style.bold(style.brand("yuna"))} ${style.dim(`v${version}`)} ${style.dim("· 燕山大学大学生网络信息协会命令行工具")}`,
    "",
    `  ${style.bold("用法")}   yuna <命令> [参数]`,
    "",
    `  ${style.bold("命令")}`,
    ...commandRows.map(([name, summary]) => `    ${style.brand(name.padEnd(commandWidth))}  ${summary}`),
    "",
    `  ${style.bold("全局参数")}`,
    ...flagRows.map(([flag, description]) => `    ${flag.padEnd(flagWidth)}  ${description}`),
    "",
    `  ${style.bold("示例")}`,
    `    ${style.dim("$")} yuna join --with curiosity`,
    `    ${style.dim("$")} yuna posts -n 5 --tag 运维`,
    `    ${style.dim("$")} yuna read 1`,
    `    ${style.dim("$")} yuna read hello-yuna`,
    `    ${style.dim("$")} yuna projects --network public`,
    `    ${style.dim("$")} yuna lesson --term 2026`,
    `    ${style.dim("$")} yuna open projects`,
    `    ${style.dim("$")} yuna play packet`,
    "",
  ];
  stream.write(lines.join("\n") + "\n");
}

function printCommandHelp(name: string, version: string): void {
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) {
    printHelp(version);
    return;
  }
  process.stdout.write(
    [
      "",
      `  ${style.bold(style.brand(name))} ${style.dim(`· ${command.summary}`)}`,
      "",
      `  ${style.bold("用法")}   ${command.usage}`,
      "",
      ...(name === "read" ? ["  编号对应本站最近一次 posts 列表；显式 --tag / --kind 则查询当前筛选结果。", "  纯数字 slug 加 --slug；--web --json 只输出地址，不启动浏览器。", ""] : []),
      ...(name === "play" ? [
        "  你是数据包 []。先经过两个 R 路由（打卡点），再到 G 服务器（终点）。",
        "  TTL（体力）每步减 1，遇到 ~~ 链路拥塞时减 3；停着思考和撞墙不扣。",
        "  !! 丢包会消耗 1 次重传机会（护盾），没有机会时再遇到丢包就输了。",
        "  ++ 补充重传机会，** 是加分的缓存奖励。两个路由先去哪个都行。",
        "  方向键 / WASD 移动；不知道往哪走就按 T 看提示。",
        "  P / 空格暂停；H / ? 帮助；R 重开；N 新地图；Q 退出。",
        "  Esc 返回游戏或退出；结束后 Enter 重玩，V 查看传输复盘。",
        "  --seed <名字>  指定地图；名字相同，地图就相同。不指定时随机生成。",
        "  --json         只输出初始地图数据，不进入游戏。",
        "  自动保存同一地图的最好成绩和上次通关成绩，结束后比较分数和步数。",
        "  看提示不扣分，但会记录次数；站着不动反复查看只算一次。",
        "  每次启动默认随机地图；--seed yuna 可玩固定练习图。R 重玩当前图，N 换图。",
        "  默认铺满终端，缩放窗口会调整地图和布局；至少需要 42 列 × 18 行。",
        "  不请求网络、不写线上数据。",
        "",
        `  ${style.dim("可用通用参数：--json、-h/--help、-v/--version；不接受 --base 或 --proxy。")}`,
      ] : [`  ${style.dim("全局参数同样可用：--json、--base、--proxy、-h/--help、-v/--version")}`]),
      "",
    ].join("\n") + "\n",
  );
}

function fail(error: unknown): number {
  if (error instanceof UsageError || error instanceof ApiError) {
    process.stderr.write(`${style.red("✗")} ${error.message}\n`);
    return 1;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${style.red("✗")} 出错了：${message}\n`);
  if (process.env.YUNA_DEBUG && error instanceof Error && error.stack) {
    process.stderr.write(`${style.dim(error.stack)}\n`);
  }
  process.stderr.write(style.dim("  加上 YUNA_DEBUG=1 可以看到调用栈。\n"));
  return 1;
}

export async function main(argv: string[], options: MainOptions = {}): Promise<number> {
  const version = options.version ?? VERSION;
  ignorePipeErrors();

  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    return fail(error);
  }

  if (parsed.flags.version) {
    process.stdout.write(`yuna ${version}\n`);
    return 0;
  }

  const [name, ...rest] = parsed.positionals;
  // 显式 --help 属于正常请求，返回 0；完全不带参数才按用法错误处理（返回 1）。
  if (parsed.flags.help && !name) {
    printHelp(version);
    return 0;
  }
  if (!name || name === "help") {
    if (name === "help" && rest[0] && Object.hasOwn(COMMANDS, rest[0])) {
      printCommandHelp(rest[0], version);
      return 0;
    }
    if (name === "help" && rest[0]) return fail(new UsageError(`不认识的命令「${rest[0]}」。`));
    printHelp(version, name ? process.stdout : process.stderr);
    return name ? 0 : 1;
  }

  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) {
    process.stderr.write(`${style.red("✗")} 不认识的命令「${name}」。\n`);
    printHelp(version, process.stderr);
    return 1;
  }
  if (parsed.flags.help) {
    printCommandHelp(name, version);
    return 0;
  }

  try {
    const ctx: CommandContext = {
      // 离线命令不读取站点环境变量；仅保留共用上下文的类型兼容。
      api: new YunaApi({ base: command.offline ? "https://example.invalid" : parsed.flags.base }),
      flags: parsed.flags,
      positionals: rest,
      width: terminalWidth(),
      out: (line = "") => {
        if (!pipeClosed) process.stdout.write(`${line}\n`);
      },
    };

    if (!command.offline) await configureProxy(parsed.flags.proxy ?? options.proxy);

    await command.run(ctx);
    // 终端会话收到 Ctrl+C / 信号时保留其退出码，避免启动器覆盖为成功。
    return command.offline && typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    return fail(error);
  } finally {
    if (!command.offline) await shutdownProxy();
  }
}
