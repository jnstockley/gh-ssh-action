# Contributing

Thanks for your interest in contributing!

## Development

```bash
uv sync --extra dev
uv run pytest
uv run ruff check .
uv run mypy src
```

## Pull Requests

- Keep changes focused and small.
- Include or update tests when behavior changes.
- Run `uv run pytest`, `uv run ruff check .`, and `uv run mypy src` before opening a PR.
- Update `action.yml` when you add or change inputs/outputs.
