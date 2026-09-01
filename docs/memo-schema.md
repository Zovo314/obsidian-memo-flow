# Memo Flow Markdown schema

Memo Flow uses one Markdown file per memo. Markdown is authoritative; any in-memory index is disposable.

## Required properties

```yaml
---
type: memo
memo_schema: 1
memo_id: "memo-20260901T105904-a1b2c3d4"
created: "2026-09-01T10:59:04"
source: "obsidian"
tags: []
aliases:
  - "A short first-line summary"
pinned: false
archived: false
---
```

- `memo_id` is immutable and globally unique inside the Vault.
- `created` is a local wall-clock value. An imported source without timezone information is never silently converted.
- `source` is `obsidian`, `flomo`, or another future adapter name.
- `tags` and `aliases` use native Obsidian property types.

## Imported properties

flomo imports also include `source_account`, `source_key`, `source_export`, and `source_hash`. Agents and users should not edit those fields manually.

## Attachments

Attachments are content-addressed and embedded with normal Obsidian syntax:

```markdown
![[Memos/Assets/flomo/57b864a66c6c5374.png]]
```

