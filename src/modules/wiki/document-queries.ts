import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { wikiDocumentTemplates } from "@/db/schema";
import {
  BUILT_IN_DOCUMENT_TEMPLATES,
  normalizeDocumentSettings,
  type DocumentTemplateDefinition,
} from "./lib/document-settings";
import { parseStoredDocument } from "./lib/tiptap";

export type StoredDocumentTemplate = DocumentTemplateDefinition & {
  description: string;
  createdAt?: number;
};

export function listDocumentTemplates(userId: string): StoredDocumentTemplate[] {
  const custom = db
    .select()
    .from(wikiDocumentTemplates)
    .where(eq(wikiDocumentTemplates.createdBy, userId))
    .orderBy(asc(wikiDocumentTemplates.name))
    .all()
    .map((template): StoredDocumentTemplate => {
      let settings: unknown = null;
      let constraints: unknown = null;
      try { settings = JSON.parse(template.settingsJson); } catch { /* use defaults */ }
      try { constraints = JSON.parse(template.constraintsJson); } catch { /* use defaults */ }
      const normalized = normalizeDocumentSettings({
        ...(settings && typeof settings === "object" ? settings : {}),
        constraints: Array.isArray(constraints) ? constraints : undefined,
      });
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        settings: normalized,
        content: template.contentJson ? parseStoredDocument(template.contentJson) : null,
        builtIn: false,
        createdAt: template.createdAt.getTime(),
      };
    });
  return [
    ...BUILT_IN_DOCUMENT_TEMPLATES.map((template) => ({
      ...template,
      settings: normalizeDocumentSettings(template.settings),
    })),
    ...custom,
  ];
}

