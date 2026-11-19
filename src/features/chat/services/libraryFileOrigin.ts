const origins = new WeakMap<File, string>();

export function fromLibrary(file: File, itemId: string): File {
  origins.set(file, itemId);
  return file;
}

export function libraryOrigin(file: File) {
  return origins.get(file);
}
