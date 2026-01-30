import { describe, expect, it } from "vitest";
import { parseCommands } from "../src/commands";

describe("parseCommands", () => {
  it("accepts a single command", () => {
    expect(parseCommands("uptime")).toEqual(["uptime"]);
  });

  it("accepts multiple commands across lines", () => {
    const input = "whoami\nls -la\n";
    expect(parseCommands(input)).toEqual(["whoami", "ls -la"]);
  });

  it("filters empty lines", () => {
    const input = "\n\n  \n";
    expect(parseCommands(input)).toEqual([]);
  });
});
