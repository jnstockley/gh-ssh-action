import { describe, expect, it } from "vitest";
import { buildGreeting } from "../src/greeting";

describe("buildGreeting", () => {
  it("uses the provided name", () => {
    expect(buildGreeting("Octo")).toBe("Hello, Octo!");
  });

  it("falls back to World when blank", () => {
    expect(buildGreeting(" ")).toBe("Hello, World!");
  });
});
