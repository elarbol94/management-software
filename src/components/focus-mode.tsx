"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FOCUS_MODE_STORAGE_KEYS,
  focusScopeForPathname,
  type FocusScope,
} from "@/lib/focus-mode";

type FocusModeContextValue = {
  scope: FocusScope | null;
  isFocused: boolean;
  setFocused: (focused: boolean) => void;
  toggleFocused: () => void;
};

const FocusModeContext = createContext<FocusModeContextValue | null>(null);
const SERVER_SNAPSHOT = "false:false";

function focusPreferencesSnapshot() {
  return [
    window.localStorage.getItem(FOCUS_MODE_STORAGE_KEYS.pdf) === "true",
    window.localStorage.getItem(FOCUS_MODE_STORAGE_KEYS.note) === "true",
  ].join(":");
}

function subscribeToFocusPreferences(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || Object.values(FOCUS_MODE_STORAGE_KEYS).includes(event.key)) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus-mode-change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus-mode-change", onStoreChange);
  };
}

export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const scope = focusScopeForPathname(pathname);
  const snapshot = useSyncExternalStore(subscribeToFocusPreferences, focusPreferencesSnapshot, () => SERVER_SNAPSHOT);
  const [pdfPreference, notePreference] = snapshot.split(":").map((value) => value === "true");

  const value = useMemo<FocusModeContextValue>(() => {
    const setFocused = (focused: boolean) => {
      if (!scope) return;
      window.localStorage.setItem(FOCUS_MODE_STORAGE_KEYS[scope], String(focused));
      window.dispatchEvent(new Event("focus-mode-change"));
    };

    const isFocused = scope === "pdf" ? pdfPreference : scope === "note" ? notePreference : false;
    return { scope, isFocused, setFocused, toggleFocused: () => setFocused(!isFocused) };
  }, [notePreference, pdfPreference, scope]);

  return <FocusModeContext.Provider value={value}>{children}</FocusModeContext.Provider>;
}

export function useFocusMode() {
  const value = useContext(FocusModeContext);
  if (!value) throw new Error("useFocusMode must be used inside FocusModeProvider");
  return value;
}

export function FocusModeToggle({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("wiki");
  const { scope, isFocused, toggleFocused } = useFocusMode();
  if (!scope) return null;

  const label = isFocused ? t("exitFocusMode") : t("enterFocusMode");
  const Icon = isFocused ? Minimize2 : Maximize2;
  return (
    <Button
      type="button"
      variant={isFocused ? "secondary" : "ghost"}
      size={compact ? "icon-sm" : "sm"}
      aria-label={label}
      aria-pressed={isFocused}
      title={label}
      data-testid="focus-mode-toggle"
      onClick={toggleFocused}
    >
      <Icon className="size-4" />
      {!compact && label}
    </Button>
  );
}
