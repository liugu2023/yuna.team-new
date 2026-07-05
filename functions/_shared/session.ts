import { getCookie, serializeCookie, signValue, timingSafeStringEqual, verifySignedValue } from "./cookies";
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
  return isAllowedControl(env, session);
}

export function isAllowedContentEditor(env: Env, session: UserSession): boolean {
  return isAllowedControl(env, session);
}

export function getSessionGroups(session: UserSession): string[] {
  return parseGroups(session.user_groups);
}

function isAllowedControl(env: Env, session: UserSession): boolean {
  if (!session.user_email) return false;
  const controlGroup = (env.CONTROL_GROUP ?? "").trim();
  if (!controlGroup) return false;
  return parseGroups(session.user_groups).includes(controlGroup);
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

  return null;
}

export async function getContentEditorIdentity(env: Env, request: Request): Promise<string | null> {
  const session = await getSession(env, request);
  if (session && isAllowedContentEditor(env, session)) return session.user_email;

  return null;
}

export function getR2MigrationIdentity(env: Env, request: Request): string | null {
  const token = bearerToken(request);
  if (env.R2_MIGRATION_TOKEN && token && timingSafeStringEqual(token, env.R2_MIGRATION_TOKEN)) {
    return "r2-migration";
  }

  return null;
}

async function currentSessionId(env: Env, request: Request): Promise<string | null> {
  return verifySignedValue(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}
