// 终端 Markdown 渲染：覆盖站点文章实际用到的子集（标题、列表、代码块、表格、引用、图片、链接、强调）。
// 目标是“读得下去”，不是完整实现 Markdown 规范。
import { displayWidth, padEndWidth, style, truncateWidth, wrapText } from "./ui.js";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (/^#x/i.test(code)) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code] ?? match;
  });
}

/** 行内格式：代码、链接、图片、粗斜体、删除线。 */
export function inlineMarkdown(text: string): string {
  const codes: string[] = [];
  let out = decodeEntities(text);

  out = out.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(style.cyan(code));
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (_match, url: string) => style.dim(url));
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, alt: string) =>
    style.dim(alt ? `[图片：${alt}]` : "[图片]"),
  );
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, label: string, url: string) => {
    const clean = decodeEntities(label);
    if (clean === url) return style.underline(clean);
    return `${style.underline(clean)} ${style.dim(`‹${url}›`)}`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, (_match, value: string) => style.bold(value));
  out = out.replace(/__([^_]+)__/g, (_match, value: string) => style.bold(value));
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, (_match, prefix: string, value: string) => `${prefix}${style.italic(value)}`);
  out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, (_match, prefix: string, value: string) => `${prefix}${style.italic(value)}`);
  out = out.replace(/~~([^~]+)~~/g, (_match, value: string) => style.dim(value));
  out = out.replace(/<[^>]+>/g, "");
  out = out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codes[Number(index)] ?? "");
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isDelimiterRow(line: string): boolean {
  return line.includes("-") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line);
}

export function renderMarkdown(source: string, width: number): string {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const push = (line = ""): void => {
    out.push(line);
  };
  const pushWrapped = (text: string, indent = "  "): void => {
    for (const line of wrapText(text, width, indent)) push(line);
  };
  const pushListItem = (prefix: string, content: string): void => {
    const room = Math.max(8, width - displayWidth(prefix) - displayWidth("  "));
    const wrapped = wrapText(content, room, "");
    const hanging = " ".repeat(displayWidth(prefix));
    wrapped.forEach((line, position) => push(position === 0 ? `  ${prefix}${line}` : hanging + line));
  };
  const pushTable = (header: string[], rows: string[][]): void => {
    const render = (row: string[]): string[] => header.map((_cell, index) => inlineMarkdown((row[index] ?? "").trim()));
    const head = render(header);
    const body = rows.map(render);
    const widths = head.map((value, index) =>
      Math.max(displayWidth(value), ...body.map((row) => displayWidth(row[index] ?? "")), 2),
    );
    const gap = 3;
    const limit = Math.max(24, width - 4);
    let total = widths.reduce((sum, value) => sum + value, 0) + (widths.length - 1) * gap;
    while (total > limit && widths.some((value) => value > 6)) {
      const widest = widths.indexOf(Math.max(...widths));
      widths[widest] = (widths[widest] ?? 6) - 1;
      total = widths.reduce((sum, value) => sum + value, 0) + (widths.length - 1) * gap;
    }
    const cell = (value: string, index: number, bold = false): string => {
      const text = truncateWidth(value, widths[index] ?? 8);
      const padded = padEndWidth(text, widths[index] ?? 8);
      return bold ? style.bold(padded) : padded;
    };
    push("  " + head.map((value, index) => cell(value, index, true)).join(style.dim(" │ ")));
    push("  " + widths.map((value) => style.dim("─".repeat(value))).join(style.dim("─┼─")));
    for (const row of body) push(("  " + row.map((value, index) => cell(value, index)).join(style.dim(" │ "))).trimEnd());
  };

  let index = 0;
  while (index < lines.length) {
    const raw = lines[index] ?? "";
    const line = raw.trim();

    if (!line) {
      if (out.length && out[out.length - 1] !== "") push("");
      index++;
      continue;
    }

    const fence = line.match(/^(```+|~~~+)\s*(\S*)/);
    if (fence) {
      const marker = (fence[1] ?? "```").slice(0, 3);
      const language = fence[2] ?? "";
      index++;
      const block: string[] = [];
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith(marker)) {
        block.push(lines[index] ?? "");
        index++;
      }
      index++;
      if (language) push(style.dim(`  ${language}`));
      for (const code of block) push(style.dim(`  │ ${truncateWidth(code, Math.max(20, width - 6))}`));
      push("");
      continue;
    }

    // ::: tip / info / note / warning / danger 容器块（站点文章常用的提示块）。
    // 两种写法都支持：`::: warning 标题` + 正文 + `:::`，以及单行 `::: tip 正文 :::`。
    if (line.startsWith(":::")) {
      const rest = line.replace(/^:::\s*/, "");
      const inlineClosed = /\s*:::\s*$/.test(rest);
      let head = inlineClosed ? rest.replace(/\s*:::\s*$/, "") : rest;
      const typeMatch = head.match(/^([A-Za-z][\w-]*)\b\s*(.*)$/);
      const type = (typeMatch?.[1] ?? "").toLocaleLowerCase();
      head = (typeMatch?.[2] ?? head).trim();
      const inner: string[] = [];
      if (inlineClosed) {
        inner.push(head);
        head = "";
      } else {
        index += 1;
        while (index < lines.length && (lines[index] ?? "").trim() !== ":::") {
          inner.push(lines[index] ?? "");
          index += 1;
        }
      }
      index += 1;

      const label = [type || "提示", head].filter(Boolean).join(" · ");
      const paint =
        type === "danger"
          ? style.red
          : type === "warning"
            ? style.yellow
            : type === "tip"
              ? style.green
              : type === "info"
                ? style.brand
                : style.dim;
      push("  " + style.dim("┌ ") + paint(label));
      const body = renderMarkdown(inner.join("\n"), Math.max(16, width - 4));
      for (const bodyLine of body.split("\n")) {
        push(bodyLine.trim() ? `  ${style.dim("│")} ${bodyLine.replace(/^ {1,2}/, "")}` : `  ${style.dim("│")}`);
      }
      push("  " + style.dim("└"));
      push("");
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isDelimiterRow(lines[index + 1] ?? "")) {
      const header = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim()) {
        rows.push(splitRow(lines[index] ?? ""));
        index++;
      }
      pushTable(header, rows);
      push("");
      continue;
    }

    if (/^([-*_])(\s*\1){2,}$/.test(line)) {
      push("  " + style.dim("─".repeat(Math.min(48, Math.max(8, width - 4)))));
      push("");
      index++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = (heading[1] ?? "#").length;
      const text = inlineMarkdown((heading[2] ?? "").replace(/\s*#+\s*$/, ""));
      push("");
      if (level === 1) {
        pushWrapped(style.bold(style.brand(text)));
        push("  " + style.dim("─".repeat(Math.min(displayWidth(text) + 2, Math.max(8, width - 4)))));
      } else if (level === 2) {
        push(`  ${style.bold(style.brand(text))}`);
      } else if (level === 3) {
        push(`  ${style.bold(text)}`);
      } else {
        push(`  ${style.bold(style.dim(text))}`);
      }
      push("");
      index++;
      continue;
    }

    if (line.startsWith(">")) {
      const parts: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        parts.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index++;
      }
      for (const wrapped of wrapText(inlineMarkdown(parts.join(" ")), width, "  ")) {
        push(`${style.dim("  │")} ${wrapped.trim()}`);
      }
      push("");
      continue;
    }

    const item = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      const depth = Math.min(Math.floor((item[1] ?? "").length / 2), 4);
      const ordered = /^\d/.test(item[2] ?? "");
      const marker = ordered ? `${(item[2] ?? "").replace(/[.)]$/, "")}.` : "•";
      pushListItem(`${"  ".repeat(depth)}${marker} `, inlineMarkdown(item[3] ?? ""));
      index++;
      continue;
    }

    const buffer: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      const currentLine = current.trim();
      if (!currentLine) break;
      if (/^(#{1,6})\s/.test(currentLine)) break;
      if (/^(```+|~~~+)/.test(currentLine)) break;
      if (currentLine.startsWith(">")) break;
      if (currentLine.startsWith(":::")) break;
      if (/^(\s*)([-*+]|\d+[.)])\s+/.test(current)) break;
      if (/^([-*_])(\s*\1){2,}$/.test(currentLine)) break;
      if (currentLine.includes("|") && isDelimiterRow(lines[index + 1] ?? "")) break;
      buffer.push(currentLine);
      index++;
    }
    pushWrapped(inlineMarkdown(buffer.join(" ")));
    push("");
  }

  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
