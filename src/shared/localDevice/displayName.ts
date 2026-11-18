export function deviceDisplayName(device: { name?: string; remark?: string; platform?: string }) {
  if (device.remark?.trim()) return device.remark.trim();
  const host = device.name?.replace(/\.local$/i, "").trim() || "";
  const model = host.match(/MacBook[- ]?(Pro|Air)|Mac[- ]?(mini|Studio)|iMac/i);
  if (model) return model[0].replace(/(MacBook|Mac)[- ]?(Pro|Air|mini|Studio)/i, "$1 $2");
  if (host && host.length <= 20) return host;
  const names: Record<string, string> = { darwin: "Mac 电脑", windows: "Windows 电脑", linux: "Linux 电脑" };
  return names[device.platform ?? ""] ?? "本地电脑";
}
