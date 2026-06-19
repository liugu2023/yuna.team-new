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
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      "set-cookie": stateCookie,
    },
  });
};
