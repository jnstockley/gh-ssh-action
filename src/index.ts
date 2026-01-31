import * as core from "@actions/core";
import { parseCommands } from "./commands";
import { buildConnectionConfig, executeSshCommand } from "./ssh";

export async function run(): Promise<void> {
  try {
    const host = core.getInput("host", { required: true });
    const username = core.getInput("username", { required: true });
    const portInput = core.getInput("port");
    const password = core.getInput("password");
    const privateKey = core.getInput("private_key");
    const passphrase = core.getInput("private_key_passphrase");
    const commandInput = core.getInput("command", { required: true });

    const commands = parseCommands(commandInput);
    if (commands.length === 0) {
      throw new Error("Input 'command' cannot be empty.");
    }

    const port = portInput ? Number.parseInt(portInput, 10) : 22;
    const { config, warnings } = buildConnectionConfig({
      host,
      username,
      port,
      password,
      privateKey,
      passphrase,
    });

    warnings.forEach((warning) => core.warning(warning));

    let combinedStdout = "";
    let lastExitCode = 0;

    for (const command of commands) {
      // Append chunks into combinedStdout from the handlers so ordering is preserved
      const result = await executeSshCommand(config, command, {
        onStdout: (chunk) => {
          core.info(chunk);
          combinedStdout += chunk;
        },
        // Display and append stderr as stdout (info) so both streams appear together
        onStderr: (chunk) => {
          core.info(chunk);
          combinedStdout += chunk;
        },
      });

      // No need to append result.stderr separately because handlers already merged chunks
      if (result.stdout && !result.stdout.length) {
        // noop to satisfy any lints about unused result; keep behavior unchanged
      }

      lastExitCode = result.exitCode;
      if (result.exitCode !== 0) {
        core.setFailed(`Remote command failed with exit code ${result.exitCode}.`);
        break;
      }
    }

    core.setOutput("stdout", combinedStdout);
    core.setOutput("stderr", "");
    core.setOutput("exit_code", lastExitCode.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    core.setFailed(message);
  }
}

run();
