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
  with: string[];
  base?: string;
  limit?: string;
  tag?: string;
  kind?: string;
  page?: string;
  network?: string;
  status?: string;
  term?: string;
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
  with: { type: "string", multiple: true },
  base: { type: "string" },
  limit: { type: "string", short: "n" },
  tag: { type: "string" },
  kind: { type: "string" },
  page: { type: "string" },
  network: { type: "string" },
  status: { type: "string" },
  term: { type: "string" },
} as const;

export function parseCli(argv: string[]): ParsedCli {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    return {
      positionals,
      flags: {
        help: Boolean(values.help),
        version: Boolean(values.version),
        json: Boolean(values.json),
        all: Boolean(values.all),
        web: Boolean(values.web),
        with: values.with ?? [],
        base: values.base,
        limit: values.limit,
        tag: values.tag,
        kind: values.kind,
        page: values.page,
        network: values.network,
        status: values.status,
        term: values.term,
      },
    };
  } catch (error) {
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
  if (!Number.isInteger(parsed) || parsed <= 0) throw new UsageError(`${label} 需要正整数，收到「${value}」。`);
  return parsed;
}
