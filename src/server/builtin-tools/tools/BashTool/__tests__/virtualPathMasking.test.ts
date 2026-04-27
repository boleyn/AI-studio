import { describe, expect, test } from "bun:test";

const { maskAbsolutePathsInText } = await import("src/utils/virtualPathMasking.js");

const mapVirtualPath = (input: string) =>
  input.startsWith("/virtual/project/")
    ? `${input.slice("/virtual/project".length + 1)}`
    : input === "/virtual/project"
    ? "."
    : input;

describe("virtual bash path masking semantics", () => {
  test("masks quoted path in error text", () => {
    const input = 'Path "/virtual/project/secret.txt" is blocked';
    const output = maskAbsolutePathsInText(input, mapVirtualPath);
    expect(output).toBe('Path "secret.txt" is blocked');
  });

  test("masks bare absolute path in error text", () => {
    const input = "cannot stat /virtual/project/src/app.ts";
    const output = maskAbsolutePathsInText(input, mapVirtualPath);
    expect(output).toBe("cannot stat src/app.ts");
  });
});
