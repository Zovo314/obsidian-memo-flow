# Memo Flow

[![CI](https://github.com/Zovo314/obsidian-memo-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/Zovo314/obsidian-memo-flow/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/Zovo314/obsidian-memo-flow)](https://github.com/Zovo314/obsidian-memo-flow/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Memo Flow** is a local-first, Markdown-native memo waterfall for Obsidian. Capture a thought without choosing a folder, then browse, search, tag, pin, archive, and revisit it from one chronological feed.

[简体中文](README.zh-CN.md)

![Memo Flow dark mode](images/memo-flow-dark.png)

## Why Memo Flow?

- **Plain Markdown** — every memo is an ordinary `.md` file in your Vault.
- **Local first** — no server, account, telemetry, ads, or network requests.
- **Desktop and mobile** — built with Obsidian Vault APIs and tested on macOS and iPhone.
- **iCloud friendly** — one file per memo reduces cross-device write conflicts.
- **AI readable** — local tools such as Codex and Claude Code can work with the files after you grant Vault access.
- **No lock-in** — disabling or removing the plugin never makes your notes unreadable.

## Features

- Quick capture from the waterfall or Command palette.
- `Cmd/Ctrl + Enter` to save.
- Markdown rendering, `#tags`, and image paste or drag-and-drop.
- Chronological feed grouped by date with progressive loading.
- Full-text search and tag filtering.
- Edit, pin, archive, open, link, and move memos to the Obsidian trash.
- Optimistic conflict protection when a file changes on another device.
- Content-addressed image attachments to avoid duplicates.
- Optional dependency-free flomo HTML export importer.

> **Interface language:** version 0.1.0 currently uses a Simplified Chinese interface. English localization is planned for a future release.

## Installation

### Community plugins

Memo Flow is not yet listed in the Obsidian Community directory. This section will be updated after approval.

### BRAT

After the first GitHub release is available:

1. Install and enable [BRAT](https://obsidian.md/plugins?id=obsidian42-brat).
2. In BRAT settings, select **Add Beta plugin**.
3. Enter `Zovo314/obsidian-memo-flow`.
4. Enable **Memo Flow** in **Settings → Community plugins**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Zovo314/obsidian-memo-flow/releases/latest).
2. Create `<YourVault>/.obsidian/plugins/memo-flow/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable **Memo Flow** in **Settings → Community plugins**.

## Usage

Open Memo Flow from the ribbon icon or run **Memo Flow: 打开瀑布流** from the Command palette. Type a memo in the composer and press `Cmd/Ctrl + Enter`.

By default, data is stored under:

```text
Memos/
├── Entries/YYYY/MM/memo-*.md
├── Assets/
├── Imports/
└── AI-GUIDE.md
```

You can change the root folder in the plugin settings. See [the memo schema](docs/memo-schema.md) for the on-disk contract.

## Import a flomo offline export

The optional Python importer converts the official flomo HTML export into Memo Flow Markdown files. It defaults to a read-only preview, preserves timestamps and tags, copies local attachments, and records an idempotent import manifest.

Preview first:

```bash
python3 tools/import_flomo.py \
  --source "/path/to/flomo@account-export" \
  --vault "/path/to/YourVault" \
  --dry-run
```

Apply only after reviewing the counts:

```bash
python3 tools/import_flomo.py \
  --source "/path/to/flomo@account-export" \
  --vault "/path/to/YourVault" \
  --apply
```

The importer never modifies the source export. Re-running the same import skips unchanged records. If both the source and local memo may have changed, it reports a conflict instead of overwriting the file.

> **Filesystem disclosure:** the optional importer is a separate command-line tool. It reads only the export folder passed with `--source` and writes only the Vault passed with `--vault`. It makes no network requests and sends no data anywhere.

Memo Flow is an independent project and is not affiliated with or endorsed by flomo.

## Privacy and permissions

The Obsidian plugin:

- accesses files only inside the active Vault through Obsidian APIs;
- does not access files outside the Vault;
- does not make network requests;
- does not collect client- or server-side telemetry;
- does not install or update itself or its dependencies;
- does not require an account or paid service.

See [Data and privacy](docs/data-and-privacy.md) for details.

## Development

Requirements: Node.js 18 or later and Python 3.10 or later.

```bash
npm install
npm run check
```

The build produces `main.js`. For development, copy or clone the project into `.obsidian/plugins/memo-flow/`, run `npm run dev`, and reload the plugin after changes.

## Contributing and support

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Report bugs and request features in [GitHub Issues](https://github.com/Zovo314/obsidian-memo-flow/issues).
- Report security issues according to [SECURITY.md](SECURITY.md).
- Release history is documented in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Zovo314
