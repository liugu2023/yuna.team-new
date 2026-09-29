/** Resolve website links without turning mailto: into a page path or exposing unsafe protocols. */
export function resolveSafeLink(value: unknown, base: string, pagePath = "/"): string {
  const raw = String(value ?? "").trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return "";
  try {
    const page = new URL(pagePath, `${base.replace(/\/+$/, "")}/`);
    const url = new URL(raw, page);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
