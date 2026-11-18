export type ProjectWorkspace =
  | { kind: "remote-vm"; directoryName: string }
  | { kind: "connector"; deviceId: string; grantId: string; workdir: string };

export type DeviceAccess =
  | { kind: "remote-vm" }
  | { kind: "connector"; deviceId: string; grantId: string };
