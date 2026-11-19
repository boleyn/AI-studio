export const workbookTemplates = [
  {name: "Analytics Dashboard", columns: ["Metric", "Period", "Actual", "Target", "Variance"], formula: "C2-D2"},
  {name: "Financial Budget", columns: ["Category", "Month", "Budget", "Actual", "Remaining"], formula: "C2-D2"},
  {name: "Operating Calendar", columns: ["Date", "Activity", "Owner", "Status"]},
  {name: "Project Tracker", columns: ["Task", "Owner", "Due date", "Status"]},
  {name: "Sales Pipeline", columns: ["Opportunity", "Stage", "Value", "Probability", "Weighted value"], formula: "C2*D2"},
  {name: "Three-Statement Forecast", columns: ["Period", "Revenue", "Expenses", "Net income"], formula: "B2-C2"},
];
