import { describe, expect, test } from "bun:test";

describe("scaffold", () => {
  test("test runner is wired up", () => {
    expect(typeof describe).toBe("function");
    expect(typeof test).toBe("function");
  });
});
