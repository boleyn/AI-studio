import { getNanoid } from "@/global/common/string/tools";

const DEFAULT_CHAT_ID_SIZE = 24;
const DEFAULT_DATA_ID_SIZE = 24;

// Keep consistent with ai-chat: lower-case first char + 24 chars by default.
export const createChatId = () => getNanoid(DEFAULT_CHAT_ID_SIZE);

// Keep consistent with ai-chat chat item dataId generation.
export const createDataId = () => getNanoid(DEFAULT_DATA_ID_SIZE);

