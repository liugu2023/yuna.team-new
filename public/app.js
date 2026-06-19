async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function formatDate(value) {
  if (!value) return "Unpublished";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inCode = false;
  let paragraph = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineMarkdown(escapeHtml(paragraph.join(" ")))}</p>`);
    paragraph = [];
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        flushParagraph();
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

function inlineMarkdown(html) {
  return html
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
}

async function renderPostList({ admin = false } = {}) {
  const list = document.querySelector("[data-post-list]");
  if (!list) return;

  try {
    const data = await fetchJson(`/api/posts${admin ? "?drafts=1" : ""}`);
    if (!data.posts.length) {
      list.innerHTML = '<p class="empty">No posts yet.</p>';
      return;
    }

    list.innerHTML = data.posts
      .map(
        (post) => `
          <article class="post-card">
            <p class="meta">${post.status} · ${formatDate(post.published_at || post.updated_at)}</p>
            <h2><a href="${admin ? `/admin/?slug=${post.slug}` : `/post.html?slug=${post.slug}`}">${escapeHtml(post.title)}</a></h2>
            <p>${escapeHtml(post.excerpt || "")}</p>
          </article>
        `,
      )
      .join("");
  } catch (error) {
    list.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function renderPost() {
  const article = document.querySelector("[data-article]");
  if (!article) return;

  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug) {
    article.innerHTML = '<p class="error">Missing post slug.</p>';
    return;
  }

  try {
    const data = await fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
    document.title = `${data.post.title} · Markdown Blog`;
    article.innerHTML = `
      <p class="meta">${formatDate(data.post.published_at || data.post.updated_at)}</p>
      <h1>${escapeHtml(data.post.title)}</h1>
      <div class="article-body">${markdownToHtml(data.markdown)}</div>
    `;
  } catch (error) {
    article.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

window.blog = {
  fetchJson,
  formatDate,
  escapeHtml,
  markdownToHtml,
  renderPostList,
  renderPost,
};
