# GitHub SSH Action

Run SSH commands against a remote host from GitHub Actions.

## Usage

### Password authentication

```yaml
- name: Run SSH command
  uses: your-org/gh-ssh-action@v1
  with:
    host: ${{ secrets.SSH_HOST }}
    username: ${{ secrets.SSH_USER }}
    password: ${{ secrets.SSH_PASSWORD }}
    command: "uname -a"
```

### Key authentication (with passphrase)

```yaml
- name: Run SSH command
  uses: your-org/gh-ssh-action@v1
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
  uses: your-org/gh-ssh-action@v1
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
- `command`: Command to execute on the remote host. Required.

## Outputs

- `stdout`: Standard output from the remote command.
- `stderr`: Standard error from the remote command.
- `exit_code`: Exit code from the remote command.

## Development

Requirements: Node.js 20+

```bash
npm install
npm test
npm run bundle
```

- `npm run bundle` builds `dist/index.js`, which must be committed for GitHub Actions to run this action.
- Update `action.yml` when you add inputs or outputs.

## Release

1. Run `npm test` and `npm run bundle`.
2. Commit the changes, including `dist/`.
3. Create and push a tag, for example `v1.0.0`.
4. (Optional) Move a major tag like `v1` to the new release.

## License

ISC
