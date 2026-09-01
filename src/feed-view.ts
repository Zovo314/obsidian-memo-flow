import {
  App,
  ItemView,
  MarkdownRenderer,
  Modal,
  Notice,
  WorkspaceLeaf,
  setIcon
} from "obsidian";
import type MemoFlowPlugin from "./main";
import type { MemoRecord, PendingAttachment } from "./types";
import { MemoConflictError } from "./repository";
import { createdDate, extractInlineTags, formatDisplayTime } from "./utils";

export const MEMO_FLOW_VIEW_TYPE = "memo-flow-view";

class MemoComposer {
  private readonly textarea: HTMLTextAreaElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly attachmentsEl: HTMLElement;
  private attachments: PendingAttachment[] = [];

  constructor(
    container: HTMLElement,
    private readonly onSubmit: (body: string, attachments: PendingAttachment[]) => Promise<void>
  ) {
    const composer = container.createDiv({ cls: "memo-flow-composer" });
    this.textarea = composer.createEl("textarea", {
      attr: {
        placeholder: "记录此刻的想法……支持 Markdown 和 #标签",
        rows: "4",
        "aria-label": "Memo 内容"
      }
    });
    this.attachmentsEl = composer.createDiv({ cls: "memo-flow-pending-attachments" });
    const footer = composer.createDiv({ cls: "memo-flow-composer-footer" });
    footer.createSpan({ text: "⌘/Ctrl + Enter 保存 · 可粘贴或拖入图片", cls: "memo-flow-hint" });
    this.submitButton = footer.createEl("button", { text: "记录", cls: "mod-cta" });

    this.submitButton.addEventListener("click", () => void this.submit());
    this.textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.textarea.addEventListener("paste", (event) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (files.length) {
        event.preventDefault();
        void this.addFiles(files);
      }
    });
    this.textarea.addEventListener("dragover", (event) => event.preventDefault());
    this.textarea.addEventListener("drop", (event) => {
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (files.length) {
        event.preventDefault();
        void this.addFiles(files);
      }
    });
  }

  focus(): void {
    this.textarea.focus();
  }

  private async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      this.attachments.push({
        name: file.name,
        mimeType: file.type,
        data: await file.arrayBuffer()
      });
    }
    this.renderAttachments();
  }

  private renderAttachments(): void {
    this.attachmentsEl.empty();
    this.attachments.forEach((file, index) => {
      const chip = this.attachmentsEl.createDiv({ cls: "memo-flow-attachment-chip" });
      chip.createSpan({ text: file.name || `图片 ${index + 1}` });
      const remove = chip.createEl("button", { attr: { "aria-label": "移除附件" } });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.attachments.splice(index, 1);
        this.renderAttachments();
      });
    });
  }

  private async submit(): Promise<void> {
    const body = this.textarea.value.trim();
    if (!body && !this.attachments.length) {
      new Notice("请输入内容或添加图片。");
      return;
    }
    this.submitButton.disabled = true;
    try {
      await this.onSubmit(body, this.attachments);
      this.textarea.value = "";
      this.attachments = [];
      this.renderAttachments();
      this.focus();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "保存 memo 失败。");
    } finally {
      this.submitButton.disabled = false;
    }
  }
}

class EditMemoModal extends Modal {
  constructor(
    app: App,
    private readonly memo: MemoRecord,
    private readonly onSave: (body: string) => Promise<void>
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("memo-flow-modal");
    contentEl.createEl("h2", { text: "编辑 memo" });
    const textarea = contentEl.createEl("textarea", {
      text: this.memo.body,
      attr: { rows: "14", "aria-label": "编辑 memo 内容" }
    });
    const actions = contentEl.createDiv({ cls: "memo-flow-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    const save = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    cancel.addEventListener("click", () => this.close());
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await this.onSave(textarea.value);
        this.close();
      } catch (error) {
        const message = error instanceof MemoConflictError
          ? error.message
          : error instanceof Error ? error.message : "保存失败。";
        new Notice(message);
      } finally {
        save.disabled = false;
      }
    });
    window.setTimeout(() => textarea.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

class ConfirmDeleteModal extends Modal {
  constructor(
    app: MemoFlowPlugin["app"],
    private readonly onConfirm: () => Promise<void>
  ) {
    super(app);
  }

  override onOpen(): void {
    this.contentEl.createEl("h2", { text: "删除这条 memo？" });
    this.contentEl.createEl("p", { text: "文件将进入 Obsidian 回收站，可按当前 Vault 的回收站策略恢复。" });
    const actions = this.contentEl.createDiv({ cls: "memo-flow-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    const confirm = actions.createEl("button", { text: "移至回收站", cls: "mod-warning" });
    cancel.addEventListener("click", () => this.close());
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        await this.onConfirm();
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "删除失败。");
        confirm.disabled = false;
      }
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class MemoFlowView extends ItemView {
  private memos: MemoRecord[] = [];
  private query = "";
  private selectedTag = "";
  private showArchived: boolean;
  private visibleCount: number;
  private listEl: HTMLElement | null = null;
  private filterTagEl: HTMLSelectElement | null = null;
  private observer: IntersectionObserver | null = null;
  private composer: MemoComposer | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: MemoFlowPlugin) {
    super(leaf);
    this.showArchived = plugin.settings.showArchivedByDefault;
    this.visibleCount = plugin.settings.pageSize;
  }

  override getViewType(): string {
    return MEMO_FLOW_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Memo Flow";
  }

  override getIcon(): string {
    return "messages-square";
  }

  override async onOpen(): Promise<void> {
    this.buildLayout();
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.observer?.disconnect();
    this.observer = null;
  }

  async refresh(): Promise<void> {
    this.memos = await this.plugin.repository.list();
    this.visibleCount = Math.max(this.visibleCount, this.plugin.settings.pageSize);
    this.updateTagOptions();
    await this.renderFeed();
  }

  focusComposer(): void {
    this.composer?.focus();
  }

  private buildLayout(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("memo-flow-view");
    const shell = container.createDiv({ cls: "memo-flow-shell" });
    const header = shell.createDiv({ cls: "memo-flow-header" });
    const heading = header.createDiv();
    heading.createEl("h1", { text: "Memo Flow" });
    heading.createEl("p", { text: "你的 Markdown 碎片笔记", cls: "memo-flow-subtitle" });

    this.composer = new MemoComposer(shell, async (body, attachments) => {
      const paths = await this.plugin.repository.saveAttachments(attachments);
      await this.plugin.repository.create({ body, attachmentPaths: paths });
      new Notice("Memo 已保存。");
      await this.plugin.refreshViews();
    });

    const filters = shell.createDiv({ cls: "memo-flow-filters" });
    const search = filters.createEl("input", {
      type: "search",
      attr: { placeholder: "搜索正文、标签或别名", "aria-label": "搜索 memo" }
    });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLocaleLowerCase();
      this.visibleCount = this.plugin.settings.pageSize;
      void this.renderFeed();
    });
    this.filterTagEl = filters.createEl("select", { attr: { "aria-label": "按标签筛选" } });
    this.filterTagEl.addEventListener("change", () => {
      this.selectedTag = this.filterTagEl?.value ?? "";
      this.visibleCount = this.plugin.settings.pageSize;
      void this.renderFeed();
    });
    const archivedLabel = filters.createEl("label", { cls: "memo-flow-checkbox" });
    const archived = archivedLabel.createEl("input", { type: "checkbox" });
    archived.checked = this.showArchived;
    archivedLabel.createSpan({ text: "显示归档" });
    archived.addEventListener("change", () => {
      this.showArchived = archived.checked;
      this.visibleCount = this.plugin.settings.pageSize;
      void this.renderFeed();
    });
    this.listEl = shell.createDiv({ cls: "memo-flow-list" });
  }

  private updateTagOptions(): void {
    if (!this.filterTagEl) {
      return;
    }
    const tags = Array.from(new Set(this.memos.flatMap((memo) => memo.tags))).sort((a, b) => a.localeCompare(b));
    this.filterTagEl.empty();
    this.filterTagEl.createEl("option", { value: "", text: "全部标签" });
    for (const tag of tags) {
      this.filterTagEl.createEl("option", { value: tag, text: `#${tag}` });
    }
    this.filterTagEl.value = tags.includes(this.selectedTag) ? this.selectedTag : "";
  }

  private filteredMemos(): MemoRecord[] {
    return this.memos.filter((memo) => {
      if (!this.showArchived && memo.archived) {
        return false;
      }
      if (this.selectedTag && !memo.tags.includes(this.selectedTag)) {
        return false;
      }
      if (!this.query) {
        return true;
      }
      const haystack = [memo.body, ...memo.tags, ...memo.aliases, memo.source].join("\n").toLocaleLowerCase();
      return haystack.includes(this.query);
    });
  }

  private async renderFeed(): Promise<void> {
    if (!this.listEl) {
      return;
    }
    this.observer?.disconnect();
    this.listEl.empty();
    const filtered = this.filteredMemos();
    const visible = filtered.slice(0, this.visibleCount);
    if (!visible.length) {
      const empty = this.listEl.createDiv({ cls: "memo-flow-empty" });
      empty.createEl("h3", { text: "还没有符合条件的 memo" });
      empty.createEl("p", { text: "在上方记录第一条想法，或调整筛选条件。" });
      return;
    }

    let currentDate = "";
    for (const memo of visible) {
      const date = createdDate(memo.created);
      if (date !== currentDate) {
        currentDate = date;
        this.listEl.createEl("h2", { text: date, cls: "memo-flow-date-heading" });
      }
      await this.renderCard(this.listEl, memo);
    }

    if (visible.length < filtered.length) {
      const sentinel = this.listEl.createDiv({ cls: "memo-flow-sentinel", text: "继续滚动以加载更多" });
      this.observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.visibleCount += this.plugin.settings.pageSize;
          void this.renderFeed();
        }
      }, { root: this.contentEl, rootMargin: "300px" });
      this.observer.observe(sentinel);
    } else {
      this.listEl.createDiv({ cls: "memo-flow-end", text: `共 ${filtered.length} 条 memo` });
    }
  }

  private async renderCard(container: HTMLElement, memo: MemoRecord): Promise<void> {
    const card = container.createEl("article", { cls: "memo-flow-card" });
    if (memo.pinned) {
      card.addClass("is-pinned");
    }
    if (memo.archived) {
      card.addClass("is-archived");
    }
    const meta = card.createDiv({ cls: "memo-flow-card-meta" });
    const timeButton = meta.createEl("button", {
      text: formatDisplayTime(memo.created),
      cls: "memo-flow-time"
    });
    timeButton.addEventListener("click", () => void this.app.workspace.getLeaf(true).openFile(memo.file));
    const source = meta.createSpan({ text: memo.source, cls: "memo-flow-source" });
    source.setAttr("title", `来源：${memo.source}`);
    const actions = meta.createDiv({ cls: "memo-flow-card-actions" });
    this.addIconButton(actions, memo.pinned ? "pin-off" : "pin", memo.pinned ? "取消置顶" : "置顶", async () => {
      await this.plugin.repository.toggleBoolean(memo, "pinned");
      await this.plugin.refreshViews();
    });
    this.addIconButton(actions, "pencil", "编辑", () => {
      new EditMemoModal(this.app, memo, async (body) => {
        await this.plugin.repository.updateBody(memo, body);
        await this.plugin.refreshViews();
      }).open();
    });
    this.addIconButton(actions, memo.archived ? "archive-restore" : "archive", memo.archived ? "取消归档" : "归档", async () => {
      await this.plugin.repository.toggleBoolean(memo, "archived");
      await this.plugin.refreshViews();
    });
    this.addIconButton(actions, "link", "复制 Obsidian 链接", async () => {
      await navigator.clipboard.writeText(`[[${memo.file.path.slice(0, -3)}]]`);
      new Notice("链接已复制。");
    });
    this.addIconButton(actions, "trash-2", "移至回收站", () => {
      new ConfirmDeleteModal(this.app, async () => {
        await this.plugin.repository.trash(memo);
        await this.plugin.refreshViews();
      }).open();
    });

    const body = card.createDiv({ cls: "memo-flow-card-body markdown-rendered" });
    await MarkdownRenderer.render(this.app, memo.body, body, memo.file.path, this);
    const inlineTags = new Set(extractInlineTags(memo.body));
    for (const tagElement of body.querySelectorAll<HTMLElement>(".tag")) {
      const tag = (tagElement.dataset.tag ?? tagElement.textContent ?? "").trim().replace(/^#/u, "");
      if (memo.tags.includes(tag)) {
        tagElement.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.selectTag(tag);
        });
      }
    }
    const metadataOnlyTags = memo.tags.filter((tag) => !inlineTags.has(tag));
    if (metadataOnlyTags.length) {
      const tags = card.createDiv({ cls: "memo-flow-tags" });
      for (const tag of metadataOnlyTags) {
        const button = tags.createEl("button", { text: `#${tag}` });
        button.addEventListener("click", () => this.selectTag(tag));
      }
    }
  }

  private selectTag(tag: string): void {
    this.selectedTag = tag;
    if (this.filterTagEl) {
      this.filterTagEl.value = tag;
    }
    this.visibleCount = this.plugin.settings.pageSize;
    void this.renderFeed();
  }

  private addIconButton(
    container: HTMLElement,
    icon: string,
    label: string,
    action: () => void | Promise<void>
  ): void {
    const button = container.createEl("button", { attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.addEventListener("click", () => {
      try {
        const result = action();
        if (result instanceof Promise) {
          void result.catch((error: unknown) => {
            new Notice(error instanceof Error ? error.message : `${label}失败。`);
          });
        }
      } catch (error) {
        new Notice(error instanceof Error ? error.message : `${label}失败。`);
      }
    });
  }
}
