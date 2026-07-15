"""Minimal re-implementation of the subset of @actions/core used by this action."""

import os
import re
import uuid


def get_input(name: str, required: bool = False) -> str:
    """Read a GitHub Actions input from the environment (INPUT_<NAME>)."""
    env_name = "INPUT_" + re.sub(r" ", "_", name.strip().upper())
    value = os.environ.get(env_name, "").strip()
    if required and not value:
        raise ValueError(f"Input required and not supplied: {name}")
    return value


def info(message: str) -> None:
    """Print an informational message to the workflow log."""
    print(message)


def warning(message: str) -> None:
    """Print a warning annotation to the workflow log."""
    print(f"::warning::{message}")


def set_failed(message: str) -> None:
    """Print an error annotation. The caller is responsible for the process exit code."""
    print(f"::error::{message}")


def set_output(name: str, value: str) -> None:
    """Write a step output, using the GITHUB_OUTPUT file when available."""
    github_output = os.environ.get("GITHUB_OUTPUT")
    if not github_output:
        # Fallback for local runs / older runners.
        print(f"::set-output name={name}::{value}")
        return

    delimiter = uuid.uuid4().hex
    with open(github_output, "a", encoding="utf-8") as handle:
        handle.write(f"{name}<<{delimiter}\n{value}\n{delimiter}\n")

