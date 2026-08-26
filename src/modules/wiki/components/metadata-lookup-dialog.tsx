"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SourceForm = dynamic(() =>
  import("./source-form").then((module) => module.SourceForm),
);

function localDate() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function MetadataLookupDialog({
  documentTypes = [],
}: {
  documentTypes?: string[];
}) {
  const t = useTranslations("wiki");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("doi");
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const requestId = useRef(0);

  async function lookup() {
    const request = ++requestId.current;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/wiki/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value, accessedAt: localDate() }),
      });
      const body = await response
        .json()
        .catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Lookup failed",
        );
      }
      if (requestId.current === request) setResult(body);
    } catch (reason) {
      if (requestId.current === request) {
        setError(
          reason instanceof Error
            ? reason.message
            : locale === "en"
              ? "Metadata could not be loaded."
              : "Metadaten konnten nicht geladen werden.",
        );
      }
    } finally {
      if (requestId.current === request) setPending(false);
    }
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      requestId.current += 1;
      setValue("");
      setResult(null);
      setError("");
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Search className="size-4" />
            {t("lookupMetadata")}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("lookupMetadata")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!value.trim() || pending) return;
            // A reviewed form is remounted by the new result, so ask before discarding edits.
            if (result && !window.confirm(t("replaceLookupConfirm"))) return;
            void lookup();
          }}
        >
          <Select
            value={kind}
            onValueChange={(nextKind) => setKind(nextKind ?? "doi")}
          >
            <SelectTrigger className="w-28" aria-label={t("lookupMetadata")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="doi">DOI</SelectItem>
              <SelectItem value="isbn">ISBN</SelectItem>
              <SelectItem value="url">URL</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={kind.toUpperCase()}
            aria-label={kind.toUpperCase()}
          />
          <Button type="submit" disabled={!value.trim() || pending}>
            {t("lookup")}
          </Button>
        </form>
        {error && (
          <p
            role="alert"
            className="rounded border border-destructive/30 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {result && (
          <>
            <p className="text-sm text-muted-foreground">
              {t("reviewMetadata")}
            </p>
            <SourceForm
              documentTypes={documentTypes}
              key={JSON.stringify(result)}
              initial={result as never}
              onSaved={() => changeOpen(false)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
