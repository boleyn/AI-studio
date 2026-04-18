import { describe, expect, test } from "bun:test";

const { maskAbsolutePathsInText } = await import("src/utils/virtualPathMasking.js");

const mapVirtualPath = (input: string) =>
  input.startsWith("/virtual/project/")
    ? `<virtual-project-root>${input.slice("/virtual/project".length)}`
    : input === "/virtual/project"
    ? "<virtual-project-root>"
    : input;

describe("virtual bash path masking semantics", () => {
  test("masks quoted path in error text", () => {
    const input = 'Path "/virtual/project/secret.txt" is blocked';
    const output = maskAbsolutePathsInText(input, mapVirtualPath);
    expect(output).toBe('Path "<virtual-project-root>/secret.txt" is blocked');
  });

  test("masks bare absolute path in error text", () => {
    const input = "cannot stat /virtual/project/src/app.ts";
    const output = maskAbsolutePathsInText(input, mapVirtualPath);
    expect(output).toBe("cannot stat <virtual-project-root>/src/app.ts");
  });
});
