export type Codechart = {
  type?: string;
  config?: any;
  title?: string;
  metrics?: string[];
  rows?: Array<[string, ...Array<number | string>]>;
  chartType?: string;
  palette?: string[];
  dimensionName?: string;
};
