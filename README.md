# GitHub Action Starter

A production-ready starter template for building TypeScript-based GitHub Actions.

## Usage

```yaml
- name: Run the starter action
  uses: your-org/gh-action-starter@v1
  with:
    name: "Octo"
```

### Inputs

- `name`: Name to greet. Default: `World`.

### Outputs

- `message`: The greeting message.

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
