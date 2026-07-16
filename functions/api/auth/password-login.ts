import { timingSafeStringEqual } from "../../_shared/cookies";
import { json, readJson } from "../../_shared/http";
import { createSession } from "../../_shared/session";
import type { Env } from "../../_shared/types";

interface LoginBody {
  username?: string;
  password?: string;
}

// 备用账密登录:仅在同时配置了 FALLBACK_ADMIN_USER / FALLBACK_ADMIN_PASSWORD 时启用,
// 供 Zitadel 网关不可用时进入后台。凭据核对通过后走与 OIDC 回调完全相同的会话通道,
// 用户组直接写入 CONTROL_GROUP,后台权限判定、退出登录均复用现有逻辑。
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const expectedUser = (env.FALLBACK_ADMIN_USER || "").trim();
  const expectedPassword = env.FALLBACK_ADMIN_PASSWORD || "";
  if (!expectedUser || !expectedPassword) {
    return json({ error: "备用登录未启用" }, { status: 404 });
  }

  const body = await readJson<LoginBody>(request);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const userOk = username.length > 0 && timingSafeStringEqual(username, expectedUser);
  const passwordOk = password.length > 0 && timingSafeStringEqual(password, expectedPassword);
  if (!userOk || !passwordOk) {
    // 失败统一延迟、统一文案:不区分账号还是密码错,顺带拖慢在线爆破。
    await new Promise((resolve) => setTimeout(resolve, 800));
    return json({ error: "账号或密码不正确" }, { status: 401 });
  }

  const controlGroup = (env.CONTROL_GROUP || "").trim();
  const sessionCookie = await createSession(env, {
    email: expectedUser,
    name: "备用管理员",
    groups: controlGroup ? [controlGroup] : [],
  });

  return json({ ok: true }, { headers: { "set-cookie": sessionCookie } });
};
