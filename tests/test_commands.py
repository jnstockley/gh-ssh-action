from gh_ssh_action.commands import parse_commands


def test_accepts_a_single_command():
    assert parse_commands("uptime") == ["uptime"]


def test_accepts_multiple_commands_across_lines():
    command_input = "whoami\nls -la\n"
    assert parse_commands(command_input) == ["whoami", "ls -la"]


def test_filters_empty_lines():
    command_input = "\n\n  \n"
    assert parse_commands(command_input) == []

