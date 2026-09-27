// 后台面板共用的展示格式化。原先 /api/admin/usage 和 /api/admin/media-orphans
// 各自带一份 humanSize，单位上限（TB / GB）和小数位还不一样，同一块存储
// 在两个页面会显示成不同数字，收敛到一处。

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}
