import { Client, type ConnectConfig } from "ssh2";

export type SshInputs = {
  host: string;
  username: string;
  port: number;
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

export type SshBuildResult = {
  config: ConnectConfig;
  warnings: string[];
};

export type SshCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type SshStreamHandlers = {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

function normalizePrivateKey(key: string): string {
  // Normalize escaped newlines from secrets like "-----BEGIN...\n...".
  return key.replace(/\\n/g, "\n");
}

export function buildConnectionConfig(inputs: SshInputs): SshBuildResult {
  const warnings: string[] = [];
  const host = inputs.host.trim();
  const username = inputs.username.trim();

  if (!host) {
    throw new Error("Input 'host' is required.");
  }

  if (!username) {
    throw new Error("Input 'username' is required.");
  }

  const port = inputs.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Input 'port' must be an integer between 1 and 65535.");
  }

  const password = inputs.password?.trim();
  const privateKeyRaw = inputs.privateKey?.trim();
  const passphrase = inputs.passphrase?.trim();
  const hasPassword = Boolean(password);
  const hasKey = Boolean(privateKeyRaw);

  if (!hasPassword && !hasKey) {
    throw new Error("Provide either 'password' or 'private_key' for SSH auth.");
  }

  if (hasPassword && hasKey) {
    warnings.push("Both 'password' and 'private_key' provided; using private key.");
  }

  const config: ConnectConfig = {
    host,
    username,
    port,
    readyTimeout: 20000,
  };

  if (hasKey && privateKeyRaw) {
    config.privateKey = normalizePrivateKey(privateKeyRaw);
    if (passphrase) {
      config.passphrase = passphrase;
    }
  } else if (hasPassword && password) {
    config.password = password;
  }

  return { config, warnings };
}

export async function executeSshCommand(
  config: ConnectConfig,
  command: string,
  handlers: SshStreamHandlers = {}
): Promise<SshCommandResult> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let stdout = "";
    let stderr = "";
    let settled = false;

    // Track last logged chunk per stream to avoid duplicate/blank lines in logs
    let lastLoggedStdout = "";
    let lastLoggedStderr = "";

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      client.end();
      reject(error);
    };

    client
      .on("ready", () => {
        client.exec(command, (error, stream) => {
          if (error) {
            fail(error);
            return;
          }

          // Helper: normalize chunk for logging (strip carriage returns and trailing newlines)
          const normalizeChunkForLog = (data: Buffer | string) => {
            const s = typeof data === "string" ? data : data.toString();
            // Remove carriage returns used by progress bars and trim trailing newlines
            // Also trim trailing whitespace (e.g., spaces before newline) so logs are consistent
            return s.replace(/\r/g, "").replace(/\n+$/, "").trimEnd();
          };

          stream.on("data", (data: Buffer) => {
            const chunk = data.toString();
            const normalized = normalizeChunkForLog(chunk);

            // Skip empty lines produced by newline-only chunks
            if (normalized === "") {
              // Still accumulate raw data to preserve output if needed
              stdout += chunk;
              return;
            }

            // Avoid logging immediate duplicates which commonly occur with progress output
            if (normalized !== lastLoggedStdout) {
              lastLoggedStdout = normalized;
              handlers.onStdout?.(normalized);
            }

            stdout += normalized + "\n"; // keep newline-separated accumulated output
          });

          stream.stderr.on("data", (data: Buffer) => {
            const chunk = data.toString();
            const normalized = normalizeChunkForLog(chunk);

            if (normalized === "") {
              stderr += chunk;
              return;
            }

            if (normalized !== lastLoggedStderr) {
              lastLoggedStderr = normalized;
              handlers.onStderr?.(normalized);
            }

            stderr += normalized + "\n";
          });

          stream.on("close", (code: number | null) => {
            if (settled) {
              return;
            }
            settled = true;
            client.end();
            resolve({
              stdout,
              stderr,
              exitCode: typeof code === "number" ? code : 0,
            });
          });
        });
      })
      .on("error", (error) => fail(error))
      .connect(config);
  });
}
