"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export type DocumentTool = "outline" | "comments" | "layout" | "details" | "image" | null;
export type DocumentSaveState = "idle" | "unsaved" | "saving" | "saved" | "offline" | "error" | "conflict";
const DocumentWorkspace = createContext<{
  panel: DocumentTool; setPanel: Dispatch<SetStateAction<DocumentTool>>;
  saveState: DocumentSaveState; setSaveState: Dispatch<SetStateAction<DocumentSaveState>>;
} | null>(null);

export function DocumentWorkspaceProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<DocumentTool>(null);
  const [saveState, setSaveState] = useState<DocumentSaveState>("idle");
  return <DocumentWorkspace.Provider value={{ panel, setPanel, saveState, setSaveState }}>{children}</DocumentWorkspace.Provider>;
}

export function useDocumentWorkspace() {
  const value = useContext(DocumentWorkspace);
  if (!value) throw new Error("Document tools require their workspace provider");
  return value;
}
