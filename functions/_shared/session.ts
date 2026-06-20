import { getCookie, serializeCookie, signValue, verifySignedValue } from "./cookies";
import type { Env, UserSession } from "./types";

export const SESSION_COOKIE = "yuna_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export async function createSession(
  env: Env,
  user: { email: string; name?: string; groups?: string[] },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;

  // 顺手清理过期会话，避免 sessions 表只增不减。
  await env.BLOG_DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();

  // 登录时把 Authentik 用户组快照进会话，供后续请求免去重复回源。
  const groups = JSON.stringify(Array.isArray(user.groups) ? user.groups : []);

  await env.BLOG_DB.prepare(
    "INSERT INTO sessions (id, user_email, user_name, user_groups, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, user.email, user.name ?? "", groups, expiresAt)
    .run();

  return serializeCookie(SESSION_COOKIE, await signValue(id, env.SESSION_SECRET), {
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession(env: Env, request: Request): Promise<string> {
  const id = await currentSessionId(env, request);
  if (id) {
    await env.BLOG_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  }

  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0 });
}

export async function getSession(env: Env, request: Request): Promise<UserSession | null> {
  const id = await currentSessionId(env, request);
  if (!id) return null;

  const session = await env.BLOG_DB.prepare(
    "SELECT id, user_email, user_name, user_groups, expires_at FROM sessions WHERE id = ?",
  )
    .bind(id)
    .first<UserSession>();

  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) {
    await env.BLOG_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }

  return session;
}

export function isAllowedAdmin(env: Env, session: UserSession): boolean {
  const email = session.user_email;
  if (!email) return false;

  // 1) 优先用 Authentik 用户组判定：配置了 ADMIN_GROUP 且会话用户组命中即放行。
  //    增删管理员只需在 Authentik 改组成员，无需改代码或重新部署。
  const adminGroup = (env.ADMIN_GROUP ?? "").trim();
  if (adminGroup && parseGroups(session.user_groups).includes(adminGroup)) {
    return true;
  }

  // 2) 兜底白名单：Authentik 还没配好时用 ADMIN_IDENTITY_ALLOWLIST（逗号分隔、大小写不敏感）。
  const allowlist = (env.ADMIN_IDENTITY_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length > 0) {
    return allowlist.includes(email.toLowerCase());
  }

  // 3) 两者都没配：沿用既有行为，信任 Authentik 应用层授权，任何登录成员即管理员。
  return adminGroup ? false : true;
}

export function isAllowedContentEditor(env: Env, session: UserSession): boolean {
  const email = session.user_email;
  if (!email) return false;

  const editorGroup = (env.CONTENT_EDITOR_GROUP ?? "").trim();
  if (editorGroup && parseGroups(session.user_groups).includes(editorGroup)) {
    return true;
  }

  const allowlist = (env.CONTENT_EDITOR_IDENTITY_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length > 0) {
    return allowlist.includes(email.toLowerCase());
  }

  return isAllowedAdmin(env, session);
}

function parseGroups(raw: string): string[] {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export async function getAdminIdentity(env: Env, request: Request): Promise<string | null> {
  const session = await getSession(env, request);
  if (session && isAllowedAdmin(env, session)) return session.user_email;

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (env.MIGRATION_TOKEN && token && token === env.MIGRATION_TOKEN) {
    return "migration";
  }

  return null;
}

export async function getContentEditorIdentity(env: Env, request: Request): Promise<string | null> {
  const session = await getSession(env, request);
  if (session && isAllowedContentEditor(env, session)) return session.user_email;

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (env.MIGRATION_TOKEN && token && token === env.MIGRATION_TOKEN) {
    return "migration";
  }

  return null;
}

async function currentSessionId(env: Env, request: Request): Promise<string | null> {
  return verifySignedValue(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
}
