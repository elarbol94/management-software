"use client";

import { useEffect, useState } from "react";
import type { PresentationSource, PresentationSourcePreview } from "../lib/presentation-source";
import { sourceKey } from "../lib/presentation-source";

/** Only reference changes restart polling; canvas movement and review saves do not. */
export function usePresentationSourcePreviews(sources: (PresentationSource | null | undefined)[]) {
  const keys = JSON.stringify([...new Set(sources.filter((source) => source != null).map(sourceKey))].sort());
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ keys: string; previews: PresentationSourcePreview[]; error: boolean }>({ keys: "", previews: [], error: false });
  useEffect(() => {
    const references = (JSON.parse(keys) as string[]).map((key) => {
      const [pageId, sectionId] = JSON.parse(key) as [string, string];
      return { pageId, sectionId };
    });
    if (!references.length) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const response = await fetch("/api/wiki/presentation-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sources: references }), cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!controller.signal.aborted) setState({ keys, previews: result.previews, error: false });
      } catch {
        if (!controller.signal.aborted) setState((current) => ({ keys, previews: current.keys === keys ? current.previews : [], error: true }));
      } finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [keys, version]);
  const current = state.keys === keys;
  return {
    previews: new Map((current ? state.previews : []).map((preview) => [sourceKey(preview), preview])),
    error: current && state.error,
    loading: keys !== "[]" && (!current || (!state.previews.length && !state.error)),
    refresh: () => setVersion((value) => value + 1),
  };
}
