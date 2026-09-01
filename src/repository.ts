import { App, TFile, TFolder, getFrontMatterInfo, normalizePath, parseYaml } from "obsidian";
import type { MemoRecord, NewMemoInput, PendingAttachment } from "./types";
import { MEMO_SCHEMA_VERSION } from "./types";
import {
  assetsFolder,
  createMemoId,
  entriesFolder,
  extensionForMime,
  extractInlineTags,
  firstMeaningfulLine,
  formatLocalDateTime,
  isMemoPath,
  joinVaultPath,
  sha256Hex,
  splitFrontmatter,
  yamlQuote
} from "./utils";

export class MemoConflictError extends Error {
  constructor() {
    super("文件已被另一设备或进程修改，请重新打开后再编辑。");
    this.name = "MemoConflictError";
  }
}

export class MemoRepository {
  constructor(
    private readonly app: App,
    private readonly getRootFolder: () => string
  ) {}

  async ensureFolders(): Promise<void> {
    const root = this.getRootFolder();
    await this.ensureFolder(root);
    await this.ensureFolder(entriesFolder(root));
    await this.ensureFolder(assetsFolder(root));
  }

  async list(): Promise<MemoRecord[]> {
    const root = this.getRootFolder();
    const files = this.app.vault.getMarkdownFiles().filter((file) => isMemoPath(file.path, root));
    const records = await Promise.all(files.map(async (file) => this.read(file)));
    return records
      .filter((memo): memo is MemoRecord => memo !== null)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1;
        }
        return b.created.localeCompare(a.created);
      });
  }

  async read(file: TFile): Promise<MemoRecord | null> {
    const content = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);
    let frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!frontmatter) {
      const info = getFrontMatterInfo(content);
      if (info.exists) {
        try {
          frontmatter = parseYaml(info.frontmatter) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
    if (frontmatter?.type !== "memo") {
      return null;
    }
    const { body } = splitFrontmatter(content);
    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.map(String)
      : typeof frontmatter.tags === "string"
        ? [frontmatter.tags]
        : [];
    const aliases = Array.isArray(frontmatter.aliases)
      ? frontmatter.aliases.map(String)
      : typeof frontmatter.aliases === "string"
        ? [frontmatter.aliases]
        : [];
    return {
      file,
      body: body.trimEnd(),
      memoId: String(frontmatter.memo_id ?? file.basename),
      created: String(frontmatter.created ?? new Date(file.stat.ctime).toISOString()),
      updated: frontmatter.updated ? String(frontmatter.updated) : undefined,
      tags,
      aliases,
      pinned: frontmatter.pinned === true,
      archived: frontmatter.archived === true,
      source: String(frontmatter.source ?? "obsidian")
    };
  }

  async create(input: NewMemoInput): Promise<TFile> {
    const body = input.body.trim();
    if (!body && !(input.attachmentPaths?.length)) {
      throw new Error("memo 内容不能为空。");
    }
    await this.ensureFolders();
    const now = new Date();
    const created = formatLocalDateTime(now);
    const memoId = createMemoId(now);
    const folder = joinVaultPath(entriesFolder(this.getRootFolder()), created.slice(0, 4), created.slice(5, 7));
    await this.ensureFolder(folder);
    const path = joinVaultPath(folder, `${memoId}.md`);
    const attachmentMarkdown = (input.attachmentPaths ?? []).map((item) => `![[${item}]]`).join("\n\n");
    const completeBody = [body, attachmentMarkdown].filter(Boolean).join("\n\n");
    const markdown = this.serializeNewMemo({
      body: completeBody,
      created,
      memoId,
      source: "obsidian"
    });
    return this.app.vault.create(path, markdown);
  }

  async saveAttachments(files: PendingAttachment[]): Promise<string[]> {
    if (!files.length) {
      return [];
    }
    await this.ensureFolder(assetsFolder(this.getRootFolder()));
    const output: string[] = [];
    for (const file of files) {
      const hash = await sha256Hex(file.data);
      const extension = extensionForMime(file.name, file.mimeType);
      const path = joinVaultPath(assetsFolder(this.getRootFolder()), `${hash.slice(0, 16)}.${extension}`);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (!existing) {
        await this.app.vault.createBinary(path, file.data);
      }
      output.push(path);
    }
    return output;
  }

  async updateBody(memo: MemoRecord, nextBody: string): Promise<void> {
    const trimmed = nextBody.trim();
    if (!trimmed) {
      throw new Error("memo 内容不能为空。");
    }
    await this.app.vault.process(memo.file, (current) => {
      const parts = splitFrontmatter(current);
      if (parts.body.trimEnd() !== memo.body.trimEnd()) {
        throw new MemoConflictError();
      }
      return `${parts.frontmatter}${trimmed}\n`;
    });
    await this.app.fileManager.processFrontMatter(memo.file, (frontmatter) => {
      frontmatter.updated = formatLocalDateTime(new Date());
      frontmatter.tags = extractInlineTags(trimmed);
      frontmatter.aliases = [firstMeaningfulLine(trimmed)];
    });
  }

  async toggleBoolean(memo: MemoRecord, property: "pinned" | "archived"): Promise<void> {
    await this.app.fileManager.processFrontMatter(memo.file, (frontmatter) => {
      frontmatter[property] = !(frontmatter[property] === true);
      frontmatter.updated = formatLocalDateTime(new Date());
    });
  }

  async trash(memo: MemoRecord): Promise<void> {
    await this.app.fileManager.trashFile(memo.file);
  }

  private serializeNewMemo(input: {
    body: string;
    created: string;
    memoId: string;
    source: string;
  }): string {
    const tags = extractInlineTags(input.body);
    const aliases = [firstMeaningfulLine(input.body)];
    const lines = [
      "---",
      "type: memo",
      `memo_schema: ${MEMO_SCHEMA_VERSION}`,
      `memo_id: ${yamlQuote(input.memoId)}`,
      `created: ${yamlQuote(input.created)}`,
      `source: ${yamlQuote(input.source)}`,
      ...(tags.length ? ["tags:", ...tags.map((tag) => `  - ${yamlQuote(tag)}`)] : ["tags: []"]),
      "aliases:",
      ...aliases.map((alias) => `  - ${yamlQuote(alias)}`),
      "pinned: false",
      "archived: false",
      "---",
      "",
      input.body.trim(),
      ""
    ];
    return lines.join("\n");
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized) {
      return;
    }
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFolder) {
      return;
    }
    if (existing) {
      throw new Error(`${normalized} 已存在，但不是文件夹。`);
    }
    const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    if (parent) {
      await this.ensureFolder(parent);
    }
    if (!this.app.vault.getAbstractFileByPath(normalized)) {
      await this.app.vault.createFolder(normalized);
    }
  }
}
