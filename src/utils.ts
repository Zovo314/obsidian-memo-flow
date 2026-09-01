import { normalizePath } from "obsidian";

export function joinVaultPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

export function entriesFolder(rootFolder: string): string {
  return joinVaultPath(rootFolder, "Entries");
}

export function assetsFolder(rootFolder: string): string {
  return joinVaultPath(rootFolder, "Assets");
}

export function isMemoPath(path: string, rootFolder: string): boolean {
  const prefix = `${entriesFolder(rootFolder)}/`;
  return normalizePath(path).startsWith(prefix) && path.toLowerCase().endsWith(".md");
}

export function formatLocalDateTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds())
  ].join("");
}

export function formatDisplayTime(isoLocal: string): string {
  const match = isoLocal.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/);
  return match ? `${match[1]} ${match[2]}` : isoLocal;
}

export function createdDate(isoLocal: string): string {
  return isoLocal.slice(0, 10);
}

export function createMemoId(date: Date): string {
  const stamp = formatLocalDateTime(date).replace(/[-:]/g, "");
  const random = new Uint8Array(4);
  crypto.getRandomValues(random);
  const suffix = Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("");
  return `memo-${stamp}-${suffix}`;
}

export function extractInlineTags(body: string): string[] {
  const tags = new Set<string>();
  const pattern = /(^|\s)#([^\s#.,，。；;：:！？!?()[\]{}<>]+)/gu;
  for (const match of body.matchAll(pattern)) {
    const tag = match[2]?.trim().replace(/^\/+|\/+$/g, "");
    if (tag && !/^\d+$/.test(tag)) {
      tags.add(tag);
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

export function firstMeaningfulLine(body: string): string {
  const line = body
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find(Boolean) ?? "未命名 memo";
  return line
    .replace(/^[-*+>]\s+/u, "")
    .replace(/[*_~=`#]/gu, "")
    .trim()
    .slice(0, 60) || "未命名 memo";
}

export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: "", body: content };
  }
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u);
  if (!match) {
    return { frontmatter: "", body: content };
  }
  return {
    frontmatter: match[0],
    body: content.slice(match[0].length).replace(/^\r?\n/u, "")
  };
}

export function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function extensionForMime(name: string, mimeType: string): string {
  const named = name.match(/\.([a-zA-Z0-9]{1,8})$/u)?.[1]?.toLowerCase();
  if (named) {
    return named === "jpeg" ? "jpg" : named;
  }
  const byMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic"
  };
  return byMime[mimeType] ?? "bin";
}

