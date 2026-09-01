# Contributing

Thank you for helping improve Memo Flow.

## Before opening an issue

- Search existing issues first.
- Include the Obsidian version, operating system, Memo Flow version, and reproduction steps.
- Remove personal note content, Vault paths, API keys, and other sensitive information from logs or screenshots.

## Development setup

```bash
npm install
npm run check
```

The plugin must remain mobile compatible. Use Obsidian Vault APIs instead of Node.js or Electron APIs. New behavior that accesses the network or files outside the Vault must not be added without an explicit design discussion and documentation update.

## Pull requests

1. Keep changes focused.
2. Add or update tests when behavior changes.
3. Run `npm run check`.
4. Update `CHANGELOG.md` for user-visible changes.
5. Do not include private Vault data, generated `main.js`, `node_modules`, or release archives in commits.

By contributing, you agree that your contribution is licensed under the MIT License.

