import assert from "node:assert/strict";
import { test } from "node:test";
import path from "path";
import {
  ensureInside,
  isLikelyBinaryBuffer,
  normalizeProjectPath,
  toSafeSegment,
} from "./pathUtils";

test("toSafeSegment sanitizes unsafe chars and keeps fallback", () => {
  assert.equal(toSafeSegment("abc-123"), "abc-123");
  assert.equal(toSafeSegment("a/b:c"), "a_b_c");
  assert.equal(toSafeSegment(""), "default");
});

test("normalizeProjectPath rejects traversal and null byte", () => {
  assert.equal(normalizeProjectPath("src/index.ts"), "/src/index.ts");
  assert.throws(() => normalizeProjectPath("../etc/passwd"));
  assert.throws(() => normalizeProjectPath("/foo/\0bar"));
});

test("ensureInside blocks path escape", () => {
  const base = path.resolve("/tmp/workspace-root");
  const inside = path.resolve(base, "foo/bar.txt");
  assert.doesNotThrow(() => ensureInside(base, inside, "path"));

  const outside = path.resolve(base, "../outside.txt");
  assert.throws(() => ensureInside(base, outside, "path"));
});

test("isLikelyBinaryBuffer detects null bytes", () => {
  assert.equal(isLikelyBinaryBuffer(Buffer.from("hello world")), false);
  assert.equal(isLikelyBinaryBuffer(Buffer.from([0x68, 0x00, 0x69])), true);
});
