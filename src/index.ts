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
    let combinedStderr = "";
    let lastExitCode = 0;

    for (const command of commands) {
      const result = await executeSshCommand(config, command, {
        onStdout: (chunk) => core.info(chunk),
        onStderr: (chunk) => core.warning(chunk),
      });

      if (result.stdout) {
        combinedStdout += result.stdout;
      }

      if (result.stderr) {
        combinedStderr += result.stderr;
      }

      lastExitCode = result.exitCode;
      if (result.exitCode !== 0) {
        core.setFailed(`Remote command failed with exit code ${result.exitCode}.`);
        break;
      }
    }

    core.setOutput("stdout", combinedStdout);
    core.setOutput("stderr", combinedStderr);
    core.setOutput("exit_code", lastExitCode.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    core.setFailed(message);
  }
}

run();
