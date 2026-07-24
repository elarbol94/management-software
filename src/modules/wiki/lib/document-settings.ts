import type { TiptapNode } from "./tiptap";

export const DOCUMENT_SETTINGS_VERSION = 1 as const;

export type DocumentPageSize = "A4" | "Letter";
export type DocumentOrientation = "portrait" | "landscape";
export type DocumentThemeId = "formal" | "report" | "concept" | "custom";

export type DocumentConstraint = {
  id: string;
  headingId: string;
  label: string;
  required: boolean;
  metric: "words" | "characters";
  min?: number;
  max?: number;
};

export type DocumentSettingsV1 = {
  version: typeof DOCUMENT_SETTINGS_VERSION;
  page: {
    size: DocumentPageSize;
    orientation: DocumentOrientation;
    marginsMm: { top: number; right: number; bottom: number; left: number };
  };
  theme: {
    id: DocumentThemeId;
    bodyFont: "system" | "serif" | "humanist";
    headingFont: "system" | "serif" | "humanist";
    bodySizePt: number;
    lineHeight: number;
    textColor: string;
    accentColor: string;
    mutedColor: string;
  };
  cover: {
    enabled: boolean;
    eyebrow: string;
    subtitle: string;
  };
  header: {
    enabled: boolean;
    left: string;
    center: string;
    right: string;
  };
  footer: {
    enabled: boolean;
    left: string;
    center: string;
    right: string;
    pageNumbers: boolean;
  };
  bibliography: {
    enabled: boolean;
    heading: string;
    pageBreakBefore: boolean;
  };
  variables: Record<string, string>;
  constraints: DocumentConstraint[];
  metadata: {
    author: string;
    subject: string;
    keywords: string;
  };
};

export type DocumentTemplateDefinition = {
  id: string;
  name: string;
  description: string;
  settings: DocumentSettingsV1;
  content: TiptapNode | null;
  builtIn: boolean;
};

export type DocumentPreflightIssue = {
  id: string;
  severity: "error" | "warning";
  code:
    | "unresolved-variable"
    | "missing-section"
    | "section-too-short"
    | "section-too-long"
    | "external-image"
    | "missing-image-alt"
    | "wide-table";
  message: string;
  nodeId?: string;
};

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettingsV1 = {
  version: DOCUMENT_SETTINGS_VERSION,
  page: {
    size: "A4",
    orientation: "portrait",
    marginsMm: { top: 22, right: 20, bottom: 22, left: 24 },
  },
  theme: {
    id: "formal",
    bodyFont: "humanist",
    headingFont: "serif",
    bodySizePt: 10.5,
    lineHeight: 1.55,
    textColor: "#172033",
    accentColor: "#315EFB",
    mutedColor: "#667085",
  },
  cover: { enabled: true, eyebrow: "DOCUMENT", subtitle: "" },
  header: { enabled: true, left: "{title}", center: "", right: "{programme}" },
  footer: { enabled: true, left: "{applicant}", center: "", right: "", pageNumbers: true },
  bibliography: { enabled: true, heading: "References", pageBreakBefore: true },
  variables: {
    applicant: "",
    programme: "",
    projectTitle: "",
    date: "",
    fundingPeriod: "",
  },
  constraints: [],
  metadata: { author: "", subject: "", keywords: "" },
};

function cloneSettings(settings: DocumentSettingsV1): DocumentSettingsV1 {
  return JSON.parse(JSON.stringify(settings)) as DocumentSettingsV1;
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function safeColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.slice(0, 500) : fallback;
}

export function normalizeDocumentSettings(value: unknown): DocumentSettingsV1 {
  const fallback = cloneSettings(DEFAULT_DOCUMENT_SETTINGS);
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<DocumentSettingsV1>;
  const page = input.page ?? fallback.page;
  const theme = input.theme ?? fallback.theme;
  const cover = input.cover ?? fallback.cover;
  const header = input.header ?? fallback.header;
  const footer = input.footer ?? fallback.footer;
  const bibliography = input.bibliography ?? fallback.bibliography;
  const metadata = input.metadata ?? fallback.metadata;
  const variables = input.variables && typeof input.variables === "object"
    ? Object.fromEntries(
        Object.entries(input.variables)
          .filter(([key, entry]) => /^[A-Za-z][\w-]{0,49}$/.test(key) && typeof entry === "string")
          .map(([key, entry]) => [key, entry.slice(0, 2_000)]),
      )
    : fallback.variables;
  const constraints = Array.isArray(input.constraints)
    ? input.constraints.flatMap((constraint) => {
        if (!constraint || typeof constraint !== "object") return [];
        const item = constraint as Partial<DocumentConstraint>;
        if (!item.id || !item.headingId || !item.label || !["words", "characters"].includes(item.metric ?? "")) return [];
        return [{
          id: String(item.id).slice(0, 80),
          headingId: String(item.headingId).slice(0, 120),
          label: String(item.label).slice(0, 160),
          required: item.required === true,
          metric: item.metric as DocumentConstraint["metric"],
          ...(typeof item.min === "number" ? { min: Math.max(0, Math.floor(item.min)) } : {}),
          ...(typeof item.max === "number" ? { max: Math.max(0, Math.floor(item.max)) } : {}),
        }];
      })
    : [];

  return {
    version: DOCUMENT_SETTINGS_VERSION,
    page: {
      size: page.size === "Letter" ? "Letter" : "A4",
      orientation: page.orientation === "landscape" ? "landscape" : "portrait",
      marginsMm: {
        top: finiteNumber(page.marginsMm?.top, fallback.page.marginsMm.top, 8, 50),
        right: finiteNumber(page.marginsMm?.right, fallback.page.marginsMm.right, 8, 50),
        bottom: finiteNumber(page.marginsMm?.bottom, fallback.page.marginsMm.bottom, 8, 50),
        left: finiteNumber(page.marginsMm?.left, fallback.page.marginsMm.left, 8, 50),
      },
    },
    theme: {
      id: ["formal", "report", "concept", "custom"].includes(theme.id) ? theme.id : fallback.theme.id,
      bodyFont: ["system", "serif", "humanist"].includes(theme.bodyFont) ? theme.bodyFont : fallback.theme.bodyFont,
      headingFont: ["system", "serif", "humanist"].includes(theme.headingFont) ? theme.headingFont : fallback.theme.headingFont,
      bodySizePt: finiteNumber(theme.bodySizePt, fallback.theme.bodySizePt, 8, 16),
      lineHeight: finiteNumber(theme.lineHeight, fallback.theme.lineHeight, 1.1, 2),
      textColor: safeColor(theme.textColor, fallback.theme.textColor),
      accentColor: safeColor(theme.accentColor, fallback.theme.accentColor),
      mutedColor: safeColor(theme.mutedColor, fallback.theme.mutedColor),
    },
    cover: {
      enabled: cover.enabled !== false,
      eyebrow: safeText(cover.eyebrow, fallback.cover.eyebrow),
      subtitle: safeText(cover.subtitle),
    },
    header: {
      enabled: header.enabled !== false,
      left: safeText(header.left, fallback.header.left),
      center: safeText(header.center),
      right: safeText(header.right, fallback.header.right),
    },
    footer: {
      enabled: footer.enabled !== false,
      left: safeText(footer.left, fallback.footer.left),
      center: safeText(footer.center),
      right: safeText(footer.right),
      pageNumbers: footer.pageNumbers !== false,
    },
    bibliography: {
      enabled: bibliography.enabled !== false,
      heading: safeText(bibliography.heading, fallback.bibliography.heading),
      pageBreakBefore: bibliography.pageBreakBefore !== false,
    },
    variables: { ...fallback.variables, ...variables },
    constraints,
    metadata: {
      author: safeText(metadata.author),
      subject: safeText(metadata.subject),
      keywords: safeText(metadata.keywords),
    },
  };
}

export function parseDocumentSettings(value: string | null | undefined): DocumentSettingsV1 {
  if (!value?.trim()) return normalizeDocumentSettings(null);
  try {
    return normalizeDocumentSettings(JSON.parse(value));
  } catch {
    return normalizeDocumentSettings(null);
  }
}

export function serializeDocumentSettings(settings: DocumentSettingsV1) {
  return JSON.stringify(normalizeDocumentSettings(settings));
}

function withTheme(
  id: DocumentThemeId,
  patch: Partial<DocumentSettingsV1["theme"]>,
  other: {
    cover?: Partial<DocumentSettingsV1["cover"]>;
    header?: Partial<DocumentSettingsV1["header"]>;
    footer?: Partial<DocumentSettingsV1["footer"]>;
  } = {},
) {
  const settings = cloneSettings(DEFAULT_DOCUMENT_SETTINGS);
  settings.theme = { ...settings.theme, id, ...patch };
  if (other.cover) settings.cover = { ...settings.cover, ...other.cover };
  if (other.header) settings.header = { ...settings.header, ...other.header };
  if (other.footer) settings.footer = { ...settings.footer, ...other.footer };
  return settings;
}

export const BUILT_IN_DOCUMENT_TEMPLATES: DocumentTemplateDefinition[] = [
  {
    id: "formal-application",
    name: "Formal application",
    description: "Serif headings, restrained blue accents and generous A4 margins.",
    settings: withTheme("formal", {}),
    content: null,
    builtIn: true,
  },
  {
    id: "project-report",
    name: "Project report",
    description: "Compact humanist typography for evidence-rich reports.",
    settings: withTheme("report", {
      bodyFont: "humanist",
      headingFont: "humanist",
      bodySizePt: 10,
      lineHeight: 1.45,
      accentColor: "#0F766E",
    }, { cover: { eyebrow: "PROJECT REPORT" } }),
    content: null,
    builtIn: true,
  },
  {
    id: "flexible-concept",
    name: "Flexible concept",
    description: "Open spacing and a strong editorial hierarchy for concept documents.",
    settings: withTheme("concept", {
      bodyFont: "serif",
      headingFont: "system",
      bodySizePt: 11,
      lineHeight: 1.6,
      accentColor: "#7C3AED",
    }, { cover: { eyebrow: "CONCEPT" }, header: { right: "{date}" } }),
    content: null,
    builtIn: true,
  },
];

function nodeText(node: TiptapNode): string {
  if (node.text) return node.text;
  if (node.type === "documentVariable") return "";
  if (node.type === "citation" && typeof node.attrs?.label === "string") return node.attrs.label;
  return (node.content ?? []).map(nodeText).join("");
}

export function collectDocumentPreflightIssues(
  doc: TiptapNode | null | undefined,
  settings: DocumentSettingsV1,
): DocumentPreflightIssue[] {
  if (!doc) return [];
  const issues: DocumentPreflightIssue[] = [];
  const headingSections = new Map<string, string>();
  let activeHeadingId = "";

  function walk(node: TiptapNode) {
    if (node.type === "heading") {
      activeHeadingId = typeof node.attrs?.id === "string" ? node.attrs.id : "";
      if (activeHeadingId) headingSections.set(activeHeadingId, "");
    } else if (activeHeadingId) {
      headingSections.set(activeHeadingId, `${headingSections.get(activeHeadingId) ?? ""} ${nodeText(node)}`.trim());
    }

    if (node.type === "documentVariable") {
      const key = String(node.attrs?.key ?? "");
      const value = settings.variables[key]?.trim();
      if (!value) {
        issues.push({
          id: `variable:${key || "unknown"}`,
          severity: "error",
          code: "unresolved-variable",
          message: key ? `Variable "${key}" has no value.` : "A document variable has no key.",
        });
      }
    }

    if (node.type === "commentableImage") {
      const src = String(node.attrs?.src ?? "");
      if (!node.attrs?.attachmentId && /^https?:\/\//i.test(src)) {
        issues.push({
          id: `external-image:${String(node.attrs?.nodeId ?? src)}`,
          severity: "error",
          code: "external-image",
          message: "External images must be imported before PDF export.",
          nodeId: String(node.attrs?.nodeId ?? ""),
        });
      }
      if (!String(node.attrs?.alt ?? "").trim()) {
        issues.push({
          id: `image-alt:${String(node.attrs?.nodeId ?? src)}`,
          severity: "warning",
          code: "missing-image-alt",
          message: "An image has no alternative text.",
          nodeId: String(node.attrs?.nodeId ?? ""),
        });
      }
    }

    if (node.type === "markdownTable") {
      const columns = node.content?.[0]?.content?.length ?? 0;
      if (columns > 6 && settings.page.orientation === "portrait") {
        issues.push({
          id: `wide-table:${issues.length}`,
          severity: "warning",
          code: "wide-table",
          message: "A table with more than six columns may overflow a portrait page.",
        });
      }
    }

    for (const child of node.content ?? []) walk(child);
  }
  walk(doc);

  for (const constraint of settings.constraints) {
    const section = headingSections.get(constraint.headingId);
    if (section === undefined) {
      if (constraint.required) {
        issues.push({
          id: `constraint:${constraint.id}:missing`,
          severity: "error",
          code: "missing-section",
          message: `Required section "${constraint.label}" is missing.`,
        });
      }
      continue;
    }
    const count = constraint.metric === "words"
      ? section.trim().split(/\s+/).filter(Boolean).length
      : section.length;
    if (constraint.min !== undefined && count < constraint.min) {
      issues.push({
        id: `constraint:${constraint.id}:min`,
        severity: "warning",
        code: "section-too-short",
        message: `"${constraint.label}" has ${count} ${constraint.metric}; minimum is ${constraint.min}.`,
      });
    }
    if (constraint.max !== undefined && count > constraint.max) {
      issues.push({
        id: `constraint:${constraint.id}:max`,
        severity: "error",
        code: "section-too-long",
        message: `"${constraint.label}" has ${count} ${constraint.metric}; maximum is ${constraint.max}.`,
      });
    }
  }

  return issues;
}

export function resolveDocumentToken(
  template: string,
  settings: DocumentSettingsV1,
  context: { title: string; pageNumber?: string; totalPages?: string },
) {
  const values: Record<string, string> = {
    ...settings.variables,
    title: context.title,
    author: settings.metadata.author,
    date: settings.variables.date || new Intl.DateTimeFormat("en-CA").format(new Date()),
    page: context.pageNumber ?? "",
    pages: context.totalPages ?? "",
  };
  return template.replace(/\{([A-Za-z][\w-]*)\}/g, (_, key: string) => values[key] ?? "");
}
