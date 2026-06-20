import { getSession, isAllowedAdmin } from "../_shared/session";
import type { Env } from "../_shared/types";

export const onRequest: PagesFunction<Env> = async ({ env, request, next }) => {
  const session = await getSession(env, request);
  if (!session || !isAllowedAdmin(env, session)) {
    const url = new URL("/api/auth/login", request.url);
    return Response.redirect(url.toString(), 302);
  }

  return next();
};
