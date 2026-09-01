from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.import_flomo import FlomoImporter, split_frontmatter


EXPORT_HTML = """<!doctype html>
<html><body>
<div class="name">@tester</div>
<div class="date">于 2026-9-1 导出 2 条 MEMO</div>
<div class="memos">
  <div class="memo">
    <div class="time">2026-09-01 10:59:04</div>
    <div class="content"><p>第一条 <strong>加粗</strong></p><p>#观点</p></div>
    <div class="files"></div>
  </div>
  <div class="memo">
    <div class="time">2026-08-31 09:10:11</div>
    <div class="content"><p>列表</p><ol><li><p>甲</p></li><li><p><mark>乙</mark></p></li></ol></div>
    <div class="files"><img src="file/example.png" alt="示例"></div>
  </div>
</div>
</body></html>"""


class FlomoImporterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "flomo@tester-20260901"
        self.vault = self.root / "Vault"
        (self.source / "file").mkdir(parents=True)
        (self.source / "notes.html").write_text(EXPORT_HTML, encoding="utf-8")
        (self.source / "file" / "example.png").write_bytes(b"fake-png-for-import-test")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_plan_is_read_only_and_converts_content(self) -> None:
        importer = FlomoImporter(self.source, self.vault)
        plan = importer.build_plan()
        self.assertEqual(plan.declared_count, 2)
        self.assertEqual(plan.parsed_count, 2)
        self.assertEqual(plan.attachments, 1)
        self.assertEqual(plan.status_counts["create"], 2)
        self.assertEqual(plan.tag_occurrences, {"观点": 1})
        self.assertFalse(self.vault.exists())
        self.assertIn("**加粗**", importer.memos[0].body)
        self.assertIn("1. 甲", importer.memos[1].body)
        self.assertIn("==乙==", importer.memos[1].body)

    def test_apply_is_idempotent(self) -> None:
        importer = FlomoImporter(self.source, self.vault)
        plan = importer.build_plan()
        importer.apply(plan)
        entries = sorted((self.vault / "Memos" / "Entries").rglob("*.md"))
        self.assertEqual(len(entries), 2)
        self.assertTrue((self.vault / "Memos" / "AI-GUIDE.md").is_file())
        self.assertEqual(len(list((self.vault / "Memos" / "Assets").rglob("*.png"))), 1)
        manifest = json.loads(next((self.vault / "Memos" / "Imports").glob("*.manifest.json")).read_text(encoding="utf-8"))
        self.assertEqual(manifest["parsed_count"], 2)

        second = FlomoImporter(self.source, self.vault)
        second_plan = second.build_plan()
        self.assertEqual(second_plan.status_counts["skip"], 2)
        self.assertEqual(second_plan.status_counts["create"], 0)

    def test_local_edit_conflicts_with_changed_source(self) -> None:
        first = FlomoImporter(self.source, self.vault)
        first_plan = first.build_plan()
        first.apply(first_plan)
        target = next((self.vault / "Memos" / "Entries").rglob("*.md"))
        frontmatter, body = split_frontmatter(target.read_text(encoding="utf-8"))
        target.write_text(frontmatter + body.rstrip() + "\n\n本地修改\n", encoding="utf-8")
        html_path = self.source / "notes.html"
        html_path.write_text(EXPORT_HTML.replace("第一条", "第一条已在 flomo 更新"), encoding="utf-8")

        second = FlomoImporter(self.source, self.vault)
        second_plan = second.build_plan()
        statuses = {item.source_key: item.status for item in second_plan.items}
        self.assertIn("conflict", statuses.values())


if __name__ == "__main__":
    unittest.main()

