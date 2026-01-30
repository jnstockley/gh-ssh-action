import { describe, it, expect, vi } from "vitest";

// Mock the ssh2 Client to simulate stream events
vi.mock("ssh2", () => {
  return {
    Client: class MockClient {
      private handlers: Record<string, Function> = {};

      on(event: string, cb: Function) {
        this.handlers[event] = cb;
        return this;
      }

      connect(_config: any) {
        // simulate async ready event
        if (this.handlers["ready"]) {
          // ready should fire on next tick to allow listeners to be attached
          setImmediate(() => this.handlers["ready"]());
        }
      }

      // Production code calls client.end(); provide a no-op implementation.
      end() {
        // no-op in the mock
      }

      exec(_command: string, cb: (err: Error | null, stream?: any) => void) {
        // Create a fake stream with on and stderr.on
        const stream: any = {
          handlers: {} as Record<string, Function>,
          stderr: { handlers: {} as Record<string, Function>, on(event: string, h: Function) { this.handlers[event] = h; } },
          on(event: string, h: Function) {
            stream.handlers[event] = h;
          },
        };

        // Immediately call the exec callback with our stream
        cb(null, stream);

        // Emit a sequence of chunks similar to Docker pull/progress output
        const sequence: Array<{ which: "stdout" | "stderr"; chunk: string }> = [
          { which: "stdout", chunk: "Warning:  e9ad6fbf7c4b Extracting [==================================================>]  36.64MB/36.64MB\r" },
          { which: "stdout", chunk: "Warning:  e9ad6fbf7c4b Extracting [==================================================>]  36.64MB/36.64MB\n" },
          { which: "stdout", chunk: "\n" },
          { which: "stdout", chunk: "Warning:  e9ad6fbf7c4b Pull complete \n" },
          { which: "stdout", chunk: "Warning:  e9ad6fbf7c4b Pull complete \n" },
          { which: "stderr", chunk: "Error: something went wrong\r\n" },
          { which: "stdout", chunk: "Warning:  Image ghcr.io/goauthentik/server:2025.12.2 Pulled \n" },
        ];

        // Emit each item on the next ticks to ensure the test's listeners were attached
        sequence.forEach((item, idx) => {
          setImmediate(() => {
            if (item.which === "stdout") {
              const h = stream.handlers["data"];
              if (h) h(Buffer.from(item.chunk));
            } else {
              const h = stream.stderr.handlers["data"];
              if (h) h(Buffer.from(item.chunk));
            }

            // After the last item, emit close
            if (idx === sequence.length - 1) {
              const closeHandler = stream.handlers["close"];
              if (closeHandler) closeHandler(0);
            }
          });
        });
      }
    },
  };
});

import { executeSshCommand } from "../src/ssh";

describe("executeSshCommand (stream normalization and deduplication)", () => {
  it("should normalize carriage returns, skip blank lines, dedupe consecutive duplicates, and accumulate output", async () => {
    const stdoutCalls: string[] = [];
    const stderrCalls: string[] = [];

    const result = await executeSshCommand(
      // connect config (values don't matter for the mock)
      { host: "example.com", username: "root", port: 22 },
      "echo",
      {
        onStdout: (chunk) => stdoutCalls.push(chunk),
        onStderr: (chunk) => stderrCalls.push(chunk),
      }
    );

    // Handlers should receive normalized unique messages
    expect(stdoutCalls).toEqual([
      "Warning:  e9ad6fbf7c4b Extracting [==================================================>]  36.64MB/36.64MB",
      "Warning:  e9ad6fbf7c4b Pull complete",
      "Warning:  Image ghcr.io/goauthentik/server:2025.12.2 Pulled",
    ]);

    // Stderr should report the normalized error once
    expect(stderrCalls).toEqual(["Error: something went wrong"]);

    // Accumulated stdout/stderr should contain the normalized lines separated by newlines
    expect(result.stdout).toContain("Warning:  e9ad6fbf7c4b Extracting");
    expect(result.stdout).toContain("Warning:  e9ad6fbf7c4b Pull complete");
    expect(result.stdout).toContain("Warning:  Image ghcr.io/goauthentik/server:2025.12.2 Pulled");

    expect(result.stderr).toContain("Error: something went wrong");

    // Ensure duplicates were not duplicated in handler calls (dedup behavior)
    expect(stdoutCalls.length).toBe(3);
  });
});
