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
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

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
  if (codePoint >= 0x300 && codePoint <= 0x36f) return 0; // 组合符
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
  if (displayWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const char of text) {
    const size = charWidth(char);
    if (used + size > width - 1) break;
    out += char;
    used += size;
  }
  return out + "…";
}

/** 按显示宽度折行：中文可在任意字之间断，英文按词断。 */
export function wrapText(text: string, width: number, indent = ""): string[] {
  const lines: string[] = [];
  const available = Math.max(8, width - displayWidth(indent));
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
  const tokens: string[] = [];
  let buffer = "";
  for (const char of paragraph) {
    const size = charWidth(char);
    if (char === " ") {
      buffer += char;
      continue;
    }
    if (size === 2) {
      // 中英之间不额外插空格：终端里 CJK 本来就占两列，插了反而把作者写的「B站」「PS基础」
      // 变成「B 站」「PS 基础」。源文自带的空格会保留在 buffer 里。
      if (buffer) tokens.push(buffer);
      buffer = "";
      tokens.push(char);
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) tokens.push(buffer.trimEnd());

  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current ? current + token : token;
    if (displayWidth(candidate) > width && current) {
      const tail = [...current];
      const lastChar = tail[tail.length - 1] ?? "";
      // 中文避头尾：行首不放收尾标点，把上一行最后一个字带下来。
      if (NO_LINE_START.includes(token) && tail.length > 1 && !current.includes("\u001b")) {
        tail.pop();
        lines.push(tail.join("").trimEnd());
        current = lastChar + token;
      } else {
        lines.push(current.trimEnd());
        current = token.trimStart();
      }
    } else {
      current = candidate;
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
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
