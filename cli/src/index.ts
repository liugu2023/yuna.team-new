// yuna CLI 入口：命令表、帮助、统一错误处理。
import { ApiError, YunaApi } from "./api.js";
import { parseCli, UsageError } from "./args.js";
import { runJoin } from "./commands/join.js";
import { runLesson } from "./commands/lesson.js";
import { runOpen } from "./commands/open.js";
import { runPosts } from "./commands/posts.js";
import { runProjects } from "./commands/projects.js";
import { runRead } from "./commands/read.js";
import type { CommandContext } from "./context.js";
import { style } from "./ui.js";

/** 兜底版本号；bin/yuna.mjs 会优先传 cli/package.json 里的版本。 */
export const VERSION = "0.1.0";

interface CommandDefinition {
  summary: string;
  usage: string;
  run: (ctx: CommandContext) => Promise<void>;
}

const COMMANDS: Record<string, CommandDefinition> = {
  join: { summary: "招新与加入信息", usage: "yuna join [--with curiosity]", run: runJoin },
  posts: {
    summary: "已发布文章列表",
    usage: "yuna posts [-n 数量] [--tag 标签] [--kind article|knowledge] [--all]",
    run: runPosts,
  },
  read: { summary: "在终端读一篇文章", usage: "yuna read <slug> [--web]", run: runRead },
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
};

export interface MainOptions {
  version?: string;
}

function terminalWidth(): number {
  return Math.min(Math.max(process.stdout.columns ?? 84, 40), 100);
}

/** 下游提前关闭管道（`yuna posts | head`）时 node 会抛 EPIPE；这属于正常用法，安静退出即可。 */
function ignorePipeErrors(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") process.exit(0);
      throw error;
    });
  }
}

function printHelp(version: string, stream: NodeJS.WriteStream = process.stdout): void {
  const flagRows: Array<[string, string]> = [
    ["--json", "以 JSON 输出，便于脚本处理"],
    ["--base", "指定站点地址（默认 https://www.yuna.team，也可用环境变量 YUNA_API_BASE）"],
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
    `    ${style.dim("$")} yuna read hello-yuna`,
    `    ${style.dim("$")} yuna projects --network public`,
    `    ${style.dim("$")} yuna lesson --term 2026`,
    `    ${style.dim("$")} yuna open projects`,
    "",
  ];
  stream.write(lines.join("\n") + "\n");
}

function printCommandHelp(name: string, version: string): void {
  const command = COMMANDS[name];
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
      `  ${style.dim("全局参数同样可用：--json、--base、-h/--help、-v/--version")}`,
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
  if (!name || name === "help") {
    if (name === "help" && rest[0] && COMMANDS[rest[0]]) {
      printCommandHelp(rest[0], version);
      return 0;
    }
    printHelp(version, name ? process.stdout : process.stderr);
    return name ? 0 : 1;
  }

  const command = COMMANDS[name];
  if (!command) {
    process.stderr.write(`${style.red("✗")} 不认识的命令「${name}」。\n`);
    printHelp(version, process.stderr);
    return 1;
  }
  if (parsed.flags.help) {
    printCommandHelp(name, version);
    return 0;
  }

  const ctx: CommandContext = {
    api: new YunaApi({ base: parsed.flags.base }),
    flags: parsed.flags,
    positionals: rest,
    width: terminalWidth(),
    out: (line = "") => process.stdout.write(`${line}\n`),
  };

  try {
    await command.run(ctx);
    return 0;
  } catch (error) {
    return fail(error);
  }
}
