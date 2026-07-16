import { serializeCookie, signValue } from "../../_shared/cookies";
import { getDiscovery, redirectUri } from "../../_shared/oidc";
import type { Env } from "../../_shared/types";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const discovery = await getDiscovery(env);
  const requestUrl = new URL(request.url);
  const state = crypto.randomUUID();
  const stateCookie = serializeCookie(
    "oidc_state",
    await signValue(state, env.SESSION_SECRET),
    { maxAge: 300 },
  );
  const returnToCookie = serializeCookie(
    "login_return_to",
    await signValue(safeReturnTo(requestUrl.searchParams.get("return_to")), env.SESSION_SECRET),
    { maxAge: 300 },
  );

  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", env.ZITADEL_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(env, request));
  url.searchParams.set("response_type", "code");
  // 同时请求新旧两种 Zitadel 项目角色 scope，兼容不同实例版本。
  // 项目侧也应开启 Assert Roles on Authentication。
  url.searchParams.set(
    "scope",
    "openid email profile urn:iam:org:project:roles urn:zitadel:iam:org:projects:roles",
  );
  url.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: [
      ["location", url.toString()],
      ["set-cookie", stateCookie],
      ["set-cookie", returnToCookie],
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
