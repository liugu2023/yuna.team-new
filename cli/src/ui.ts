// 终端输出小工具：颜色、中英混排宽度、折行、对齐。
// 中文字符占两列，所有对齐都要按“显示宽度”而不是字符串长度算，否则表格会歪。

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const wrap = (code: number) => (text: string): string =>
  COLOR_ENABLED ? `\u001b[${code}m${text}\u001b[0m` : text;

export const style = {
  bold: wrap(1),
  dim: wrap(2),
  italic: wrap(3),
  underline: wrap(4),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  brand: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  gray: wrap(90),
};

export const COLOR = COLOR_ENABLED;

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** 避头尾：这些标点不应该出现在行首。 */
const NO_LINE_START = "。，、；：！？）】》」』”’…—·%";

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
];

function isWide(codePoint: number): boolean {
  return WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** 一个字符占几列：东亚全角 2 列，组合符 0 列，其余 1 列。 */
export function charWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0) return 0;
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (/\p{Mark}/u.test(char) || codePoint === 0x200d) return 0; // 组合符、变体选择符和连接符
  return isWide(codePoint) ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of stripAnsi(text)) width += charWidth(char);
  return width;
}

export function padEndWidth(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? text + " ".repeat(pad) : text;
}

export function truncateWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const unit of terminalUnits(text)) {
    if (used + unit.width > width - 1) break;
    out += unit.text;
    used += unit.width;
  }
  // 截断可能丢掉原文末尾的 reset；补齐，避免后面的表格列和提示被染色。
  return out + "…" + (out.includes("\u001b[") ? "\u001b[0m" : "");
}

interface TerminalUnit {
  text: string;
  char: string;
  width: number;
}

/** 转义序列是不可拆分的零宽单元，不能把 ESC 后的数字误算成正文。 */
function terminalUnits(text: string): TerminalUnit[] {
  const units: TerminalUnit[] = [];
  let offset = 0;
  const appendText = (part: string): void => {
    for (const char of part) units.push({ text: char, char, width: charWidth(char) });
  };
  for (const match of text.matchAll(ANSI_PATTERN)) {
    appendText(text.slice(offset, match.index));
    units.push({ text: match[0], char: "", width: 0 });
    offset = (match.index ?? 0) + match[0].length;
  }
  appendText(text.slice(offset));
  return units;
}

/** 按显示宽度折行：中文可在任意字之间断，英文按词断。 */
export function wrapText(text: string, width: number, indent = ""): string[] {
  const lines: string[] = [];
  const available = Math.max(1, Math.floor(width - displayWidth(indent)));
  for (const paragraph of String(text).split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    for (const line of splitTokens(paragraph, available)) lines.push(indent + line);
  }
  return lines;
}

function splitTokens(paragraph: string, width: number): string[] {
  const tokens: TerminalUnit[][] = [];
  let buffer: TerminalUnit[] = [];
  let kind = "";
  const flushToken = (): void => {
    if (buffer.length) tokens.push(buffer);
    buffer = [];
    kind = "";
  };
  for (const unit of terminalUnits(paragraph)) {
    if (!unit.char) {
      buffer.push(unit);
      continue;
    }
    const nextKind = /\s/u.test(unit.char) ? "space" : unit.width === 2 ? "wide" : "word";
    if (kind && (nextKind !== kind || nextKind === "wide")) flushToken();
    kind = nextKind;
    buffer.push(unit);
  }
  flushToken();
  const lines: string[] = [];
  let current: TerminalUnit[] = [];
  const visibleWidth = (units: TerminalUnit[]): number => units.reduce((sum, unit) => sum + unit.width, 0);
  const trimSpaces = (units: TerminalUnit[], fromStart = false): TerminalUnit[] => {
    const trimmed = [...units];
    let index = fromStart ? 0 : trimmed.length - 1;
    while (index >= 0 && index < trimmed.length) {
      const unit = trimmed[index]!;
      if (unit.char && !/\s/u.test(unit.char)) break;
      if (unit.char) trimmed.splice(index, 1);
      else if (fromStart) index++;
      if (!fromStart) index--;
    }
    return trimmed;
  };
  const pushLine = (): void => {
    lines.push(trimSpaces(current).map((unit) => unit.text).join(""));
    current = [];
  };
  for (const token of tokens) {
    const plain = token.map((unit) => unit.char).join("");
    if (!plain.trim()) {
      current.push(...(visibleWidth(current) ? token : trimSpaces(token, true)));
      continue;
    }
    if (visibleWidth(current) + visibleWidth(token) > width) {
      current = trimSpaces(current);
      if (visibleWidth(current)) {
        let carried: TerminalUnit[] = [];
        // 中文收尾标点和前一个字一起移到下一行，颜色序列也一起保留。
        if (plain.length === 1 && NO_LINE_START.includes(plain)) {
          let last = current.length - 1;
          while (last >= 0 && (!current[last]!.char || current[last]!.width === 0)) last--;
          if (last > 0 && visibleWidth(current.slice(0, last)) > 0 && visibleWidth(current.slice(last)) + visibleWidth(token) <= width) {
            carried = current.splice(last);
          }
        }
        pushLine();
        current = carried;
      }
    }
    // 过长英文词、URL 仍要在字符边界折行，不能把整行推到终端之外。
    for (const unit of token) {
      if (unit.width > 0 && visibleWidth(current) > 0 && visibleWidth(current) + unit.width > width) pushLine();
      current.push(unit);
    }
  }
  if (current.length) pushLine();
  return lines.length ? lines : [""];
}

/** 键值块：`键  值`，键按显示宽度对齐。 */
export function keyValueRows(rows: Array<[string, string]>, indent = "  "): string[] {
  const visible = rows.filter(([, value]) => String(value ?? "").trim());
  if (!visible.length) return [];
  const keyWidth = Math.max(...visible.map(([key]) => displayWidth(key)));
  return visible.map(([key, value]) => `${indent}${style.dim(padEndWidth(key, keyWidth))}  ${value}`);
}

export function sectionTitle(title: string): string {
  return style.bold(style.brand(title));
}

export function hint(text: string): string {
  return style.dim(text);
}

export function bullet(text: string, indent = "  "): string {
  return `${indent}${style.dim("·")} ${text}`;
}
