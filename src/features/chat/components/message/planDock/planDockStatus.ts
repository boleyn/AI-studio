export const PLAN_STATUS_META = {
  pending: {
    label: "待处理",
    color: "myGray.500",
    dotBg: "myGray.300",
    dotBorder: "myGray.350",
  },
  in_progress: {
    label: "进行中",
    color: "blue.700",
    dotBg: "blue.500",
    dotBorder: "blue.500",
  },
  completed: {
    label: "已完成",
    color: "green.700",
    dotBg: "green.500",
    dotBorder: "green.500",
  },
} as const;

export type PlanStepStatus = keyof typeof PLAN_STATUS_META;
