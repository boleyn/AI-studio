export type CloudHostStatus = "allocating" | "ready" | "sleeping" | "stopped";

export interface CloudHostStatusMeta {
  label: string;
  dotColor: string;
  badgeScheme: "green" | "yellow" | "gray";
}

const STATUS_META_MAP: Record<CloudHostStatus, CloudHostStatusMeta> = {
  allocating: { label: "分配中", dotColor: "#f59e0b", badgeScheme: "yellow" },
  ready: { label: "已就绪", dotColor: "#22c55e", badgeScheme: "green" },
  sleeping: { label: "已休眠", dotColor: "#a1a1aa", badgeScheme: "gray" },
  stopped: { label: "已停止", dotColor: "#a1a1aa", badgeScheme: "gray" },
};

export const getCloudHostStatusMeta = (
  status?: CloudHostStatus,
): CloudHostStatusMeta => STATUS_META_MAP[status || "ready"];
