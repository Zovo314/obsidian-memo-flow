import { Modal, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { MemoFlowView, MEMO_FLOW_VIEW_TYPE } from "./feed-view";
import { MemoRepository } from "./repository";
import { MemoFlowSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type MemoFlowSettings } from "./types";
import { isMemoPath } from "./utils";

class QuickCaptureModal extends Modal {
  constructor(private readonly plugin: MemoFlowPlugin) {
    super(plugin.app);
  }

  override onOpen(): void {
    this.contentEl.addClass("memo-flow-modal");
    this.contentEl.createEl("h2", { text: "快速记录" });
    const textarea = this.contentEl.createEl("textarea", {
      attr: {
        rows: "8",
        placeholder: "输入想法……支持 Markdown 和 #标签",
        "aria-label": "快速记录内容"
      }
    });
    const actions = this.contentEl.createDiv({ cls: "memo-flow-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    const save = actions.createEl("button", { text: "记录", cls: "mod-cta" });
    cancel.addEventListener("click", () => this.close());
    const submit = async (): Promise<void> => {
      save.disabled = true;
      try {
        await this.plugin.repository.create({ body: textarea.value });
        await this.plugin.refreshViews();
        new Notice("Memo 已保存。");
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "保存失败。");
        save.disabled = false;
      }
    };
    save.addEventListener("click", () => void submit());
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void submit();
      }
    });
    window.setTimeout(() => textarea.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export default class MemoFlowPlugin extends Plugin {
  override settings: MemoFlowSettings = DEFAULT_SETTINGS;
  repository!: MemoRepository;
  private refreshTimer: number | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.repository = new MemoRepository(this.app, () => this.settings.rootFolder);
    this.registerView(MEMO_FLOW_VIEW_TYPE, (leaf) => new MemoFlowView(leaf, this));
    this.addRibbonIcon("messages-square", "打开 Memo Flow", () => void this.activateView());
    this.addCommand({
      id: "open-memo-flow",
      name: "打开瀑布流",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "quick-capture",
      name: "快速记录 memo",
      callback: () => new QuickCaptureModal(this).open()
    });
    this.addCommand({
      id: "refresh-memo-index",
      name: "重建 memo 索引",
      callback: async () => {
        await this.refreshViews();
        new Notice("Memo 索引已重建。");
      }
    });
    this.addSettingTab(new MemoFlowSettingTab(this.app, this));

    const scheduleIfMemo = (path: string): void => {
      if (isMemoPath(path, this.settings.rootFolder)) {
        this.scheduleRefresh();
      }
    };
    this.registerEvent(this.app.vault.on("create", (file) => scheduleIfMemo(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => scheduleIfMemo(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => scheduleIfMemo(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (isMemoPath(file.path, this.settings.rootFolder) || isMemoPath(oldPath, this.settings.rootFolder)) {
        this.scheduleRefresh();
      }
    }));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openOnStartup) {
        void this.activateView();
      }
    });
  }

  override onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MEMO_FLOW_VIEW_TYPE)[0];
    let leaf: WorkspaceLeaf;
    if (existing) {
      leaf = existing;
    } else {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: MEMO_FLOW_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof MemoFlowView) {
      view.focusComposer();
    }
  }

  async refreshViews(): Promise<void> {
    const views = this.app.workspace
      .getLeavesOfType(MEMO_FLOW_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is MemoFlowView => view instanceof MemoFlowView);
    await Promise.all(views.map(async (view) => view.refresh()));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MemoFlowSettings>);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshViews();
    }, 250);
  }
}
