export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
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
