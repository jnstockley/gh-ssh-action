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

    // Track all logged lines during this command to avoid duplicate/blank lines in logs
    const loggedLines = new Set<string>();

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

          // Helper: split incoming data into lines and normalize each for logging
          const processData = (
            data: Buffer | string,
            onLog: ((chunk: string) => void) | undefined,
            accumulate: (line: string) => void
          ) => {
            const s = typeof data === "string" ? data : data.toString();
            // Convert carriage returns to newlines so progress updates (which use \r) become separate items
            const normalizedNewlines = s.replace(/\r/g, "\n");
            // Split into lines; this will produce empty strings for trailing/newline-only chunks
            const parts = normalizedNewlines.split(/\n/);

            for (const part of parts) {
              // Split on runs of 2+ spaces to get tokens. Many concatenated outputs use double spaces
              // to separate repeated segments. We'll then merge continuation tokens into the previous
              // token unless the token clearly starts a new message (heuristic below).
              const rawTokens = part.split(/\s{2,}/).map(t => t.trim()).filter(Boolean);

              const isMessageStart = (tok: string) => /^(Warning:|[0-9a-f]{12}\b|Image\b|Container\b)/i.test(tok);

              const merged: string[] = [];
              for (let i = 0; i < rawTokens.length; i++) {
                const tok = rawTokens[i];

                // If the token is exactly 'Warning:' (possibly with trailing spaces), fold it into the next token
                if (/^Warning:$/i.test(tok) && i + 1 < rawTokens.length) {
                  const next = rawTokens[i + 1];
                  merged.push((tok + ' ' + next).trim());
                  i++; // skip the next token
                  continue;
                }

                if (merged.length === 0) {
                  merged.push(tok);
                  continue;
                }

                if (isMessageStart(tok)) {
                  // starts a new message
                  merged.push(tok);
                } else {
                  // continuation of previous message; append with a single space
                  merged[merged.length - 1] = (merged[merged.length - 1] + ' ' + tok).trim();
                }
              }

             for (const msg of merged) {
               const line = msg.replace(/\s+/g, ' ').trim();
               if (line === '') continue;
               if (!loggedLines.has(line)) {
                 loggedLines.add(line);
                 if (onLog) onLog(line);
               }
               accumulate(line + '\n');
             }
           }
         };

         stream.on('data', (data: Buffer) => {
           processData(
             data,
             handlers.onStdout,
             (addition) => { stdout += addition; }
           );
         });

          stream.stderr.on('data', (data: Buffer) => {
            processData(
              data,
              handlers.onStderr,
              (addition) => { stderr += addition; }
            );
          });

          stream.on('close', (code: number | null) => {
            if (settled) return;
            settled = true;
            client.end();
            resolve({ stdout, stderr, exitCode: typeof code === 'number' ? code : 0 });
          });
        });
      })
      .on('error', (error) => fail(error))
      .connect(config);
  });
}
