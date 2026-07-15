"""Entry point for the GitHub SSH Action (Python implementation)."""

from __future__ import annotations

import sys

from . import core
from .commands import parse_commands
from .ssh import SshInputs, build_connection_config, execute_ssh_command


def run() -> int:
    try:
        host = core.get_input("host", required=True)
        username = core.get_input("username", required=True)
        port_input = core.get_input("port")
        password = core.get_input("password")
        private_key = core.get_input("private_key")
        passphrase = core.get_input("private_key_passphrase")
        host_key_fingerprint = core.get_input("host_key_fingerprint")
        command_timeout_input = core.get_input("command_timeout")
        command_input = core.get_input("command", required=True)

        commands = parse_commands(command_input)
        if not commands:
            raise ValueError("Input 'command' cannot be empty.")

        port = int(port_input) if port_input else 22
        command_timeout = int(command_timeout_input) if command_timeout_input else None

        build_result = build_connection_config(
            SshInputs(
                host=host,
                username=username,
                port=port,
                password=password or None,
                private_key=private_key or None,
                passphrase=passphrase or None,
                host_key_fingerprint=host_key_fingerprint or None,
                command_timeout=command_timeout,
            )
        )

        for warning_message in build_result.warnings:
            core.warning(warning_message)

        combined_stdout_parts: list[str] = []
        last_exit_code = 0
        failed = False

        def handle_chunk(chunk: str) -> None:
            core.info(chunk)
            combined_stdout_parts.append(chunk)

        for command in commands:
            result = execute_ssh_command(
                build_result.config,
                command,
                on_stdout=handle_chunk,
                # Display and append stderr alongside stdout so both streams appear together.
                on_stderr=handle_chunk,
            )

            last_exit_code = result.exit_code
            if result.exit_code != 0:
                core.set_failed(f"Remote command failed with exit code {result.exit_code}.")
                failed = True
                break

        combined_stdout = "".join(combined_stdout_parts)
        core.set_output("stdout", combined_stdout)
        core.set_output("stderr", "")
        core.set_output("exit_code", str(last_exit_code))

        return 1 if failed else 0
    except Exception as error:  # noqa: BLE001 - mirror top-level catch in index.ts
        core.set_failed(str(error))
        return 1


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()

