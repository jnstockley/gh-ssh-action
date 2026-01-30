import { describe, expect, it } from "vitest";
import { buildConnectionConfig } from "../src/ssh";

describe("buildConnectionConfig", () => {
  it("requires host", () => {
    expect(() =>
      buildConnectionConfig({
        host: " ",
        username: "root",
        port: 22,
        password: "secret",
      })
    ).toThrow("Input 'host' is required.");
  });

  it("requires username", () => {
    expect(() =>
      buildConnectionConfig({
        host: "example.com",
        username: " ",
        port: 22,
        password: "secret",
      })
    ).toThrow("Input 'username' is required.");
  });

  it("requires auth credentials", () => {
    expect(() =>
      buildConnectionConfig({
        host: "example.com",
        username: "root",
        port: 22,
      })
    ).toThrow("Provide either 'password' or 'private_key' for SSH auth.");
  });

  it("builds config with password", () => {
    const result = buildConnectionConfig({
      host: "example.com",
      username: "root",
      port: 22,
      password: "secret",
    });

    expect(result.config.password).toBe("secret");
    expect(result.warnings).toHaveLength(0);
  });

  it("builds config with private key and passphrase", () => {
    const result = buildConnectionConfig({
      host: "example.com",
      username: "root",
      port: 22,
      privateKey: "FAKE_KEY",
      passphrase: "pass",
    });

    expect(result.config.privateKey).toBe("FAKE_KEY");
    expect(result.config.passphrase).toBe("pass");
  });

  it("warns when both password and private key are provided", () => {
    const result = buildConnectionConfig({
      host: "example.com",
      username: "root",
      port: 22,
      password: "secret",
      privateKey: "FAKE_KEY",
    });

    expect(result.config.privateKey).toBe("FAKE_KEY");
    expect(result.warnings).toHaveLength(1);
  });
});
