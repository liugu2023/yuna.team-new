import { getCookie, serializeCookie, signValue, verifySignedValue } from "./cookies";
import type { Env, UserSession } from "./types";

export const SESSION_COOKIE = "yuna_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export async function createSession(
  env: Env,
  user: { email: string; name?: string },
): Promise<string> {
  const id = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

  await env.BLOG_DB.prepare(
    "INSERT INTO sessions (id, user_email, user_name, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, user.email, user.name ?? "", expiresAt)
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
    "SELECT id, user_email, user_name, expires_at FROM sessions WHERE id = ?",
  )
    .bind(id)
    .first<UserSession>();

  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) {
    await env.BLOG_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }

  return session;
}

export function isAllowedAdmin(env: Env, email: string): boolean {
  return Boolean(email);
}

export async function getAdminIdentity(env: Env, request: Request): Promise<string | null> {
  const session = await getSession(env, request);
  if (session && isAllowedAdmin(env, session.user_email)) return session.user_email;

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
