export function formatRelativeTime(isoString?: string): string {
  if (!isoString) return "";
  const time = new Date(isoString).getTime();
  if (Number.isNaN(time)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek} 周前`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${Math.max(1, diffMonth)} 个月前`;
}
