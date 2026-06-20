import { serializeCookie, signValue } from "../../_shared/cookies";
import { getDiscovery, redirectUri } from "../../_shared/oidc";
import type { Env } from "../../_shared/types";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const discovery = await getDiscovery(env);
  const state = crypto.randomUUID();
  const stateCookie = serializeCookie(
    "oidc_state",
    await signValue(state, env.SESSION_SECRET),
    { maxAge: 300 },
  );

  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", env.AUTHENTIK_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(env));
  url.searchParams.set("response_type", "code");
  // 额外申请 groups，让 Authentik 在 userinfo 中返回用户组用于后台权限判定。
  // 需在 Authentik 侧配置一个返回 groups 的 Scope Mapping，scope 名为 groups。
  url.searchParams.set("scope", "openid email profile groups");
  url.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      "set-cookie": stateCookie,
    },
  });
};
