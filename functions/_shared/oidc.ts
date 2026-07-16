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
  [claim: string]: unknown;
}

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

// 同一 Worker 实例内缓存 discovery，避免每次登录回调重复拉取 .well-known。
const discoveryCache = new Map<string, OidcDiscovery>();

export async function getDiscovery(env: Env): Promise<OidcDiscovery> {
  const issuer = env.ZITADEL_ISSUER.replace(/\/+$/, "");
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;

  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error("无法加载 Zitadel OIDC 配置");
  const discovery = await response.json<OidcDiscovery>();
  discoveryCache.set(issuer, discovery);
  return discovery;
}

// 站点可能通过多个 CNAME 域名访问,登录回调必须回到用户实际访问的域名,
// 否则 oidc_state cookie 与回调不在同一域下,state 校验必然失败。
// 名单 = PUBLIC_BASE_URL + SSO_ALLOWED_HOSTS(逗号分隔,可写主机名或完整 origin)。
export function allowedOrigins(env: Env): Set<string> {
  const allowed = new Set<string>();
  const canonical = canonicalOrigin(env);
  if (canonical) allowed.add(canonical);
  for (const entry of (env.SSO_ALLOWED_HOSTS ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      allowed.add(new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).origin);
    } catch {
      // 名单里的坏条目直接跳过,不影响其余域名登录。
    }
  }
  return allowed;
}

function canonicalOrigin(env: Env): string | null {
  try {
    return new URL(env.PUBLIC_BASE_URL).origin;
  } catch {
    return null;
  }
}

// 裸域可能经外部 CDN(如阿里云)反代回源 pages.dev,此时 request.url 是回源
// Host 而非用户访问的域名,需要 CDN 回源时带 X-Forwarded-Host 头声明原始域名。
// 该头只有落在允许名单内才被采信,直连伪造它拿不到任何名单外的回调地址。
export function effectiveOrigin(env: Env, request: Request): string {
  const allowed = allowedOrigins(env);
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwarded && allowed.has(`https://${forwarded}`)) return `https://${forwarded}`;

  const requestOrigin = new URL(request.url).origin;
  if (allowed.has(requestOrigin)) return requestOrigin;
  return canonicalOrigin(env) ?? requestOrigin;
}

export function redirectUri(env: Env, request: Request): string {
  return new URL(env.ZITADEL_REDIRECT_PATH, effectiveOrigin(env, request)).toString();
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
    // 必须与授权请求时的 redirect_uri 完全一致,否则 Zitadel 拒绝换码。
    redirect_uri: callbackUri,
  });

  // Zitadel Web 应用的 Client Secret Basic 要求凭据位于 Authorization 头中。
  // encodeURIComponent 对齐 OAuth 2.0 对 client_id/client_secret 的 form-url-encode 要求。
  const credentials = btoa(
    `${encodeURIComponent(env.ZITADEL_CLIENT_ID)}:${encodeURIComponent(env.ZITADEL_CLIENT_SECRET)}`,
  );

  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
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

  if (!response.ok) throw new Error("无法读取 Zitadel 用户信息");
  return response.json<UserInfo>();
}

// Zitadel 将项目角色放在 urn:zitadel:iam:org:project:*:roles claim 中，
// 值是以角色 key 为键的对象。这里同时接受 groups，便于已有会话平滑过渡。
export function getUserRoles(userInfo: UserInfo): string[] {
  const roles = new Set(Array.isArray(userInfo.groups) ? userInfo.groups : []);
  for (const [claim, value] of Object.entries(userInfo)) {
    if (!/^urn:(?:zitadel:)?iam:org:project(?::[^:]+|s)?:roles$/.test(claim)) continue;
    if (Array.isArray(value)) {
      for (const role of value) if (typeof role === "string" && role) roles.add(role);
      continue;
    }
    if (typeof value === "string" && value) {
      roles.add(value);
      continue;
    }
    if (value && typeof value === "object") {
      for (const role of Object.keys(value)) roles.add(role);
    }
  }
  return [...roles];
}
