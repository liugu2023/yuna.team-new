// 收官页只补充一条人数比例，复用页内编辑的报名 / 录取数据，不另存一份统计。
(function () {
  const ratio = document.querySelector("[data-recap-ratio]");
  const signup = document.querySelector('[data-editable-block="recap-stat-signup"] [data-block-field="body"]');
  const admitted = document.querySelector('[data-editable-block="recap-stat-admitted"] [data-block-field="body"]');
  if (!ratio || !signup || !admitted) return;

  // 接受整数、规范千分位及“人 / 名”；占位、估算值和其他单位不参与计算。
  function peopleCount(node) {
    const text = node.textContent.normalize("NFKC").trim();
    const match = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(?:人|名)?$/.exec(text);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ""));
    return Number.isSafeInteger(value) ? value : null;
  }

  function renderRatio() {
    const total = peopleCount(signup);
    const count = peopleCount(admitted);
    const valid = total !== null && count !== null && total > 0 && count <= total;
    ratio.hidden = !valid;
    if (!valid) return;

    const percent = (count / total) * 100;
    const rounded = Math.round(percent * 10) / 10;
    const label = rounded === 0 && count > 0 ? "<0.1%"
      : rounded === 100 && count < total ? ">99.9%" : `${rounded}%`;
    ratio.querySelector("[data-recap-percent]").textContent = label;
    ratio.querySelector("[data-recap-ratio-bar]").style.width = `${percent}%`;
    ratio.querySelector("[data-recap-ratio-caption]").textContent =
      `报名 ${total.toLocaleString("zh-CN")} 人 · 录取 ${count.toLocaleString("zh-CN")} 人`;
  }

  // 文案异步加载、管理员保存时都会更新文字节点；只观察原始数字，避免反复渲染。
  const observer = new MutationObserver(renderRatio);
  for (const node of [signup, admitted]) {
    observer.observe(node, { childList: true, characterData: true, subtree: true });
  }
  renderRatio();
})();
