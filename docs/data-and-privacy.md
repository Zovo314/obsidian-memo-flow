# Data and privacy

## Obsidian plugin

Memo Flow stores notes and attachments inside the active Obsidian Vault. It uses Obsidian's `Vault`, `MetadataCache`, `FileManager`, and rendering APIs.

The plugin does not:

- send network requests;
- collect telemetry or analytics;
- require an account;
- access files outside the active Vault;
- install or update itself;
- load remote code or advertisements.

The in-memory feed index is disposable and can be rebuilt from Markdown files. Markdown remains the authoritative data source.

## Optional flomo importer

`tools/import_flomo.py` is a separate command-line tool and is not executed by the Obsidian plugin. It reads the folder explicitly passed to `--source` and writes the Vault explicitly passed to `--vault`.

The importer defaults to `--dry-run`, makes no network requests, never modifies the source export, and refuses paths that escape the selected source or Vault. Apply mode writes Markdown, attachments, an import manifest, and a human-readable report.

## AI tools

Memo Flow does not connect to AI services. Local agents can read the Markdown files only when the user separately grants them filesystem access to the Vault.

