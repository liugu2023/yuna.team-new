import { destroySession } from "../../_shared/session";
import type { Env } from "../../_shared/types";

// 登出改为 POST，避免被 <img>/<a> 形式的 CSRF 强制登出。
// SameSite=Lax 的会话 cookie 不会随跨站 POST 发出，因此跨站调用拿不到会话、无法销毁。
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const sessionCookie = await destroySession(env, request);
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": sessionCookie,
    },
  });
};
