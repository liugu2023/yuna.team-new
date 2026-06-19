const state = { editingSlug: null };
const fields = {
  title: document.querySelector("[data-title]"),
  slug: document.querySelector("[data-slug]"),
  excerpt: document.querySelector("[data-excerpt]"),
  status: document.querySelector("[data-status]"),
  markdown: document.querySelector("[data-markdown]"),
  message: document.querySelector("[data-message]"),
  delete: document.querySelector("[data-delete]"),
};

async function bootAdmin() {
  const authPanel = document.querySelector("[data-auth-panel]");
  const editor = document.querySelector("[data-editor]");
  const me = await window.blog.fetchJson("/api/auth/me");

  if (!me.admin) {
    authPanel.innerHTML = '<a class="button" href="/api/auth/login">Login with Authentik</a>';
    return;
  }

  authPanel.hidden = true;
  editor.hidden = false;
  await window.blog.renderPostList({ admin: true });

  const slug = new URLSearchParams(location.search).get("slug");
  if (slug) await loadPost(slug);
}

async function loadPost(slug) {
  const data = await window.blog.fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
  state.editingSlug = slug;
  fields.title.value = data.post.title;
  fields.slug.value = data.post.slug;
  fields.slug.disabled = true;
  fields.excerpt.value = data.post.excerpt || "";
  fields.status.value = data.post.status;
  fields.markdown.value = data.markdown;
  fields.delete.hidden = false;
  fields.message.textContent = `Editing ${slug}`;
}

async function savePost() {
  const payload = {
    title: fields.title.value.trim(),
    slug: fields.slug.value.trim(),
    excerpt: fields.excerpt.value.trim(),
    status: fields.status.value,
    markdown: fields.markdown.value,
  };

  const url = state.editingSlug
    ? `/api/posts/${encodeURIComponent(state.editingSlug)}`
    : "/api/posts";
  const method = state.editingSlug ? "PUT" : "POST";

  try {
    const data = await window.blog.fetchJson(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.editingSlug = data.post.slug;
    fields.slug.disabled = true;
    fields.delete.hidden = false;
    fields.message.textContent = "Saved.";
    await window.blog.renderPostList({ admin: true });
    history.replaceState(null, "", `/admin/?slug=${data.post.slug}`);
  } catch (error) {
    fields.message.textContent = error.message;
  }
}

async function deletePost() {
  if (!state.editingSlug) return;
  if (!confirm(`Delete ${state.editingSlug}?`)) return;

  await window.blog.fetchJson(`/api/posts/${encodeURIComponent(state.editingSlug)}`, {
    method: "DELETE",
  });
  resetEditor();
  await window.blog.renderPostList({ admin: true });
}

function resetEditor() {
  state.editingSlug = null;
  fields.title.value = "";
  fields.slug.value = "";
  fields.slug.disabled = false;
  fields.excerpt.value = "";
  fields.status.value = "draft";
  fields.markdown.value = "";
  fields.delete.hidden = true;
  fields.message.textContent = "";
  history.replaceState(null, "", "/admin/");
}

document.querySelector("[data-save]").addEventListener("click", savePost);
document.querySelector("[data-new]").addEventListener("click", resetEditor);
fields.delete.addEventListener("click", deletePost);
bootAdmin().catch((error) => {
  document.querySelector("[data-auth-panel]").textContent = error.message;
});
