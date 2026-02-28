import type { StoreSecretValueType } from '../../../../common/secret/type';
import type { JSONSchemaInputType } from '../../jsonschema';

export type McpToolConfigType = {
  name: string;
  description: string;
  inputSchema: JSONSchemaInputType;
  /**
   * Whether this tool is selected/enabled in a toolset.
   * - `true/undefined`: enabled (backward compatible with old data)
   * - `false`: disabled
   */
  selected?: boolean;
};

export type McpToolSetDataType = {
  url: string;
  headerSecret?: StoreSecretValueType;
  toolList: McpToolConfigType[];
};

export type McpToolDataType = McpToolConfigType & {
  url: string;
  headerSecret?: StoreSecretValueType;
};
