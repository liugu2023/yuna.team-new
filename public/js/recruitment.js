// 招新状态：读 site_records 的 recruitment-status，切换页面上 [data-recruitment="open|closed"] 的显隐。
//
// 约定（重要）：记录缺失、解析失败或读取出错，一律按「招新进行中」处理。
// 宁可少显示，也不能因为读不到数据就把「本届招新已结束」这种话展示出去。
//
// 用法：给「招新进行中才显示」的节点加 data-recruitment="open"，
//       给「招新结束才显示」的节点加 data-recruitment="closed"（同时在 HTML 里先写 hidden，
//       这样禁用 JS 时也不会闪出结束态内容）。
(function () {
  const KEY = "recruitment-status";
  if (!document.querySelector("[data-recruitment]")) return;

  function apply(closed) {
    document.documentElement.dataset.recruitment = closed ? "closed" : "open";
    document.querySelectorAll('[data-recruitment="closed"]').forEach((node) => {
      node.hidden = !closed;
    });
    document.querySelectorAll('[data-recruitment="open"]').forEach((node) => {
      node.hidden = closed;
    });
  }

  // 先按「进行中」渲染，避免接口返回前闪一下结束态
  apply(false);

  if (!window.blog || typeof window.blog.fetchJson !== "function") return;
  window.blog
    .fetchJson(`/api/site?keys=${KEY}`)
    .then((data) => {
      const record = data && data.records ? data.records[KEY] : null;
      if (!record || record.kind !== "json") return;
      let parsed = null;
      try {
        parsed = JSON.parse(record.content || "{}");
      } catch {
        return;
      }
      if (parsed && typeof parsed.closed === "boolean") apply(parsed.closed);
    })
    .catch(() => {});
})();
