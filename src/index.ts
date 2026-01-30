import * as core from "@actions/core";
import { buildGreeting } from "./greeting";

export function run(): void {
  try {
    const name = core.getInput("name");
    const message = buildGreeting(name);

    core.info(message);
    core.setOutput("message", message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    core.setFailed(message);
  }
}

run();
