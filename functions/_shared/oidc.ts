import type { Env } from "./types";

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
}

export interface UserInfo {
  email?: string;
  name?: string;
  preferred_username?: string;
}

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

export async function getDiscovery(env: Env): Promise<OidcDiscovery> {
  const issuer = env.AUTHENTIK_ISSUER.replace(/\/+$/, "");
  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error("Unable to load Authentik OIDC discovery");
  return response.json<OidcDiscovery>();
}

export function redirectUri(env: Env): string {
  return new URL(env.AUTHENTIK_REDIRECT_PATH, env.PUBLIC_BASE_URL).toString();
}

export async function exchangeCode(env: Env, code: string): Promise<TokenResponse> {
  const discovery = await getDiscovery(env);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(env),
    client_id: env.AUTHENTIK_CLIENT_ID,
    client_secret: env.AUTHENTIK_CLIENT_SECRET,
  });

  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) throw new Error("Auth code exchange failed");
  return response.json<TokenResponse>();
}

export async function getUserInfo(env: Env, accessToken: string): Promise<UserInfo> {
  const discovery = await getDiscovery(env);
  const response = await fetch(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) throw new Error("Unable to load userinfo");
  return response.json<UserInfo>();
}
