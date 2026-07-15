# GitHub SSH Action

Run SSH commands against a remote host from GitHub Actions. Implemented in Python and managed
with [uv](https://docs.astral.sh/uv/), delivered as a **composite action** that runs directly on
the runner (not inside a Docker container — see [Architecture](#architecture) for why that
matters).

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

## Architecture

This action runs as a **composite action** (`runs.using: composite` in `action.yml`): its steps
execute as ordinary processes directly on the GitHub Actions runner, sharing the runner's network
stack, routes, and DNS resolution.

This is a deliberate choice, not an oversight — an earlier version ran as a **Docker container
action**, which broke in real-world use in two ways, both caused by the container's isolation from
the host runner:

1. **DNS/VPN reachability**: consumers frequently target hosts that are only reachable and/or only
   resolvable via a VPN connected earlier in the same job (e.g. WireGuard). A Docker container
   action runs in an isolated network namespace that does not inherit the runner's VPN tunnel or
   custom DNS, causing `[Errno -5] No address associated with hostname` even for hosts that
   resolved fine outside the container.
2. **`$HOME` permissions**: GitHub's Docker runner overrides `HOME` with a host-mounted directory
   that isn't writable by an arbitrary container user, breaking anything that tries to write a
   cache there at startup.

A composite action sidesteps both problems entirely by never introducing container isolation in
the first place — the same behavior the original Node.js implementation of this action had. See
[`action.yml`](action.yml) for the full explanation inline.

The [`Dockerfile`](Dockerfile) is still present but is **not** used by `action.yml` — it's kept
only as an optional, standalone container image for anyone who wants to run this tool outside of
GitHub Actions (see [Development](#development) below).

## CI/CD

- [`ci.yml`](.github/workflows/ci.yml): lint (ruff), type-check (mypy), tests (pytest), an
  end-to-end smoke test that invokes this action via `uses: ./` against a real local `sshd`
  running on the runner, and a build/smoke test of the optional standalone Docker image.
- [`release.yml`](.github/workflows/release.yml): see [Release](#release) below.
- [`security.yml`](.github/workflows/security.yml): runs [Trivy](https://trivy.dev) against both
  the standalone container image and the Python dependency tree (`uv.lock`) on every PR, push to
  `main`, a weekly schedule, and on demand. Results are uploaded to the repository's **Security
  → Code scanning** tab. No external accounts or secrets are required.

## Development

Requirements: [uv](https://docs.astral.sh/uv/) (installs and manages Python for you).

```bash
uv sync --extra dev   # install runtime + dev dependencies into .venv
uv run pytest         # run the test suite
uv run ruff check .   # lint
uv run mypy src       # type-check
```

This action has no build/bundle step: it's a composite action that runs the checked-out Python
source directly via `uv run` at the exact tagged commit, so there's nothing to compile or commit
before a release.

An optional, standalone container image is also available for running this tool outside of GitHub
Actions (see [Architecture](#architecture) — it is **not** used by the action itself):

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
this is a composite action, GitHub runs the checked-out Python source directly at the released
commit via `uv` — there is no build artifact to produce or commit, so a release never needs to
rewrite the tag it was created from. This keeps releases compatible with the **Enable release
immutability** repository setting (*Disallow assets and tags from being modified once a release
is published*).

1. Push an annotated tag, e.g. `git tag -a v1.2.3 -m "v1.2.3" && git push origin v1.2.3`.
2. Publish a GitHub Release from that tag (mark **pre-release** for beta versions, or as
   **latest** for a stable release).
3. The [`release.yml`](.github/workflows/release.yml) workflow automatically runs the test suite
   and — for non-prerelease publishes only — moves the floating major version tag (e.g. `v1`) to
   point at the new release commit, so consumers using `uses: jnstockley/gh-ssh-action@v1`
   automatically pick up the update. Pre-releases are left untouched so the major tag always
   points at the latest stable release.
4. The workflow also publishes the optional standalone Docker image to the GitHub Container
   Registry, tagged with the exact release tag (e.g. `ghcr.io/jnstockley/gh-ssh-action:v1.2.3`),
   for every release including pre-releases. This is purely an inspectable/pullable artifact for
   running the tool outside GitHub Actions — it is **not** required to use the action.

### Testing a pre-release in another workflow

No separate publish step is required to try out a pre-release: the moment you publish it, the
git tag exists and is immediately usable from any other repository, since GitHub runs the
composite action's steps directly from that commit on demand:

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
