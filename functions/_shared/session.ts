import { getCookie, serializeCookie, signValue, verifySignedValue } from "./cookies";
import type { Env, UserSession } from "./types";

export const SESSION_COOKIE = "blog_session";
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
  const allowlist = (env.ADMIN_EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.length === 0 || allowlist.includes(email.toLowerCase());
}

export function isAllowedAdminIdentity(env: Env, identities: string[]): boolean {
  const allowlist = (env.ADMIN_EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length === 0) return true;

  return identities
    .map((identity) => identity.trim().toLowerCase())
    .filter(Boolean)
    .some((identity) => allowlist.includes(identity));
}

async function currentSessionId(env: Env, request: Request): Promise<string | null> {
  return verifySignedValue(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
}
