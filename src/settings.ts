import { App, PluginSettingTab, Setting } from "obsidian";
import type MemoFlowPlugin from "./main";

export class MemoFlowSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MemoFlowPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Memo Flow 设置" });

    new Setting(containerEl)
      .setName("数据根目录")
      .setDesc("所有 memo、附件和导入清单都位于这个 Vault 相对路径下。")
      .addText((text) => text
        .setPlaceholder("Memos")
        .setValue(this.plugin.settings.rootFolder)
        .onChange(async (value) => {
          const normalized = value.trim().replace(/^\/+|\/+$/g, "") || "Memos";
          this.plugin.settings.rootFolder = normalized;
          await this.plugin.saveSettings();
          await this.plugin.refreshViews();
        }));

    new Setting(containerEl)
      .setName("每次加载数量")
      .setDesc("瀑布流首次显示以及继续加载时的 memo 数量。")
      .addText((text) => text
        .setValue(String(this.plugin.settings.pageSize))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.pageSize = Number.isFinite(parsed)
            ? Math.min(200, Math.max(10, parsed))
            : 40;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("启动时打开")
      .setDesc("Obsidian 布局准备完成后自动打开 Memo Flow。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.openOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.openOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("默认显示归档")
      .setDesc("打开瀑布流时同时显示已归档 memo。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showArchivedByDefault)
        .onChange(async (value) => {
          this.plugin.settings.showArchivedByDefault = value;
          await this.plugin.saveSettings();
        }));
  }
}

