import { getCookie, serializeCookie, verifySignedValue } from "../_shared/cookies";
import { exchangeCode, getUserInfo, redirectUri } from "../_shared/oidc";
import { createSession } from "../_shared/session";
import type { Env } from "../_shared/types";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = await verifySignedValue(getCookie(request, "oidc_state"), env.SESSION_SECRET);
  const returnTo = safeReturnTo(
    await verifySignedValue(getCookie(request, "login_return_to"), env.SESSION_SECRET),
  );

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("登录回调无效，请重新登录。", { status: 400 });
  }

  // 回调发生在用户实际访问的域名上(可能由 CDN 反代转发),换码用的
  // redirect_uri 也按同一规则解析,与 login 时发给 Authentik 的保持一致。
  const token = await exchangeCode(env, code, redirectUri(env, request));
  const userInfo = await getUserInfo(env, token.access_token);
  const identity = userInfo.email ?? userInfo.preferred_username;

  if (!identity) {
    return new Response("登录成功，但 Authentik 没有返回邮箱或用户名，无法创建后台会话。", {
      status: 403,
    });
  }

  const sessionCookie = await createSession(env, {
    email: identity,
    name: userInfo.name ?? userInfo.preferred_username ?? "",
    groups: Array.isArray(userInfo.groups) ? userInfo.groups : [],
  });

  return new Response(null, {
    status: 302,
    headers: [
      ["location", returnTo],
      ["set-cookie", sessionCookie],
      ["set-cookie", serializeCookie("oidc_state", "", { maxAge: 0 })],
      ["set-cookie", serializeCookie("login_return_to", "", { maxAge: 0 })],
    ],
  });
};

function safeReturnTo(value: string | null): string {
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
