import hashlib
import base64

import paramiko
import pytest

from gh_ssh_action.ssh import (
    HostKeyMismatchError,
    SshInputs,
    _FingerprintHostKeyPolicy,
    build_connection_config,
    host_key_fingerprint,
)


def test_requires_host():
    with pytest.raises(ValueError, match="Input 'host' is required."):
        build_connection_config(
            SshInputs(host=" ", username="root", port=22, password="secret")
        )


def test_requires_username():
    with pytest.raises(ValueError, match="Input 'username' is required."):
        build_connection_config(
            SshInputs(host="example.com", username=" ", port=22, password="secret")
        )


def test_requires_auth_credentials():
    with pytest.raises(
        ValueError, match="Provide either 'password' or 'private_key' for SSH auth."
    ):
        build_connection_config(SshInputs(host="example.com", username="root", port=22))


def test_builds_config_with_password():
    result = build_connection_config(
        SshInputs(host="example.com", username="root", port=22, password="secret")
    )

    assert result.config.password == "secret"
    # No fingerprint was provided, so a security warning is expected.
    assert len(result.warnings) == 1
    assert "host_key_fingerprint" in result.warnings[0]


def test_builds_config_with_private_key_and_passphrase():
    result = build_connection_config(
        SshInputs(
            host="example.com",
            username="root",
            port=22,
            private_key="FAKE_KEY",
            passphrase="pass",
        )
    )

    assert result.config.private_key == "FAKE_KEY"
    assert result.config.passphrase == "pass"


def test_warns_when_both_password_and_private_key_are_provided():
    result = build_connection_config(
        SshInputs(
            host="example.com",
            username="root",
            port=22,
            password="secret",
            private_key="FAKE_KEY",
        )
    )

    assert result.config.private_key == "FAKE_KEY"
    # One warning for using the key over the password, one for the missing fingerprint.
    assert len(result.warnings) == 2


def test_no_warning_when_fingerprint_is_provided():
    result = build_connection_config(
        SshInputs(
            host="example.com",
            username="root",
            port=22,
            password="secret",
            host_key_fingerprint="SHA256:abc123",
        )
    )

    assert result.warnings == []
    assert result.config.host_key_fingerprint == "SHA256:abc123"


def test_rejects_non_positive_command_timeout():
    with pytest.raises(ValueError, match="Input 'command_timeout' must be a positive integer"):
        build_connection_config(
            SshInputs(
                host="example.com",
                username="root",
                port=22,
                password="secret",
                command_timeout=0,
            )
        )


def test_host_key_fingerprint_matches_openssh_format():
    key = paramiko.RSAKey.generate(2048)
    expected = "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode(
        "ascii"
    ).rstrip("=")

    assert host_key_fingerprint(key) == expected


def test_fingerprint_policy_accepts_matching_key():
    key = paramiko.RSAKey.generate(2048)
    policy = _FingerprintHostKeyPolicy(host_key_fingerprint(key))

    # Should not raise.
    policy.missing_host_key(client=None, hostname="example.com", key=key)


def test_fingerprint_policy_rejects_mismatched_key():
    key = paramiko.RSAKey.generate(2048)
    other_key = paramiko.RSAKey.generate(2048)
    policy = _FingerprintHostKeyPolicy(host_key_fingerprint(other_key))

    with pytest.raises(HostKeyMismatchError, match="Host key fingerprint mismatch"):
        policy.missing_host_key(client=None, hostname="example.com", key=key)

