export type FocusScope = "pdf" | "note";

export type FocusPreferences = Record<FocusScope, boolean>;

export const FOCUS_MODE_STORAGE_KEYS: Record<FocusScope, string> = {
  pdf: "management-platform:focus-mode:pdf",
  note: "management-platform:focus-mode:note",
};

export function focusScopeForPathname(pathname: string): FocusScope | null {
  if (/^\/wiki\/sources\/[^/]+\/read\/[^/]+\/?$/.test(pathname)) return "pdf";
  if (/^\/wiki\/pages\/[^/]+\/?$/.test(pathname)) return "note";
  return null;
}
