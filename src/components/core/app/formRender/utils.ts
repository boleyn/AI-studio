export const nodeInputTypeToInputType = (types: string[]) => {
  const type = types?.[0];
  if (type === "textarea" || type === "longText") return "textarea";
  return "text";
};
