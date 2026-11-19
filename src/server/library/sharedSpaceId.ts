import { createHash } from "node:crypto";

export function sharedSpaceLibraryId(shareId: string) {
  return createHash("sha256").update(JSON.stringify(["shared-space",shareId])).digest("hex");
}
