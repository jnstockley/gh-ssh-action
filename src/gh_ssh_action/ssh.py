"""SSH connection configuration and command execution built on paramiko."""

from __future__ import annotations

import base64
import hashlib
import select
import socket
import time
from dataclasses import dataclass, field
from io import StringIO
from typing import Callable, Optional

import paramiko

# Order matters: try the most common/modern key types first. `DSSKey` (ssh-dss) is deliberately
# not supported: it has been considered cryptographically weak and disabled by default in
# OpenSSH since 7.0 (2015).
_KEY_CLASSES: tuple[type[paramiko.PKey], ...] = (
    paramiko.RSAKey,
    paramiko.Ed25519Key,
    paramiko.ECDSAKey,
)

# TCP connect / SSH banner / auth negotiation timeout, in seconds.
DEFAULT_CONNECT_TIMEOUT_SECONDS = 20

# Default ceiling on how long a single remote command may run before we give up, in seconds.
# This prevents a hung remote command/connection from stalling a workflow job indefinitely.
DEFAULT_COMMAND_TIMEOUT_SECONDS = 300

# Size of each read from the SSH channel's stdout/stderr streams.
_READ_CHUNK_SIZE = 4096


@dataclass
class SshInputs:
    host: str
    username: str
    port: int
    password: Optional[str] = None
    private_key: Optional[str] = None
    passphrase: Optional[str] = None
    host_key_fingerprint: Optional[str] = None
    command_timeout: Optional[int] = None


@dataclass
class SshConnectionConfig:
    """Fully validated connection parameters, ready to hand to paramiko."""

    host: str
    username: str
    port: int
    connect_timeout: int = DEFAULT_CONNECT_TIMEOUT_SECONDS
    command_timeout: int = DEFAULT_COMMAND_TIMEOUT_SECONDS
    password: Optional[str] = None
    private_key: Optional[str] = None
    passphrase: Optional[str] = None
    host_key_fingerprint: Optional[str] = None


@dataclass
class SshBuildResult:
    config: SshConnectionConfig
    warnings: list[str] = field(default_factory=list)


@dataclass
class SshCommandResult:
    stdout: str
    stderr: str
    exit_code: int


class HostKeyMismatchError(RuntimeError):
    """Raised when a remote host's SSH key does not match the expected fingerprint."""


class _FingerprintHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    """Pin the remote host key to a known SHA256 fingerprint (RFC 4251 §4.1 host authentication).

    This intentionally fails closed: unlike `AutoAddPolicy`, an unrecognized or mismatched host
    key aborts the connection instead of being silently trusted, protecting against
    man-in-the-middle attacks.
    """

    def __init__(self, expected_fingerprint: str) -> None:
        self._expected_fingerprint = expected_fingerprint.strip()

    def missing_host_key(
        self, client: paramiko.SSHClient, hostname: str, key: paramiko.PKey
    ) -> None:
        actual = host_key_fingerprint(key)
        if actual != self._expected_fingerprint:
            raise HostKeyMismatchError(
                f"Host key fingerprint mismatch for '{hostname}': "
                f"expected {self._expected_fingerprint!r}, got {actual!r}. "
                "Refusing to connect (possible MITM attack)."
            )


def host_key_fingerprint(key: paramiko.PKey) -> str:
    """Compute the OpenSSH-style `SHA256:<base64>` fingerprint of a host key."""
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode("ascii").rstrip("=")


def normalize_private_key(key: str) -> str:
    """Normalize escaped newlines from secrets like "-----BEGIN...\\n..."."""
    return key.replace("\\n", "\n")


def _parse_private_key(key_data: str, passphrase: Optional[str]) -> paramiko.PKey:
    last_error: Optional[Exception] = None
    for key_class in _KEY_CLASSES:
        try:
            return key_class.from_private_key(StringIO(key_data), password=passphrase)
        except paramiko.PasswordRequiredException as error:
            raise ValueError(
                "The private key is encrypted; provide 'private_key_passphrase'."
            ) from error
        except paramiko.SSHException as error:
            last_error = error
            continue
    raise ValueError("Unable to parse SSH private key.") from last_error


def build_connection_config(inputs: SshInputs) -> SshBuildResult:
    warnings: list[str] = []
    host = inputs.host.strip()
    username = inputs.username.strip()

    if not host:
        raise ValueError("Input 'host' is required.")

    if not username:
        raise ValueError("Input 'username' is required.")

    port = inputs.port
    if not isinstance(port, int) or isinstance(port, bool) or port < 1 or port > 65535:
        raise ValueError("Input 'port' must be an integer between 1 and 65535.")

    password = inputs.password.strip() if inputs.password else None
    private_key_raw = inputs.private_key.strip() if inputs.private_key else None
    passphrase = inputs.passphrase.strip() if inputs.passphrase else None
    host_key_fingerprint_input = (
        inputs.host_key_fingerprint.strip() if inputs.host_key_fingerprint else None
    )
    has_password = bool(password)
    has_key = bool(private_key_raw)

    if not has_password and not has_key:
        raise ValueError("Provide either 'password' or 'private_key' for SSH auth.")

    if has_password and has_key:
        warnings.append("Both 'password' and 'private_key' provided; using private key.")

    if not host_key_fingerprint_input:
        warnings.append(
            "No 'host_key_fingerprint' provided; the remote host's SSH key will be trusted "
            "on first use without verification (vulnerable to man-in-the-middle attacks). "
            "Set 'host_key_fingerprint' (e.g. the SHA256 fingerprint from "
            "`ssh-keyscan <host> | ssh-keygen -lf -`) to pin and verify it."
        )

    command_timeout = (
        inputs.command_timeout
        if inputs.command_timeout is not None
        else DEFAULT_COMMAND_TIMEOUT_SECONDS
    )
    if not isinstance(command_timeout, int) or isinstance(command_timeout, bool) or (
        command_timeout < 1
    ):
        raise ValueError("Input 'command_timeout' must be a positive integer (seconds).")

    config = SshConnectionConfig(
        host=host,
        username=username,
        port=port,
        connect_timeout=DEFAULT_CONNECT_TIMEOUT_SECONDS,
        command_timeout=command_timeout,
        host_key_fingerprint=host_key_fingerprint_input,
    )

    if has_key and private_key_raw:
        config.private_key = normalize_private_key(private_key_raw)
        if passphrase:
            config.passphrase = passphrase
    elif has_password and password:
        config.password = password

    return SshBuildResult(config=config, warnings=warnings)


def execute_ssh_command(
    config: SshConnectionConfig,
    command: str,
    on_stdout: Optional[Callable[[str], None]] = None,
    on_stderr: Optional[Callable[[str], None]] = None,
) -> SshCommandResult:
    client = paramiko.SSHClient()

    if config.host_key_fingerprint:
        # Fail closed: refuse to talk to a host whose key doesn't match what was pinned.
        client.set_missing_host_key_policy(_FingerprintHostKeyPolicy(config.host_key_fingerprint))
    else:
        # No fingerprint was supplied; the caller has already been warned in
        # `build_connection_config`. Trust-on-first-use for unattended CI usage.
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs: dict = {
        "hostname": config.host,
        "username": config.username,
        "port": config.port,
        "timeout": config.connect_timeout,
        "banner_timeout": config.connect_timeout,
        "auth_timeout": config.connect_timeout,
        "look_for_keys": False,
        "allow_agent": False,
    }

    if config.private_key:
        connect_kwargs["pkey"] = _parse_private_key(config.private_key, config.passphrase)
    elif config.password:
        connect_kwargs["password"] = config.password

    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []

    try:
        client.connect(**connect_kwargs)
        transport = client.get_transport()
        if transport is None:
            raise RuntimeError("Failed to establish SSH transport.")

        channel = transport.open_session(timeout=config.connect_timeout)
        channel.exec_command(command)

        deadline = time.monotonic() + config.command_timeout

        while True:
            if channel.exit_status_ready() and not channel.recv_ready() and not (
                channel.recv_stderr_ready()
            ):
                break

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    f"Command timed out after {config.command_timeout} seconds: {command!r}"
                )

            # Block (with a bounded timeout) until the channel has data or the deadline passes,
            # instead of busy-polling — cheaper and more responsive than a fixed sleep.
            readable, _, _ = select.select([channel], [], [], min(remaining, 1.0))
            if not readable:
                continue

            while channel.recv_ready():
                data = channel.recv(_READ_CHUNK_SIZE)
                if not data:
                    break
                chunk = data.decode("utf-8", errors="replace")
                stdout_chunks.append(chunk)
                if on_stdout:
                    on_stdout(chunk)

            while channel.recv_stderr_ready():
                data = channel.recv_stderr(_READ_CHUNK_SIZE)
                if not data:
                    break
                chunk = data.decode("utf-8", errors="replace")
                stderr_chunks.append(chunk)
                if on_stderr:
                    on_stderr(chunk)

        exit_code = channel.recv_exit_status()

        return SshCommandResult(
            stdout="".join(stdout_chunks),
            stderr="".join(stderr_chunks),
            exit_code=exit_code,
        )
    except (paramiko.SSHException, socket.error) as error:
        raise RuntimeError(str(error)) from error
    finally:
        client.close()
