const getMergeKey = (block: Record<string, unknown>) => {
  const type = typeof block.type === "string" ? block.type : "";
  if (type === "tool_use" || type === "agent_start") {
    const id = typeof block.id === "string" ? block.id : "";
    return id ? `${type}:${id}` : "";
  }
  if (type === "tool_result") {
    const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
    return id ? `${type}:${id}` : "";
  }
  return "";
};

export const mergeSdkBlock = (
  existingBlocks: unknown[],
  nextBlock: Record<string, unknown>
): unknown[] => {
  const mergeKey = getMergeKey(nextBlock);
  if (!mergeKey) return [...existingBlocks, nextBlock];

  const existingIndex = existingBlocks.findIndex((item) => {
    if (!item || typeof item !== "object") return false;
    return getMergeKey(item as Record<string, unknown>) === mergeKey;
  });

  if (existingIndex < 0) return [...existingBlocks, nextBlock];

  const mergedBlocks = [...existingBlocks];
  const current = mergedBlocks[existingIndex];
  if (!current || typeof current !== "object") {
    mergedBlocks[existingIndex] = nextBlock;
    return mergedBlocks;
  }

  const currentRecord = current as Record<string, unknown>;
  const type = typeof nextBlock.type === "string" ? nextBlock.type : "";
  const parentAgentToolUseId =
    typeof nextBlock.parent_agent_tool_use_id === "string" &&
    nextBlock.parent_agent_tool_use_id.trim()
      ? nextBlock.parent_agent_tool_use_id
      : currentRecord.parent_agent_tool_use_id;

  if (type === "tool_use") {
    mergedBlocks[existingIndex] = {
      ...currentRecord,
      ...nextBlock,
      name:
        (typeof nextBlock.name === "string" && nextBlock.name) ||
        (typeof currentRecord.name === "string" ? currentRecord.name : "tool"),
      input: nextBlock.input !== undefined ? nextBlock.input : currentRecord.input,
      parent_agent_tool_use_id: parentAgentToolUseId,
    };
    return mergedBlocks;
  }

  if (type === "tool_result") {
    mergedBlocks[existingIndex] = {
      ...currentRecord,
      ...nextBlock,
      content: nextBlock.content !== undefined ? nextBlock.content : currentRecord.content,
      input: nextBlock.input !== undefined ? nextBlock.input : currentRecord.input,
      name:
        (typeof nextBlock.name === "string" && nextBlock.name) ||
        (typeof currentRecord.name === "string" ? currentRecord.name : undefined),
      parent_agent_tool_use_id: parentAgentToolUseId,
      is_error: nextBlock.is_error === true || currentRecord.is_error === true,
    };
    return mergedBlocks;
  }

  mergedBlocks[existingIndex] = {
    ...currentRecord,
    ...nextBlock,
    agent_type:
      (typeof nextBlock.agent_type === "string" && nextBlock.agent_type) ||
      currentRecord.agent_type,
    description:
      (typeof nextBlock.description === "string" && nextBlock.description) ||
      currentRecord.description,
    prompt:
      (typeof nextBlock.prompt === "string" && nextBlock.prompt) ||
      currentRecord.prompt,
  };
  return mergedBlocks;
};
