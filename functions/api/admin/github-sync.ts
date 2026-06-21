import { json } from "../../_shared/http";
import { syncMarkdownToGitHub } from "../../_shared/github-markdown-sync";
import { getAdminIdentity } from "../../_shared/session";
import type { Env } from "../../_shared/types";

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const admin = await getAdminIdentity(env, request);
  if (!admin) {
    return json({ error: "需要管理员登录" }, { status: 401 });
  }

  const result = await syncMarkdownToGitHub(env, {
    reason: "manual",
    actor: admin,
  });
  return json(result);
};
