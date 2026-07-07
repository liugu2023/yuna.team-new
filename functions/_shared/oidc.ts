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
  groups?: string[];
}

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

// 同一 Worker 实例内缓存 discovery，避免每次登录回调重复拉取 .well-known。
const discoveryCache = new Map<string, OidcDiscovery>();

export async function getDiscovery(env: Env): Promise<OidcDiscovery> {
  const issuer = env.AUTHENTIK_ISSUER.replace(/\/+$/, "");
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;

  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error("无法加载 Authentik OIDC 配置");
  const discovery = await response.json<OidcDiscovery>();
  discoveryCache.set(issuer, discovery);
  return discovery;
}

// 站点可能通过多个 CNAME 域名访问,登录回调必须回到用户实际访问的域名,
// 否则 oidc_state cookie 与回调不在同一域下,state 校验必然失败。
// 请求 origin 在允许名单内就用它,否则退回 PUBLIC_BASE_URL 的规范域名。
// 名单 = PUBLIC_BASE_URL + SSO_ALLOWED_HOSTS(逗号分隔,可写主机名或完整 origin)。
export function redirectUri(env: Env, requestUrl: URL): string {
  return new URL(env.AUTHENTIK_REDIRECT_PATH, resolveCallbackOrigin(env, requestUrl)).toString();
}

function resolveCallbackOrigin(env: Env, requestUrl: URL): string {
  const canonical = new URL(env.PUBLIC_BASE_URL).origin;
  const allowed = new Set([canonical]);
  for (const entry of (env.SSO_ALLOWED_HOSTS ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      allowed.add(new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).origin);
    } catch {
      // 名单里的坏条目直接跳过,不影响其余域名登录。
    }
  }
  return allowed.has(requestUrl.origin) ? requestUrl.origin : canonical;
}

export async function exchangeCode(
  env: Env,
  code: string,
  callbackUri: string,
): Promise<TokenResponse> {
  const discovery = await getDiscovery(env);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    // 必须与授权请求时的 redirect_uri 完全一致,否则 Authentik 拒绝换码。
    redirect_uri: callbackUri,
    client_id: env.AUTHENTIK_CLIENT_ID,
    client_secret: env.AUTHENTIK_CLIENT_SECRET,
  });

  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) throw new Error("登录授权码交换失败");
  return response.json<TokenResponse>();
}

export async function getUserInfo(env: Env, accessToken: string): Promise<UserInfo> {
  const discovery = await getDiscovery(env);
  const response = await fetch(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) throw new Error("无法读取 Authentik 用户信息");
  return response.json<UserInfo>();
}
