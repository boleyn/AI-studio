import { describe, expect, mock, test } from "bun:test";

mock.module("env-paths", () => ({
  default: (_appName: string) => ({
    data: "/tmp/aistudio-data",
    config: "/tmp/aistudio-config",
    cache: "/tmp/aistudio-cache",
    log: "/tmp/aistudio-log",
    temp: "/tmp/aistudio-temp",
  }),
}));

const { maskVirtualPathForDisplay } = await import("src/utils/file.js");
const { runWithVirtualProjectRoot } = await import("src/utils/fsOperations.js");
const { maskAbsolutePathsInText } = await import("src/utils/virtualPathMasking.js");

describe("maskVirtualPathForDisplay", () => {
  test("returns relative root marker for root path", () => {
    const result = runWithVirtualProjectRoot("/virtual/project", () =>
      maskVirtualPathForDisplay("/virtual/project"),
    );
    expect(result).toBe(".");
  });

  test("returns relative child path for in-root path", () => {
    const result = runWithVirtualProjectRoot("/virtual/project", () =>
      maskVirtualPathForDisplay("/virtual/project/src/index.ts"),
    );
    expect(result).toBe("src/index.ts");
  });

  test("masks outside-root absolute path", () => {
    const outsidePath = "/Users/real/secrets.txt";
    const result = runWithVirtualProjectRoot("/virtual/project", () =>
      maskVirtualPathForDisplay(outsidePath),
    );
    expect(result).toBe("<outside-project-path>");
  });
});

describe("maskAbsolutePathsInText", () => {
  test("masks quoted absolute paths", () => {
    const result = runWithVirtualProjectRoot("/virtual/project", () =>
      maskAbsolutePathsInText(
        'Path "/virtual/project/src/a.ts" failed',
        maskVirtualPathForDisplay,
      ),
    );
    expect(result).toBe('Path "src/a.ts" failed');
  });

  test("masks bare absolute paths", () => {
    const result = runWithVirtualProjectRoot("/virtual/project", () =>
      maskAbsolutePathsInText(
        "cannot open /virtual/project/src/a.ts.",
        maskVirtualPathForDisplay,
      ),
    );
    expect(result).toBe("cannot open src/a.ts.");
  });
});
