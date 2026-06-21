import { json } from "../../_shared/http";
import {
  getSession,
  getSessionGroups,
  isAllowedAdmin,
  isAllowedContentEditor,
} from "../../_shared/session";
import type { Env } from "../../_shared/types";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const session = await getSession(env, request);
  const groups = session ? getSessionGroups(session) : [];
  const controlGroup = (env.CONTROL_GROUP || "").trim();
  return json({
    authenticated: Boolean(session),
    admin: Boolean(session && isAllowedAdmin(env, session)),
    contentEditor: Boolean(session && isAllowedContentEditor(env, session)),
    user: session
      ? {
          email: session.user_email,
          name: session.user_name,
          expiresAt: session.expires_at,
          groups,
        }
      : null,
    authz: {
      controlGroup,
      controlGroupMatched: Boolean(controlGroup && groups.includes(controlGroup)),
    },
  });
};
