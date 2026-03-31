export const logWorkspaceEvent = (
  event: string,
  payload: Record<string, string | number | boolean | string[] | undefined>
) => {
  console.info("[project-workspace]", {
    event,
    ...payload,
  });
};
