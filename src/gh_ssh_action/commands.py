"""Parsing helpers for the `command` action input."""

import re


def parse_commands(command_input: str) -> list[str]:
    """Split a multiline command input into a list of trimmed, non-empty commands."""
    lines = re.split(r"\r?\n", command_input)
    return [line.strip() for line in lines if line.strip()]

