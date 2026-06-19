import { getCookie, serializeCookie, verifySignedValue } from "../_shared/cookies";
import { exchangeCode, getUserInfo } from "../_shared/oidc";
import { createSession, isAllowedAdminIdentity } from "../_shared/session";
import type { Env } from "../_shared/types";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = await verifySignedValue(getCookie(request, "oidc_state"), env.SESSION_SECRET);

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("Invalid OIDC callback", { status: 400 });
  }

  const token = await exchangeCode(env, code);
  const userInfo = await getUserInfo(env, token.access_token);
  const identity = userInfo.email ?? userInfo.preferred_username;

  if (!identity) {
    return new Response("登录成功，但 Authentik 没有返回邮箱或用户名，无法创建后台会话。", {
      status: 403,
    });
  }

  if (!isAllowedAdminIdentity(env, [userInfo.email ?? "", userInfo.preferred_username ?? ""])) {
    return new Response("当前账号没有博客后台管理权限，请检查 ADMIN_EMAIL_ALLOWLIST。", {
      status: 403,
    });
  }

  const sessionCookie = await createSession(env, {
    email: identity,
    name: userInfo.name ?? userInfo.preferred_username ?? "",
  });

  return new Response(null, {
    status: 302,
    headers: [
      ["location", "/admin/"],
      ["set-cookie", sessionCookie],
      ["set-cookie", serializeCookie("oidc_state", "", { maxAge: 0 })],
    ],
  });
};
