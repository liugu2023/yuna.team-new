import { destroySession } from "../../_shared/session";
import type { Env } from "../../_shared/types";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const sessionCookie = await destroySession(env, request);
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": sessionCookie,
    },
  });
};
