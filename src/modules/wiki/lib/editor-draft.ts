import { parseEditorDocument } from "./editor-document";

/** Storage can be unavailable or full; this must never stop a server save. */
export function readEditorStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function writeEditorStorage(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}

export function removeEditorStorage(key: string): void {
  try { window.localStorage.removeItem(key); } catch { /* storage is unavailable */ }
}

export type EditorSnapshot = {
  contentJson: string;
  documentMode: boolean;
  documentSettingsJson: string;
};

export type EditorDraft = EditorSnapshot & {
  baseContentVersion: number;
  editorSessionId?: string;
};

export function sameEditorSnapshot(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return a.contentJson === b.contentJson && a.documentMode === b.documentMode
    && a.documentSettingsJson === b.documentSettingsJson;
}

export function parseEditorDraft(value: string | null, server: EditorSnapshot): EditorDraft | null {
  if (!value) return null;
  try {
    const draft = JSON.parse(value);
    if (!draft || typeof draft !== "object" || typeof draft.contentJson !== "string") return null;
    parseEditorDocument(draft.contentJson);
    const snapshot = {
      contentJson: draft.contentJson,
      documentMode: typeof draft.documentMode === "boolean" ? draft.documentMode : server.documentMode,
      documentSettingsJson: typeof draft.documentSettingsJson === "string" ? draft.documentSettingsJson : server.documentSettingsJson,
    };
    if (sameEditorSnapshot(snapshot, server)) return null;
    return {
      ...snapshot,
      // Legacy drafts without a version must conflict with newer documents.
      baseContentVersion: Number.isSafeInteger(draft.baseContentVersion) && draft.baseContentVersion > 0 ? draft.baseContentVersion : 1,
      ...(typeof draft.editorSessionId === "string" ? { editorSessionId: draft.editorSessionId } : {}),
    };
  } catch { return null; }
}
