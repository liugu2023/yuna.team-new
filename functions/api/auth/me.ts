import { json } from "../../_shared/http";
import { getSession, isAllowedAdmin, isAllowedContentEditor } from "../../_shared/session";
import type { Env } from "../../_shared/types";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const session = await getSession(env, request);
  return json({
    authenticated: Boolean(session),
    admin: Boolean(session && isAllowedAdmin(env, session)),
    contentEditor: Boolean(session && isAllowedContentEditor(env, session)),
    user: session
      ? {
          email: session.user_email,
          name: session.user_name,
          expiresAt: session.expires_at,
        }
      : null,
  });
};
