#!/usr/bin/env python3
"""Import a flomo offline HTML export into Memo Flow Markdown files.

The importer is intentionally dependency-free. It never modifies the source
export, defaults to a dry run, and records enough information to make repeated
imports idempotent and conflict-aware.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Sequence


VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
KNOWN_CONTENT_TAGS = {
    "a", "b", "blockquote", "br", "code", "del", "em", "i", "img", "li",
    "mark", "ol", "p", "pre", "s", "span", "strong", "u", "ul"
}


@dataclass
class HtmlNode:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list[HtmlNode | str] = field(default_factory=list)

    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def descendants(self, tag: str | None = None) -> Iterable[HtmlNode]:
        for child in self.children:
            if isinstance(child, HtmlNode):
                if tag is None or child.tag == tag:
                    yield child
                yield from child.descendants(tag)

    def text(self, separator: str = "") -> str:
        parts: list[str] = []
        for child in self.children:
            if isinstance(child, str):
                parts.append(child)
            elif child.tag == "br":
                parts.append("\n")
            else:
                parts.append(child.text(separator))
                if separator and child.tag in {"p", "li", "div"}:
                    parts.append(separator)
        return "".join(parts)


class HtmlTreeBuilder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = HtmlNode("document")
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = HtmlNode(tag.lower(), {key: value or "" for key, value in attrs})
        self.stack[-1].children.append(node)
        if node.tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == lowered:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self.stack[-1].children.append(data)


def find_by_class(root: HtmlNode, class_name: str) -> list[HtmlNode]:
    return [node for node in root.descendants() if class_name in node.classes()]


def first_by_class(root: HtmlNode, class_name: str) -> HtmlNode | None:
    return next((node for node in root.descendants() if class_name in node.classes()), None)


class MarkdownConverter:
    def __init__(self) -> None:
        self.unknown_tags: Counter[str] = Counter()

    def convert(self, node: HtmlNode) -> str:
        rendered = self._render_children(node)
        rendered = re.sub(r"[ \t]+\n", "\n", rendered)
        rendered = re.sub(r"\n{3,}", "\n\n", rendered)
        return rendered.strip()

    def _render_children(self, node: HtmlNode) -> str:
        return "".join(self._render(child) for child in node.children)

    def _render(self, value: HtmlNode | str) -> str:
        if isinstance(value, str):
            return value
        tag = value.tag
        if tag not in KNOWN_CONTENT_TAGS:
            self.unknown_tags[tag] += 1
            return self._render_children(value)
        if tag == "br":
            return "\n"
        if tag == "p":
            return f"{self._render_children(value).strip()}\n\n"
        if tag in {"strong", "b"}:
            return f"**{self._render_children(value).strip()}**"
        if tag in {"em", "i"}:
            return f"*{self._render_children(value).strip()}*"
        if tag == "mark":
            return f"=={self._render_children(value).strip()}=="
        if tag == "u":
            return f"<u>{self._render_children(value).strip()}</u>"
        if tag in {"del", "s"}:
            return f"~~{self._render_children(value).strip()}~~"
        if tag == "code":
            return f"`{self._render_children(value).strip()}`"
        if tag == "pre":
            return f"\n```\n{value.text().strip()}\n```\n\n"
        if tag == "blockquote":
            text = self.convert(value)
            return "\n".join(f"> {line}" if line else ">" for line in text.splitlines()) + "\n\n"
        if tag == "a":
            label = self._render_children(value).strip() or value.attrs.get("href", "")
            href = value.attrs.get("href", "")
            return f"[{label}]({href})" if href else label
        if tag == "img":
            src = value.attrs.get("src", "")
            alt = value.attrs.get("alt", "")
            return f"![{alt}]({src})" if src else ""
        if tag in {"ul", "ol"}:
            return self._render_list(value, ordered=tag == "ol")
        if tag == "li":
            return self._render_children(value)
        return self._render_children(value)

    def _render_list(self, node: HtmlNode, ordered: bool) -> str:
        output: list[str] = []
        items = [child for child in node.children if isinstance(child, HtmlNode) and child.tag == "li"]
        for index, item in enumerate(items, start=1):
            nested = [child for child in item.children if isinstance(child, HtmlNode) and child.tag in {"ul", "ol"}]
            regular = [child for child in item.children if child not in nested]
            text = "".join(self._render(child) for child in regular).strip()
            lines = [line for line in text.splitlines() if line.strip()]
            marker = f"{index}." if ordered else "-"
            if lines:
                output.append(f"{marker} {lines[0].strip()}")
                output.extend(f"   {line.strip()}" for line in lines[1:])
            else:
                output.append(f"{marker}")
            for child in nested:
                nested_text = self._render(child).strip("\n")
                output.extend(f"   {line}" for line in nested_text.splitlines())
        return "\n".join(output) + "\n\n"


@dataclass
class Attachment:
    source: Path
    target_relative: str
    sha256: str


@dataclass
class ImportedMemo:
    created: str
    memo_id: str
    source_key: str
    source_hash: str
    body: str
    tags: list[str]
    alias: str
    target_relative: str
    attachments: list[Attachment]


@dataclass
class PlanItem:
    source_key: str
    memo_id: str
    target_path: str
    source_hash: str
    imported_body_hash: str
    status: str
    reason: str = ""


@dataclass
class ImportPlan:
    source: str
    vault: str
    account: str
    exported_at: str
    source_file_sha256: str
    declared_count: int | None
    parsed_count: int
    attachments: int
    tag_occurrences: dict[str, int]
    unknown_tags: dict[str, int]
    items: list[PlanItem]

    @property
    def status_counts(self) -> Counter[str]:
        return Counter(item.status for item in self.items)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def safe_slug(value: str, fallback: str = "unknown") -> str:
    slug = re.sub(r"[^0-9A-Za-z_-]+", "-", value.strip()).strip("-").lower()
    return slug or fallback


def extract_tags(text: str) -> list[str]:
    found: set[str] = set()
    for match in re.finditer(r"(?:^|\s)#([^\s#]+)", text):
        tag = match.group(1).strip(".,，。；;：:！？!?()[]{}<>").strip("/")
        if tag and not tag.isdigit():
            found.add(tag)
    return sorted(found)


def first_alias(markdown: str) -> str:
    for line in markdown.splitlines():
        cleaned = re.sub(r"^[-*+>]\s+", "", line.strip())
        cleaned = re.sub(r"[*_~=`#]", "", cleaned).strip()
        if cleaned:
            return cleaned[:60]
    return "未命名 memo"


def split_frontmatter(markdown: str) -> tuple[str, str]:
    match = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?", markdown)
    if not match:
        return "", markdown
    return match.group(0), markdown[match.end():].lstrip("\r\n")


def frontmatter_scalar(markdown: str, key: str) -> str | None:
    frontmatter, _ = split_frontmatter(markdown)
    match = re.search(rf"(?m)^{re.escape(key)}:\s*(.+?)\s*$", frontmatter)
    if not match:
        return None
    raw = match.group(1)
    try:
        value = json.loads(raw)
        return str(value)
    except json.JSONDecodeError:
        return raw.strip("'\"")


def markdown_document(memo: ImportedMemo, export_name: str, account: str, pinned: bool = False, archived: bool = False) -> str:
    lines = [
        "---",
        "type: memo",
        "memo_schema: 1",
        f"memo_id: {yaml_quote(memo.memo_id)}",
        f"created: {yaml_quote(memo.created)}",
        "source: flomo",
        f"source_account: {yaml_quote(account)}",
        f"source_key: {yaml_quote(memo.source_key)}",
        f"source_export: {yaml_quote(export_name)}",
        f"source_hash: {yaml_quote('sha256:' + memo.source_hash)}",
    ]
    if memo.tags:
        lines.append("tags:")
        lines.extend(f"  - {yaml_quote(tag)}" for tag in memo.tags)
    else:
        lines.append("tags: []")
    lines.extend([
        "aliases:",
        f"  - {yaml_quote(memo.alias)}",
        f"pinned: {'true' if pinned else 'false'}",
        f"archived: {'true' if archived else 'false'}",
        "---",
        "",
        memo.body.rstrip(),
        "",
    ])
    return "\n".join(lines)


class FlomoImporter:
    def __init__(self, source: Path, vault: Path, root_folder: str = "Memos") -> None:
        self.source = source.expanduser().resolve()
        self.vault = vault.expanduser().resolve()
        if Path(root_folder).is_absolute() or ".." in Path(root_folder).parts:
            raise ValueError("root folder 必须是安全的 Vault 相对路径。")
        self.root_folder = root_folder.strip("/") or "Memos"
        self.html_path = self._find_html()
        self.converter = MarkdownConverter()
        self.account = "unknown"
        self.exported_at = "unknown"
        self.declared_count: int | None = None
        self.source_file_sha256 = ""
        self.memos: list[ImportedMemo] = []
        self.tag_counter: Counter[str] = Counter()
        self.previous_entries = self._load_previous_entries()

    def build_plan(self) -> ImportPlan:
        raw = self.html_path.read_bytes()
        self.source_file_sha256 = sha256_bytes(raw)
        builder = HtmlTreeBuilder()
        builder.feed(raw.decode("utf-8-sig"))
        root = builder.root
        self._parse_header(root)
        memo_nodes = find_by_class(root, "memo")
        parsed: list[tuple[str, str, list[str], list[Attachment]]] = []
        timestamps: Counter[str] = Counter()
        for node in memo_nodes:
            time_node = first_by_class(node, "time")
            content_node = first_by_class(node, "content")
            files_node = first_by_class(node, "files")
            if time_node is None or content_node is None:
                raise ValueError("发现缺少 time 或 content 的 memo。")
            created = time_node.text().strip().replace(" ", "T", 1)
            datetime.strptime(created, "%Y-%m-%dT%H:%M:%S")
            body = self.converter.convert(content_node)
            if not body:
                raise ValueError(f"{created} 的 memo 内容为空。")
            tags = extract_tags(content_node.text("\n"))
            self.tag_counter.update(tags)
            attachments = self._parse_attachments(files_node)
            if attachments:
                embeds = "\n\n".join(f"![[{item.target_relative}]]" for item in attachments)
                body = f"{body.rstrip()}\n\n{embeds}"
            timestamps[created] += 1
            parsed.append((created, body, tags, attachments))

        account_slug = safe_slug(self.account)
        for created, body, tags, attachments in parsed:
            compact = created.replace("-", "").replace(":", "")
            base_id = f"flomo-{account_slug}-{compact}"
            material = json.dumps({
                "created": created,
                "body": body,
                "tags": tags,
                "attachments": [item.target_relative for item in attachments]
            }, ensure_ascii=False, sort_keys=True)
            source_hash = sha256_text(material)
            memo_id = f"{base_id}-{source_hash[:8]}" if timestamps[created] > 1 else base_id
            year, month = created[:4], created[5:7]
            target = f"{self.root_folder}/Entries/{year}/{month}/{memo_id}.md"
            source_key = f"flomo:{self.account}:{created}"
            self.memos.append(ImportedMemo(
                created=created,
                memo_id=memo_id,
                source_key=source_key,
                source_hash=source_hash,
                body=body,
                tags=tags,
                alias=first_alias(body),
                target_relative=target,
                attachments=attachments,
            ))

        items = [self._plan_item(memo) for memo in self.memos]
        return ImportPlan(
            source=str(self.source),
            vault=str(self.vault),
            account=self.account,
            exported_at=self.exported_at,
            source_file_sha256=self.source_file_sha256,
            declared_count=self.declared_count,
            parsed_count=len(self.memos),
            attachments=sum(len(memo.attachments) for memo in self.memos),
            tag_occurrences=dict(sorted(self.tag_counter.items())),
            unknown_tags=dict(sorted(self.converter.unknown_tags.items())),
            items=items,
        )

    def apply(self, plan: ImportPlan) -> None:
        self.vault.mkdir(parents=True, exist_ok=True)
        backup_root = self.vault / self.root_folder / "Imports" / "Backups" / datetime.now().strftime("%Y%m%dT%H%M%S")
        item_by_key = {item.source_key: item for item in plan.items}
        for memo in self.memos:
            item = item_by_key[memo.source_key]
            if item.status not in {"create", "update"}:
                continue
            for attachment in memo.attachments:
                destination = self._vault_path(attachment.target_relative)
                if not destination.exists():
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(attachment.source, destination)
            target = self._vault_path(item.target_path)
            pinned = False
            archived = False
            if target.exists():
                existing = target.read_text(encoding="utf-8")
                pinned = frontmatter_scalar(existing, "pinned") == "True" or frontmatter_scalar(existing, "pinned") == "true"
                archived = frontmatter_scalar(existing, "archived") == "True" or frontmatter_scalar(existing, "archived") == "true"
                backup = backup_root / item.target_path
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, backup)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(
                markdown_document(memo, self.source.name, self.account, pinned=pinned, archived=archived),
                encoding="utf-8",
            )

        self._write_ai_guide()
        self._write_manifest(plan)
        self._write_report(plan)

    def _find_html(self) -> Path:
        if not self.source.is_dir():
            raise ValueError(f"源目录不存在：{self.source}")
        html_files = sorted(self.source.glob("*.html"))
        if len(html_files) != 1:
            raise ValueError(f"源目录必须恰好包含一个 HTML 文件，当前找到 {len(html_files)} 个。")
        return html_files[0]

    def _parse_header(self, root: HtmlNode) -> None:
        name = first_by_class(root, "name")
        date = first_by_class(root, "date")
        if name:
            self.account = name.text().strip().lstrip("@") or "unknown"
        if date:
            text = date.text().strip()
            count = re.search(r"导出\s*(\d+)\s*条", text)
            exported = re.search(r"于\s*(\d{4})-(\d{1,2})-(\d{1,2})", text)
            self.declared_count = int(count.group(1)) if count else None
            if exported:
                self.exported_at = f"{int(exported.group(1)):04d}-{int(exported.group(2)):02d}-{int(exported.group(3)):02d}"

    def _parse_attachments(self, files_node: HtmlNode | None) -> list[Attachment]:
        if files_node is None:
            return []
        output: list[Attachment] = []
        for image in files_node.descendants("img"):
            source_ref = image.attrs.get("src", "").strip()
            if not source_ref:
                continue
            source = (self.html_path.parent / html.unescape(source_ref)).resolve()
            try:
                source.relative_to(self.source)
            except ValueError as error:
                raise ValueError(f"附件路径越出导出目录：{source_ref}") from error
            if not source.is_file():
                raise ValueError(f"附件不存在：{source_ref}")
            digest = sha256_bytes(source.read_bytes())
            extension = source.suffix.lower() or ".bin"
            target = f"{self.root_folder}/Assets/flomo/{digest[:16]}{extension}"
            output.append(Attachment(source=source, target_relative=target, sha256=digest))
        return output

    def _load_previous_entries(self) -> dict[str, dict[str, object]]:
        imports = self.vault / self.root_folder / "Imports"
        entries: dict[str, dict[str, object]] = {}
        if not imports.is_dir():
            return entries
        for manifest in sorted(imports.glob("*.manifest.json")):
            try:
                data = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            for item in data.get("items", []):
                if isinstance(item, dict) and isinstance(item.get("source_key"), str):
                    entries[item["source_key"]] = item
        return entries

    def _plan_item(self, memo: ImportedMemo) -> PlanItem:
        previous = self.previous_entries.get(memo.source_key)
        target_relative = str(previous.get("target_path")) if previous and previous.get("target_path") else memo.target_relative
        target = self._vault_path(target_relative)
        body_hash = sha256_text(memo.body.rstrip())
        if not target.exists():
            return PlanItem(memo.source_key, memo.memo_id, target_relative, memo.source_hash, body_hash, "create")
        existing = target.read_text(encoding="utf-8")
        _, existing_body = split_frontmatter(existing)
        existing_body_hash = sha256_text(existing_body.rstrip())
        current_source_key = frontmatter_scalar(existing, "source_key")
        current_source_hash = (frontmatter_scalar(existing, "source_hash") or "").removeprefix("sha256:")
        if current_source_key and current_source_key != memo.source_key:
            return PlanItem(memo.source_key, memo.memo_id, target_relative, memo.source_hash, body_hash, "conflict", "目标文件属于其他来源记录")
        if current_source_hash == memo.source_hash:
            return PlanItem(memo.source_key, memo.memo_id, target_relative, memo.source_hash, existing_body_hash, "skip", "来源未变化")
        previous_body_hash = str(previous.get("imported_body_hash", "")) if previous else ""
        if previous_body_hash and existing_body_hash == previous_body_hash:
            return PlanItem(memo.source_key, memo.memo_id, target_relative, memo.source_hash, body_hash, "update", "来源变化且本地正文未修改")
        return PlanItem(memo.source_key, memo.memo_id, target_relative, memo.source_hash, existing_body_hash, "conflict", "来源与本地正文均可能变化")

    def _vault_path(self, relative: str) -> Path:
        target = (self.vault / relative).resolve()
        try:
            target.relative_to(self.vault)
        except ValueError as error:
            raise ValueError(f"目标路径越出 Vault：{relative}") from error
        return target

    def _manifest_base(self) -> str:
        return safe_slug(self.source.name, "flomo-export")

    def _write_manifest(self, plan: ImportPlan) -> None:
        path = self.vault / self.root_folder / "Imports" / f"{self._manifest_base()}.manifest.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema": 1,
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "source": plan.source,
            "source_file_sha256": plan.source_file_sha256,
            "account": plan.account,
            "exported_at": plan.exported_at,
            "declared_count": plan.declared_count,
            "parsed_count": plan.parsed_count,
            "attachments": plan.attachments,
            "tag_occurrences": plan.tag_occurrences,
            "unknown_tags": plan.unknown_tags,
            "items": [asdict(item) for item in plan.items],
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def _write_report(self, plan: ImportPlan) -> None:
        path = self.vault / self.root_folder / "Imports" / f"{self._manifest_base()}-report.md"
        counts = plan.status_counts
        lines = [
            "---",
            "type: memo-import-report",
            f"source: {yaml_quote(self.source.name)}",
            f"created: {yaml_quote(datetime.now().astimezone().isoformat(timespec='seconds'))}",
            "---",
            "",
            "# flomo 导入报告",
            "",
            f"- 账号：`@{plan.account}`",
            f"- 导出日期：{plan.exported_at}",
            f"- 解析笔记：{plan.parsed_count}",
            f"- 附件引用：{plan.attachments}",
            f"- 新建：{counts['create']}",
            f"- 更新：{counts['update']}",
            f"- 跳过：{counts['skip']}",
            f"- 冲突：{counts['conflict']}",
            "",
        ]
        conflicts = [item for item in plan.items if item.status == "conflict"]
        if conflicts:
            lines.extend(["## 冲突", ""])
            lines.extend(f"- `{item.target_path}`：{item.reason}" for item in conflicts)
            lines.append("")
        if plan.unknown_tags:
            lines.extend(["## 未知 HTML 元素", "", f"`{json.dumps(plan.unknown_tags, ensure_ascii=False)}`", ""])
        path.write_text("\n".join(lines), encoding="utf-8")

    def _write_ai_guide(self) -> None:
        path = self.vault / self.root_folder / "AI-GUIDE.md"
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "# Memo Flow：AI 文件操作指南\n\n"
            "Memo 文件位于 `Entries/YYYY/MM/`，每条 memo 是一个 Markdown 文件。\n\n"
            "- 可以修改正文、`tags`、`aliases`、`pinned` 和 `archived`。\n"
            "- 不要修改 `memo_id`、`created`、`source_key`、`source_hash`。\n"
            "- 新建文件时使用 `type: memo` 与 `memo_schema: 1`。\n"
            "- Vault 内附件使用 `![[Memos/Assets/文件名]]`。\n"
            "- 修改完成后，Memo Flow 会监听文件事件并刷新索引。\n",
            encoding="utf-8",
        )


def print_plan(plan: ImportPlan, applied: bool) -> None:
    counts = plan.status_counts
    mode = "APPLY" if applied else "DRY-RUN"
    print(f"[{mode}] flomo -> Memo Flow")
    print(f"source: {plan.source}")
    print(f"vault: {plan.vault}")
    print(f"account: @{plan.account}")
    print(f"declared/parsed: {plan.declared_count}/{plan.parsed_count}")
    print(f"attachments: {plan.attachments}")
    print(f"create={counts['create']} update={counts['update']} skip={counts['skip']} conflict={counts['conflict']}")
    if plan.unknown_tags:
        print(f"unknown HTML tags: {json.dumps(plan.unknown_tags, ensure_ascii=False)}")
    if not applied:
        print("No files were written. Re-run with --apply after reviewing this summary.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import a flomo offline export into Memo Flow Markdown files.")
    parser.add_argument("--source", required=True, type=Path, help="flomo export folder containing one HTML file")
    parser.add_argument("--vault", required=True, type=Path, help="target Obsidian Vault folder")
    parser.add_argument("--root-folder", default="Memos", help="target folder inside the Vault (default: Memos)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="validate and report without writing (default)")
    mode.add_argument("--apply", action="store_true", help="write imported Markdown and attachments")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        importer = FlomoImporter(args.source, args.vault, args.root_folder)
        plan = importer.build_plan()
        if plan.declared_count is not None and plan.declared_count != plan.parsed_count:
            raise ValueError(f"导出声明 {plan.declared_count} 条，但实际解析 {plan.parsed_count} 条。")
        if args.apply:
            importer.apply(plan)
        print_plan(plan, applied=args.apply)
        return 2 if plan.status_counts["conflict"] else 0
    except (OSError, UnicodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

