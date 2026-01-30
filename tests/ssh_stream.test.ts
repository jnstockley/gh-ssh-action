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
          // Add a large concatenated chunk that mirrors GitHub Actions' combined progress lines
          { which: "stdout", chunk: (
            "Warning:  3d26720d94d3 Extracting [================>                                  ]  5.079MB/15.7MB  " +
            "3d26720d94d3 Extracting [================>                                  ]  5.079MB/15.7MB  " +
            "Warning:  3d26720d94d3 Extracting [=========================>                         ]  7.864MB/15.7MB  " +
            "Warning:  3d26720d94d3 Extracting [==================================================>]   15.7MB/15.7MB  " +
            "3d26720d94d3 Extracting [==================================================>]   15.7MB/15.7MB  " +
            "Warning:  3d26720d94d3 Pull complete   3d26720d94d3 Pull complete   " +
            "Warning:  4fe265f2e329 Extracting [=============================>                     ]  32.77kB/54.85kB  " +
            "4fe265f2e329 Extracting [=============================>                     ]  32.77kB/54.85kB  " +
            "Warning:  4fe265f2e329 Extracting [==================================================>]  54.85kB/54.85kB  " +
            "Warning:  4fe265f2e329 Pull complete   4fe265f2e329 Pull complete   " +
            "Warning:  e9ad6fbf7c4b Extracting [>                                                  ]  393.2kB/36.64MB  " +
            "e9ad6fbf7c4b Extracting [>                                                  ]  393.2kB/36.64MB  " +
            "Warning:  e9ad6fbf7c4b Extracting [==================>                                ]  13.76MB/36.64MB  " +
            "e9ad6fbf7c4b Extracting [==================>                                ]  13.76MB/36.64MB  " +
            "Warning:  e9ad6fbf7c4b Extracting [=======================================>           ]   29.1MB/36.64MB  " +
            "Warning:  e9ad6fbf7c4b Extracting [==================================================>]  36.64MB/36.64MB  " +
            "e9ad6fbf7c4b Extracting [==================================================>]  36.64MB/36.64MB  " +
            "Warning:  e9ad6fbf7c4b Pull complete   e9ad6fbf7c4b Pull complete   " +
            "Warning:  Image ghcr.io/goauthentik/server:2025.12.1 Pulled   Warning:  Image ghcr.io/goauthentik/server:2025.12.1 Pulled   " +
            "Warning:  Container authentik Recreate   Warning:  Container authentik_worker Recreate  "
          ) }
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

    // Handlers should receive non-empty, unique messages
    expect(stdoutCalls.length).toBeGreaterThan(0);
    const unique = new Set(stdoutCalls);
    expect(unique.size).toBe(stdoutCalls.length);

    // No blank entries or lone 'Warning:'
    expect(stdoutCalls).not.toContain("");
    expect(stdoutCalls).not.toContain("Warning:");

    // Must include key messages
    expect(stdoutCalls.some((s) => s.includes("Pull complete"))).toBe(true);
    expect(stdoutCalls.some((s) => s.includes("Image ghcr.io/goauthentik/server"))).toBe(true);
    expect(stdoutCalls.some((s) => s.includes("Container authentik Recreate"))).toBe(true);

    // Stderr should report the normalized error once
    expect(stderrCalls).toEqual(["Error: something went wrong"]);

    // Accumulated stdout/stderr should contain the normalized lines separated by newlines
    expect(result.stdout).toContain("Pull complete");
    expect(result.stdout).toContain("Image ghcr.io/goauthentik/server");

    expect(result.stderr).toContain("Error: something went wrong");
  });
});
