# Memo Flow

**Memo Flow** 是一个本地优先、以 Markdown 为唯一数据源的 Obsidian 碎片笔记瀑布流。你可以快速记录想法，然后在统一的时间流中浏览、搜索、筛选、置顶和归档。

[English](README.md)

![Memo Flow 深色模式](images/memo-flow-dark.png)

## 核心特点

- **标准 Markdown**：每条 memo 都是 Vault 中独立、普通的 `.md` 文件。
- **本地优先**：没有服务器、账号、遥测、广告或网络请求。
- **桌面与移动端**：使用 Obsidian Vault API，已在 macOS 和 iPhone 验证。
- **适合 iCloud**：每条 memo 一个文件，减少多设备同时写入同一文件的冲突。
- **AI 可读取**：授权 Vault 路径后，Codex、Claude Code 等本地工具可以直接处理笔记。
- **无锁定**：停用或卸载插件后，笔记仍可正常阅读和编辑。

## 功能

- 瀑布流和命令面板快速记录。
- `Cmd/Ctrl + Enter` 保存。
- Markdown、`#标签`、粘贴或拖入图片。
- 按日期分组的时间倒序瀑布流和渐进加载。
- 全文搜索和标签筛选。
- 编辑、置顶、归档、打开原文、复制链接和移至 Obsidian 回收站。
- 多设备文件变化时的乐观冲突保护。
- 基于内容哈希的附件去重。
- 可选的 flomo 官方 HTML 导出导入器。

## 安装

### BRAT

首次 GitHub Release 发布后：

1. 安装并启用 [BRAT](https://obsidian.md/plugins?id=obsidian42-brat)。
2. 在 BRAT 设置中选择 **Add Beta plugin**。
3. 输入 `Zovo314/obsidian-memo-flow`。
4. 在「设置 → 第三方插件」启用 Memo Flow。

### 手动安装

1. 从 [最新 Release](https://github.com/Zovo314/obsidian-memo-flow/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 创建 `<你的Vault>/.obsidian/plugins/memo-flow/`。
3. 将三个文件复制进去。
4. 重新加载 Obsidian 并启用 Memo Flow。

## 使用

点击左侧栏图标，或在命令面板运行 **Memo Flow: 打开瀑布流**。输入内容后按 `Cmd/Ctrl + Enter` 保存。

默认数据目录：

```text
Memos/
├── Entries/YYYY/MM/memo-*.md
├── Assets/
├── Imports/
└── AI-GUIDE.md
```

可以在插件设置中修改根目录。详细格式见 [Memo schema](docs/memo-schema.md)。

## 导入 flomo 离线导出

先进行只读预览：

```bash
python3 tools/import_flomo.py \
  --source "/path/to/flomo@account-export" \
  --vault "/path/to/YourVault" \
  --dry-run
```

确认数量后正式导入：

```bash
python3 tools/import_flomo.py \
  --source "/path/to/flomo@account-export" \
  --vault "/path/to/YourVault" \
  --apply
```

导入器不会修改原始导出；重复执行会跳过未变化记录；来源与本地均发生变化时会报告冲突而不是覆盖。

> **文件访问说明：**导入器是独立命令行工具，只读取 `--source` 指定的导出目录，只写入 `--vault` 指定的 Vault，不发送网络请求。

Memo Flow 是独立项目，与 flomo 没有隶属或官方合作关系。

## 隐私

插件只通过 Obsidian API 访问当前 Vault，不访问 Vault 外部文件，不联网，不收集遥测，不需要账号或付费服务。详见 [数据与隐私](docs/data-and-privacy.md)。

## 开发

需要 Node.js 18+ 和 Python 3.10+：

```bash
npm install
npm run check
```

## 许可证

[MIT](LICENSE) © 2026 Zovo314

