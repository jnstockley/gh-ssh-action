# GitHub SSH Action

Run SSH commands against a remote host from GitHub Actions. Implemented in Python, packaged as a
Docker container action, and managed with [uv](https://docs.astral.sh/uv/).

## Usage

### Password authentication

```yaml
- name: Run SSH command
  uses: jnstockley/gh-ssh-action@v1
  with:
    host: ${{ secrets.SSH_HOST }}
    username: ${{ secrets.SSH_USER }}
    password: ${{ secrets.SSH_PASSWORD }}
    command: "uname -a"
```

### Key authentication (with passphrase)

```yaml
- name: Run SSH command
  uses: jnstockley/gh-ssh-action@v1
  with:
    host: ${{ secrets.SSH_HOST }}
    username: ${{ secrets.SSH_USER }}
    private_key: ${{ secrets.SSH_PRIVATE_KEY }}
    private_key_passphrase: ${{ secrets.SSH_PRIVATE_KEY_PASSPHRASE }}
    command: "uptime"
```

### Multiple commands

```yaml
- name: Run multiple SSH commands
  uses: jnstockley/gh-ssh-action@v1
  with:
    host: ${{ secrets.SSH_HOST }}
    username: ${{ secrets.SSH_USER }}
    private_key: ${{ secrets.SSH_PRIVATE_KEY }}
    command: |
      whoami
      pwd
      ls -la
```

## Inputs

- `host`: SSH host to connect to. Required.
- `username`: SSH username. Required.
- `port`: SSH port. Default: `22`.
- `password`: SSH password (for password auth).
- `private_key`: SSH private key (for key auth). Use a multiline secret.
- `private_key_passphrase`: Passphrase for the SSH private key.
- `host_key_fingerprint`: Expected SHA256 fingerprint of the remote host's SSH key (e.g. from
  `ssh-keyscan -t ed25519 <host> | ssh-keygen -lf -`, in `SHA256:...` form). When set, the
  connection is refused if the host key doesn't match — protecting against man-in-the-middle
  attacks. **Strongly recommended.** If omitted, the host key is trusted on first use without
  verification and a warning is logged.
- `command_timeout`: Maximum time in seconds to wait for each command to finish. Default: `300`.
- `command`: Command to execute on the remote host. Required.

### A note on security

- Prefer `private_key` (ideally an Ed25519 key) over `password` authentication.
- Always set `host_key_fingerprint` in production workflows. Without it, this action has no way
  to distinguish the real host from an attacker impersonating it on first connection.
- Treat the `command` input as untrusted-input-sensitive: if any part of it is derived from
  external input (e.g. a PR title or issue body), sanitize it first, since it is executed as a
  shell command on the remote host.
- Anything written to `stdout`/`stderr` is echoed to the workflow log. GitHub automatically masks
  registered secrets that appear in log output, but avoid commands that print unrelated sensitive
  data.

## Outputs

- `stdout`: Standard output from the remote command.
- `stderr`: Standard error from the remote command.
- `exit_code`: Exit code from the remote command.

## CI/CD

- [`ci.yml`](.github/workflows/ci.yml): lint (ruff), type-check (mypy), tests (pytest), and a
  Docker build smoke test on every PR and push to `main`.
- [`release.yml`](.github/workflows/release.yml): see [Release](#release) below.
- [`security.yml`](.github/workflows/security.yml): runs [Trivy](https://trivy.dev) against both
  the built container image and the Python dependency tree (`uv.lock`) on every PR, push to
  `main`, a weekly schedule, and on demand. Results are uploaded to the repository's **Security
  → Code scanning** tab. No external accounts or secrets are required — the image is built and
  scanned locally within the workflow.

## Development

Requirements: [uv](https://docs.astral.sh/uv/) (installs and manages Python for you).

```bash
uv sync --extra dev   # install runtime + dev dependencies into .venv
uv run pytest         # run the test suite
uv run ruff check .   # lint
uv run mypy src       # type-check
```

This action runs as a Docker container action (see `action.yml` / `Dockerfile`), so there is no
build/bundle step required before release — the Docker image is built by GitHub Actions runners
directly from source at the tagged commit, using `uv` inside the container to install locked
dependencies (`uv.lock`).

To test the container locally:

```bash
docker build -t gh-ssh-action .
docker run --rm \
  -e INPUT_HOST=example.com \
  -e INPUT_USERNAME=root \
  -e INPUT_PASSWORD=secret \
  -e INPUT_COMMAND=uptime \
  -e INPUT_PORT=22 \
  gh-ssh-action
```

## Release

Releases are published as GitHub Releases from an annotated tag (for example `v1.2.3`). Because
this is a Docker container action, GitHub builds the image directly from the `Dockerfile` at the
released commit — there is no compiled `dist/` artifact to rebuild or commit, so a release never
needs to rewrite the tag it was created from. This keeps releases compatible with the
**Enable release immutability** repository setting (*Disallow assets and tags from being modified
once a release is published*).

1. Push an annotated tag, e.g. `git tag -a v1.2.3 -m "v1.2.3" && git push origin v1.2.3`.
2. Publish a GitHub Release from that tag (mark **pre-release** for beta versions, or as
   **latest** for a stable release).
3. The [`release.yml`](.github/workflows/release.yml) workflow automatically runs the test suite,
   validates the Docker image builds, and — for non-prerelease publishes only — moves the floating
   major version tag (e.g. `v1`) to point at the new release commit, so consumers using
   `uses: jnstockley/gh-ssh-action@v1` automatically pick up the update. Pre-releases are left
   untouched so the major tag always points at the latest stable release.
4. The workflow also publishes the built image to the GitHub Container Registry, tagged with the
   exact release tag (e.g. `ghcr.io/jnstockley/gh-ssh-action:v1.2.3-beta.1`), for every release
   including pre-releases. This is purely an inspectable/pullable artifact — it is **not** required
   to use the action.

### Testing a pre-release in another workflow

No separate publish step is required to try out a pre-release: the moment you publish it, the
git tag exists and is immediately usable from any other repository, since GitHub builds the image
straight from the `Dockerfile` at that commit on demand:

```yaml
- name: Run SSH command (pre-release)
  uses: jnstockley/gh-ssh-action@v1.3.0-beta.1
  with:
    host: ${{ secrets.SSH_HOST }}
    username: ${{ secrets.SSH_USER }}
    password: ${{ secrets.SSH_PASSWORD }}
    command: "uname -a"
```

Note that pre-releases intentionally do **not** move the floating `v1` tag, so `uses: ...@v1` will
never accidentally pick up a pre-release — you must reference the exact pre-release tag to test it.

## License

ISC
