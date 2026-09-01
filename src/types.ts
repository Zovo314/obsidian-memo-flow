import type { TFile } from "obsidian";

export const MEMO_SCHEMA_VERSION = 1;

export interface MemoRecord {
  file: TFile;
  body: string;
  memoId: string;
  created: string;
  updated?: string;
  tags: string[];
  aliases: string[];
  pinned: boolean;
  archived: boolean;
  source: string;
}

export interface NewMemoInput {
  body: string;
  attachmentPaths?: string[];
}

export interface MemoFlowSettings {
  rootFolder: string;
  pageSize: number;
  openOnStartup: boolean;
  showArchivedByDefault: boolean;
}

export const DEFAULT_SETTINGS: MemoFlowSettings = {
  rootFolder: "Memos",
  pageSize: 40,
  openOnStartup: false,
  showArchivedByDefault: false
};

export interface PendingAttachment {
  name: string;
  mimeType: string;
  data: ArrayBuffer;
}

