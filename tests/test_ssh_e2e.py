"""End-to-end tests for `execute_ssh_command` against a real (in-process) SSH server.

Unlike the unit tests in `test_ssh.py`, these spin up a lightweight, in-process paramiko SSH
server bound to `127.0.0.1` on an OS-assigned ephemeral port. This exercises the full
client/server protocol path — password auth, channel exec, stdout/stderr streaming, exit-status
delivery, host-key fingerprint verification, and command timeouts — without requiring network
access, Docker, or a real remote host, so it runs safely and deterministically in CI.
"""

from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator

import paramiko
import pytest

from gh_ssh_action.ssh import (
    HostKeyMismatchError,
    SshConnectionConfig,
    execute_ssh_command,
    host_key_fingerprint,
)

pytestmark = pytest.mark.integration

_TEST_USERNAME = "testuser"
_TEST_PASSWORD = "testpass"
_STDOUT_LINE = b"hello stdout\n"
_STDERR_LINE = b"hello stderr\n"


class _EchoServer(paramiko.ServerInterface):
    """Minimal SSH server: authenticates one user/password and echoes exec'd commands."""

    def check_auth_password(self, username: str, password: str) -> int:
        if username == _TEST_USERNAME and password == _TEST_PASSWORD:
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def get_allowed_auths(self, username: str) -> str:
        return "password"

    def check_channel_request(self, kind: str, chanid: int) -> int:
        if kind == "session":
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_exec_request(self, channel: paramiko.Channel, command: bytes) -> bool:
        cmd = command.decode()

        def respond() -> None:
            # Give the client a brief moment to finish processing the exec-request reply
            # before we write to / close the channel.
            time.sleep(0.05)
            if cmd == "sleep-forever":
                time.sleep(9999)
                return
            channel.send(_STDOUT_LINE)
            channel.send_stderr(_STDERR_LINE)
            channel.send_exit_status(1 if "fail" in cmd else 0)
            channel.close()

        threading.Thread(target=respond, daemon=True).start()
        return True


class _TestSshServer:
    """Background thread accepting SSH connections on an ephemeral 127.0.0.1 port."""

    def __init__(self) -> None:
        self.host_key = paramiko.RSAKey.generate(2048)
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(5)
        self.port = self._sock.getsockname()[1]
        self._stop = False
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

    def _accept_loop(self) -> None:
        self._sock.settimeout(0.5)
        while not self._stop:
            try:
                client_sock, _ = self._sock.accept()
            except socket.timeout:
                continue
            except OSError:
                return

            # `accept()` returns a socket that inherits the listening socket's timeout; reset it
            # to blocking so paramiko's packet reader doesn't spuriously time out mid-handshake.
            client_sock.settimeout(None)
            self._handle_client(client_sock)

    def _handle_client(self, client_sock: socket.socket) -> None:
        # Handled synchronously (one connection at a time) in the same accept-loop thread —
        # simpler and avoids extra thread/lifecycle races, and the tests never open concurrent
        # connections.
        transport = paramiko.Transport(client_sock)
        try:
            transport.add_server_key(self.host_key)
            transport.start_server(server=_EchoServer())
            channel = transport.accept(20)
            if channel is None:
                return
            while transport.is_active() and not channel.closed:
                time.sleep(0.05)
        except Exception:
            # A rejected connection (e.g. a deliberately mismatched host key test) tears down
            # the transport before the handshake completes; nothing to act on here.
            pass
        finally:
            transport.close()

    @property
    def fingerprint(self) -> str:
        return host_key_fingerprint(self.host_key)

    def stop(self) -> None:
        self._stop = True
        self._sock.close()
        self._thread.join(timeout=2)


@pytest.fixture(scope="module")
def ssh_server() -> Iterator[_TestSshServer]:
    server = _TestSshServer()
    time.sleep(0.2)  # Let the accept loop start before the first connection attempt.
    try:
        yield server
    finally:
        server.stop()


def _config(server: _TestSshServer, **overrides: object) -> SshConnectionConfig:
    base: dict = {
        "host": "127.0.0.1",
        "username": _TEST_USERNAME,
        "port": server.port,
        "password": _TEST_PASSWORD,
        "host_key_fingerprint": server.fingerprint,
        "command_timeout": 10,
    }
    base.update(overrides)
    return SshConnectionConfig(**base)


def test_streams_stdout_and_stderr_and_returns_success_exit_code(
    ssh_server: _TestSshServer,
) -> None:
    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []

    result = execute_ssh_command(
        _config(ssh_server),
        "echo hi",
        on_stdout=stdout_chunks.append,
        on_stderr=stderr_chunks.append,
    )

    assert result.stdout == _STDOUT_LINE.decode()
    assert result.stderr == _STDERR_LINE.decode()
    assert result.exit_code == 0
    assert stdout_chunks == [_STDOUT_LINE.decode()]
    assert stderr_chunks == [_STDERR_LINE.decode()]


def test_surfaces_non_zero_exit_code(ssh_server: _TestSshServer) -> None:
    result = execute_ssh_command(_config(ssh_server), "please fail")
    assert result.exit_code == 1


def test_rejects_mismatched_host_key_fingerprint(ssh_server: _TestSshServer) -> None:
    config = _config(ssh_server, host_key_fingerprint="SHA256:" + "A" * 43)

    with pytest.raises(HostKeyMismatchError, match="fingerprint mismatch"):
        execute_ssh_command(config, "echo hi")


def test_enforces_command_timeout(ssh_server: _TestSshServer) -> None:
    config = _config(ssh_server, command_timeout=1)

    start = time.monotonic()
    with pytest.raises(RuntimeError, match="timed out"):
        execute_ssh_command(config, "sleep-forever")
    elapsed = time.monotonic() - start

    # Generous upper bound to avoid flakiness on slower/contended CI runners.
    assert elapsed < 10

