export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 });
}

export function unauthorized(): Response {
  return json({ error: "需要登录" }, { status: 401 });
}

export function forbidden(): Response {
  return json({ error: "没有访问权限" }, { status: 403 });
}

export function notFound(message = "内容不存在"): Response {
  return json({ error: message }, { status: 404 });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

// 登录跳转的白名单校验：只接受本站内的相对路径，挡掉开放重定向。
// 用固定假域名解析，任何绝对 URL（含 //evil.com 这种协议相对写法）都会因为
// origin 不同被拒；登录/回调自身的路径也排除，避免绕回形成循环。
export function safeReturnTo(value: string | null): string {
  if (!value) return "/";

  try {
    const parsed = new URL(value, "https://yuna.local");
    if (parsed.origin !== "https://yuna.local") return "/";

    const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!target.startsWith("/") || target.startsWith("//")) return "/";
    if (target.startsWith("/api/auth/login") || target.startsWith("/auth/callback")) return "/";
    return target;
  } catch {
    return "/";
  }
}
