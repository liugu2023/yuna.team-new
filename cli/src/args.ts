// 参数解析：用 Node 内置的 util.parseArgs，不引入任何运行时依赖。
// strict 模式，写错参数会直接报错，避免静默忽略拼错的选项。
import { parseArgs } from "node:util";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface CliFlags {
  help: boolean;
  version: boolean;
  json: boolean;
  all: boolean;
  web: boolean;
  slug?: boolean;
  with: string[];
  base?: string;
  limit?: string;
  tag?: string;
  kind?: string;
  network?: string;
  status?: string;
  term?: string;
  proxy?: string;
  seed?: string;
}

export interface ParsedCli {
  positionals: string[];
  flags: CliFlags;
}

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  json: { type: "boolean" },
  all: { type: "boolean" },
  web: { type: "boolean" },
  slug: { type: "boolean" },
  with: { type: "string", multiple: true },
  base: { type: "string" },
  limit: { type: "string", short: "n" },
  tag: { type: "string" },
  kind: { type: "string" },
  network: { type: "string" },
  status: { type: "string" },
  term: { type: "string" },
  proxy: { type: "string" },
  seed: { type: "string" },
} as const;

const GLOBAL_OPTIONS = ["help", "version", "json", "base", "proxy"];
const COMMAND_OPTIONS: Record<string, string[]> = {
  join: ["with"], posts: ["limit", "tag", "kind", "all"],
  read: ["web", "slug", "tag", "kind"], projects: ["network", "status", "tag"],
  lesson: ["term", "all", "limit", "status"], open: [], play: ["seed"],
};

export function parseCli(argv: string[]): ParsedCli {
  try {
    const { values, positionals, tokens } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
    const command = positionals[0] ?? "";
    if (Object.hasOwn(COMMAND_OPTIONS, command)) {
      const globalOptions = command === "play" ? ["help", "version", "json"] : GLOBAL_OPTIONS;
      const allowed = new Set([...globalOptions, ...COMMAND_OPTIONS[command]!]);
      for (const token of tokens) {
        if (token.kind === "option" && !allowed.has(token.name)) throw new UsageError(`${command} 不支持 --${token.name}。用 yuna ${command} --help 查看用法。`);
      }
      if (!values.help && !values.version) {
        const count = positionals.length - 1;
        const required = command === "read" || command === "open" || command === "play";
        const maximum = required || command === "projects" ? 1 : 0;
        if (count > maximum) throw new UsageError(`${command} 收到了多余的位置参数；包含空格的关键词或地址请加引号。`);
        if (required && count === 0) throw new UsageError(`请提供${command === "read" ? "文章编号或 slug" : command === "play" ? "小游戏名称，例如 yuna play packet" : "要打开的页面或地址"}。用 yuna ${command} --help 查看用法。`);
        if (command === "posts" && values.all && values.limit !== undefined) throw new UsageError("posts 的 --all 和 -n / --limit 不能同时使用。");
      }
    }
    return {
      positionals,
      flags: {
        help: Boolean(values.help),
        version: Boolean(values.version),
        json: Boolean(values.json),
        all: Boolean(values.all),
        web: Boolean(values.web),
        slug: Boolean(values.slug),
        with: values.with ?? [],
        base: values.base,
        limit: values.limit,
        tag: values.tag,
        kind: values.kind,
        network: values.network,
        status: values.status,
        term: values.term,
        proxy: values.proxy,
        seed: values.seed,
      },
    };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    const raw = (error as Error).message;
    const unknown = raw.match(/^Unknown option '([^']+)'/);
    if (unknown) throw new UsageError(`未知参数「${unknown[1]}」。用 yuna --help 查看全部参数。`);
    throw new UsageError(`参数无法解析：${raw}`);
  }
}

/** 读取正整数参数，给了非法值就报用法错误。 */
export function positiveInt(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(parsed) || parsed <= 0) throw new UsageError(`${label} 需要安全范围内的正整数，收到「${value}」。`);
  return parsed;
}
