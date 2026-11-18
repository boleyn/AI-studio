import { expect, test } from "bun:test";
import { nextOccurrence, specSchema } from "./store";
const base = {
  title: "daily",
  prompt: "summary",
  firstAt: "2026-03-07T09:00:00-05:00",
  timezone: "America/New_York",
  repeat: "daily" as const,
};
test("daily and weekly jobs preserve local wall time across DST and coalesce missed runs", () => {
  expect(nextOccurrence(base, Date.parse("2026-03-07T14:00:00Z"))).toBe(
    Date.parse("2026-03-08T13:00:00Z"),
  );
  expect(
    nextOccurrence(
      { ...base, repeat: "weekly" },
      Date.parse("2026-03-14T14:00:00Z"),
    ),
  ).toBe(Date.parse("2026-03-21T13:00:00Z"));
  expect(
    nextOccurrence(
      { ...base, repeat: "once" },
      Date.parse("2026-03-09T14:00:00Z"),
    ),
  ).toBeNull();
});
test("rejects fabricated identity, ambiguous timestamps, and unsupported zones", () => {
  for (const extra of [
    { owner: "another" },
    { firstAt: "2026-11-19T16:00" },
    { timezone: "bad-zone" },
  ])
    expect(specSchema.safeParse({ ...base, ...extra }).success).toBe(false);
});
