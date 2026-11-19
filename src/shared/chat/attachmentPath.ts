export const chatUploadSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";

// Older chat uploads use a flat mirror. New uploads keep their unique directory
// when projected into the workspace so repeated names resolve to the right bytes.
export function chatAttachmentMirrorPath(storagePath: string, safeName: string) {
  const match = /^\/?chat_uploads\/[^/]+\/[^/]+\/\.files\/(?:files|images)\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/[^/]+$/i.exec(storagePath);
  return match ? `/.files/${match[1]}/${safeName}` : `/.files/${safeName}`;
}
