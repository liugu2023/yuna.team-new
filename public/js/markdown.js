// Markdown 渲染与站内资源地址归一。依赖 core.js。

function markdownToHtml(markdown) {
  const lines = stripFrontmatter(markdown).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inCode = false;
  let codeOpen = "";
  let codeLines = [];
  let paragraph = [];
  // 列表栈：每层 { tag, indent }；每层里最后一个 <li> 保持打开，以便嵌套子列表写进去。
  const listStack = [];
  let quote = [];
  let customBlock = null;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const content = paragraph
      .map((line) => {
        const hasBreak = /\s{2,}$/.test(line);
        return `${inlineMarkdown(escapeHtml(line.trimEnd()))}${hasBreak ? "<br>" : ""}`;
      })
      .join(" ");
    html.push(`<p>${content}</p>`);
    paragraph = [];
  }

  function closeList() {
    while (listStack.length) html.push(`</li></${listStack.pop().tag}>`);
  }

  function pushListItem(indent, tag, content) {
    while (listStack.length && listStack[listStack.length - 1].indent > indent) {
      html.push(`</li></${listStack.pop().tag}>`);
    }
    const top = listStack[listStack.length - 1];
    if (top && top.indent === indent) {
      if (top.tag === tag) {
        html.push("</li>");
      } else {
        html.push(`</li></${listStack.pop().tag}>`);
      }
    }
    const current = listStack[listStack.length - 1];
    if (!current || current.indent < indent || current.tag !== tag || current.indent !== indent) {
      html.push(`<${tag}>`);
      listStack.push({ tag, indent });
    }
    html.push(`<li>${content}`);
  }

  function flushQuote() {
    if (quote.length === 0) return;
    html.push(`<blockquote>${quote.map((line) => `<p>${line}</p>`).join("")}</blockquote>`);
    quote = [];
  }

  function flushCustomBlock() {
    if (!customBlock) return;
    const type = customBlock.type;
    const title = customBlock.title || customBlockTitle(type);
    const body = markdownToHtml(customBlock.lines.join("\n"));
    html.push(`<div class="custom-block ${type}"><p class="custom-block-title">${inlineMarkdown(escapeHtml(title))}</p>${body}</div>`);
    customBlock = null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (customBlock) {
      const trimmed = line.trim();
      if (!customBlock.inCode && trimmed === ":::") {
        flushCustomBlock();
        continue;
      }
      if (trimmed.startsWith("```")) customBlock.inCode = !customBlock.inCode;
      customBlock.lines.push(line);
      continue;
    }

    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`${codeOpen}${codeLines.join("\n")}</code></pre>`);
        inCode = false;
      } else {
        flushParagraph();
        flushQuote();
        closeList();
        // 语言标记只接受常见字符，写进 data-lang / class，供文章页显示语言标签与复制按钮。
        const lang = line.slice(3).trim().split(/\s+/, 1)[0].toLowerCase();
        const safeLang = /^[a-z0-9_+#.-]{1,24}$/.test(lang) ? lang : "";
        codeOpen = safeLang ? `<pre data-lang="${safeLang}"><code class="language-${safeLang}">` : "<pre><code>";
        codeLines = [];
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(escapeHtml(line));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      flushQuote();
      continue;
    }

    if (line.trim() === "---") {
      flushParagraph();
      closeList();
      flushQuote();
      html.push("<hr>");
      continue;
    }

    const customBlockStart = line.trim().match(/^:::\s*(tip|info|note|warning|danger)(?:\s+(.*))?$/i);
    if (customBlockStart) {
      flushParagraph();
      closeList();
      flushQuote();
      customBlock = {
        type: customBlockStart[1].toLowerCase(),
        title: (customBlockStart[2] || "").trim(),
        lines: [],
        inCode: false,
      };
      continue;
    }

    const quoteLine = line.match(/^>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      closeList();
      const content = quoteLine[1].trim();
      const admonitions = {
        "[!NOTE]": "提示",
        "[!IMPORTANT]": "重要",
        "[!WARNING]": "注意",
      };
      quote.push(admonitions[content] ? `<strong>${admonitions[content]}</strong>` : inlineMarkdown(escapeHtml(content)));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      flushQuote();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const table = parseMarkdownTable(lines, index);
    if (table) {
      flushParagraph();
      closeList();
      flushQuote();
      html.push(table.html);
      index = table.end;
      continue;
    }

    const unorderedItem = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const orderedItem = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    const listItem = unorderedItem || orderedItem;
    if (listItem) {
      flushParagraph();
      flushQuote();
      const indent = listItem[1].replace(/\t/g, "    ").length;
      pushListItem(indent, unorderedItem ? "ul" : "ol", inlineMarkdown(escapeHtml(listItem[2])));
      continue;
    }

    closeList();
    flushQuote();
    paragraph.push(line.trimStart());
  }

  flushParagraph();
  closeList();
  flushQuote();
  flushCustomBlock();
  if (inCode) html.push(`${codeOpen}${codeLines.join("\n")}</code></pre>`);
  return html.join("\n");
}

// GFM 表格：表头行 + 分隔行（| --- | :---: |）+ 若干数据行。返回 { html, end }，end 为最后一行的下标。
function parseMarkdownTable(lines, start) {
  const header = lines[start];
  const divider = lines[start + 1];
  if (!header || !divider || !header.includes("|") || !divider.includes("|")) return null;
  if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(divider)) return null;

  const heads = markdownTableCells(header);
  const aligns = markdownTableCells(divider).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "";
  });
  if (!heads.length || heads.length !== aligns.length) return null;

  const cellHtml = (tag, text, column) => {
    const align = aligns[column] ? ` style="text-align:${aligns[column]}"` : "";
    return `<${tag}${align}>${inlineMarkdown(escapeHtml(text))}</${tag}>`;
  };
  const rows = [];
  let end = start + 1;
  while (end + 1 < lines.length && lines[end + 1].trim() && lines[end + 1].includes("|")) {
    end += 1;
    const cells = markdownTableCells(lines[end]);
    rows.push(`<tr>${heads.map((_head, column) => cellHtml("td", cells[column] || "", column)).join("")}</tr>`);
  }
  const head = `<thead><tr>${heads.map((text, column) => cellHtml("th", text, column)).join("")}</tr></thead>`;
  const body = rows.length ? `<tbody>${rows.join("")}</tbody>` : "";
  // 外包一层滚动容器：表格本身保持 display:table 撑满宽度，列多时在容器内横向滚动。
  return { html: `<div class="table-wrap"><table>${head}${body}</table></div>`, end };
}

// 拆一行表格单元格：去掉首尾竖线，支持 \| 转义。
function markdownTableCells(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function customBlockTitle(type) {
  const titles = {
    tip: "TIP",
    info: "INFO",
    note: "NOTE",
    warning: "WARNING",
    danger: "DANGER",
  };
  return titles[type] || type.toUpperCase();
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function inlineMarkdown(html) {
  // 先把行内代码抽成占位符，避免代码里的 * [ ] ( ) 被当成强调或链接语法。
  const codeSpans = [];
  const withPlaceholders = html.replace(/`([^`]+)`/g, (_match, code) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  // URL 部分允许一层成对括号，兼容历史内容里未编码的 "file (1).pdf" 类链接。
  const rendered = withPlaceholders
    .replace(/&lt;a\s+([\s\S]*?)&gt;([\s\S]*?)&lt;\/a&gt;/gi, renderSafeHtmlAnchor)
    .replace(/!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+)\)/g, (_match, alt, src) => {
      const safeSrc = normalizeAssetUrl(src);
      return `<img src="${safeSrc}" alt="${alt}" loading="lazy">`;
    })
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.*?)~~/g, "<del>$1</del>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)/g,
      (_match, label, href) => {
        const safeHref = href.startsWith("http") || href.startsWith("/") || href.startsWith("mailto:")
          ? normalizeInternalHref(href)
          : `/page.html?p=${href.replace(/^\.\//, "").replace(/\.html$/, "").replace(/\.md$/, "")}`;
        const rel = safeHref.startsWith("http") ? ' rel="noreferrer"' : "";
        const target = safeHref.startsWith("http") ? ' target="_blank"' : "";
        return `<a href="${safeHref}"${target}${rel}>${label}</a>`;
      },
    );

  return rendered.replace(/\u0000(\d+)\u0000/g, (_match, index) => codeSpans[Number(index)]);
}

function renderSafeHtmlAnchor(_match, rawAttrs, label) {
  const attrs = parseEscapedHtmlAttributes(rawAttrs);
  const href = safeLinkUrl(attrs.href || "");
  if (!href) return label;

  const normalizedHref = normalizeInternalHref(href);
  const classes = String(attrs.class || "")
    .split(/\s+/)
    .filter((name) => name === "link-button")
    .join(" ");
  const classAttr = classes ? ` class="${classes}"` : "";
  const target = attrs.target === "_blank" || normalizedHref.startsWith("http") ? ' target="_blank"' : "";
  const rel = target ? ' rel="noopener noreferrer"' : "";
  const ariaLabel = attrs["aria-label"] ? ` aria-label="${escapeHtml(attrs["aria-label"])}"` : "";
  const title = attrs.title ? ` title="${escapeHtml(attrs.title)}"` : "";
  return `<a${classAttr} href="${escapeHtml(normalizedHref)}"${target}${rel}${ariaLabel}${title}>${label}</a>`;
}

function parseEscapedHtmlAttributes(rawAttrs) {
  const attrs = {};
  const pattern = /([a-zA-Z:-]+)\s*=\s*(?:&quot;([\s\S]*?)&quot;|&#39;([\s\S]*?)&#39;|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(rawAttrs))) {
    const name = match[1].toLowerCase();
    attrs[name] = decodeEscapedAttribute(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function decodeEscapedAttribute(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeInternalHref(href) {
  if (!href.startsWith("/") || href.startsWith("/page.html") || href.startsWith("/post.html") || href.startsWith("/media/")) {
    return href;
  }

  const markdownAsset = href.split(/[?#]/, 1)[0].match(/^\/(.+)\.md$/i);
  if (markdownAsset) {
    return `/media/${markdownAsset[1]}.md`;
  }

  return href;
}

function normalizeAssetUrl(value) {
  const normalized = normalizeLegacyMediaUrl(String(value || "").trim());
  if (normalized.startsWith("http") || normalized.startsWith("/media/") || normalized.startsWith("/logo")) {
    return normalized;
  }
  if (normalized.startsWith("media/")) return `/${normalized}`;
  if (normalized.startsWith("/avatars/")) return normalized.replace("/avatars/", "/media/avatars/");
  if (normalized.startsWith("/avatars,")) return normalized.replace("/avatars,", "/media/avatars/");
  return normalized;
}

function normalizeLegacyMediaUrl(value) {
  return value
    .replace(/^(https?:\/\/[^/]+\/media\/(?:avatars|hall-of-fame|posts|knowledge|site)),/i, "$1/")
    .replace(/^(\/media\/(?:avatars|hall-of-fame|posts|knowledge|site)),/i, "$1/")
    .replace(/^media\/(avatars|hall-of-fame|posts|knowledge|site),/i, "media/$1/")
    .replace(/^\/avatars,/i, "/media/avatars/");
}

function safeDisplayAssetUrl(value) {
  const raw = normalizeAssetUrl(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("/media/") || raw.startsWith("/images/") || raw.startsWith("/logo")) {
    return raw;
  }
  return "";
}

// 文章 hero 已展示标题；正文若以同名一级标题开头则去掉，避免页面出现两个相同 h1。
function stripDuplicateLeadingTitle(markdown, title) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return markdown;
  const lines = stripFrontmatter(markdown).replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  const heading = lines[index]?.match(/^#\s+(.+?)\s*$/);
  if (!heading || heading[1].trim() !== cleanTitle) return markdown;
  lines.splice(index, 1);
  return lines.join("\n");
}

function firstHeading(markdown) {
  const match = stripFrontmatter(markdown).match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function articleHeadingSlug(value, fallback) {
  return String(value || "")
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

// 渲染后增强 .article-body（文章 / 固定页 / 部门页 / 后台预览 / 403 共用，幂等）：
//   1. 直接子级 h1–h4 分配稳定 id 并加 “#” 锚点；
//   2. <pre> 外包 .code-block，顶栏显示语言标签与复制按钮。
// yuna-ui.js 会对页面上所有 .article-body 自动调用；posts.js 渲染后也立即调用以生成目录。
function enhanceArticleBody(body) {
  if (!(body instanceof Element)) return;
  const headings = Array.from(body.children).filter((node) => node.matches("h1, h2, h3, h4"));
  headings.forEach((heading, index) => {
    if (heading.querySelector(":scope > .heading-anchor")) return;
    const label = heading.textContent.trim() || `章节 ${index + 1}`;
    if (!heading.id) {
      const baseId = `article-${articleHeadingSlug(label, `section-${index + 1}`)}`;
      let id = baseId;
      let suffix = 2;
      while (document.getElementById(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      heading.id = id;
    }
    const anchor = document.createElement("a");
    anchor.className = "heading-anchor";
    anchor.href = `#${heading.id}`;
    anchor.setAttribute("aria-label", `链接到本节：${label}`);
    anchor.textContent = "#";
    heading.append(anchor);
  });

  body.querySelectorAll("pre").forEach((pre) => {
    if (pre.parentElement?.classList.contains("code-block")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "code-block";
    const head = document.createElement("div");
    head.className = "code-block-head";
    const lang = document.createElement("span");
    lang.className = "code-block-lang";
    lang.textContent = pre.dataset.lang || "text";
    const button = document.createElement("button");
    button.className = "code-copy";
    button.type = "button";
    button.setAttribute("aria-label", "复制代码");
    button.textContent = "复制";
    head.append(lang, button);
    pre.replaceWith(wrapper);
    wrapper.append(head, pre);
    let timer = 0;
    button.addEventListener("click", async () => {
      const text = pre.textContent || "";
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
        area.remove();
      }
      button.textContent = ok ? "已复制" : "复制失败";
      button.classList.toggle("is-done", ok);
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = "复制";
        button.classList.remove("is-done");
      }, 1800);
    });
  });
}

Object.assign(window.blog, {
  markdownToHtml,
  enhanceArticleBody,
  normalizeAssetUrl,
  safeDisplayAssetUrl,
});
