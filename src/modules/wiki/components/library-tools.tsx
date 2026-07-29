"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { importSourceRecords } from "../research-actions";

export function LibraryTools() {
  const t = useTranslations("wiki");
  const locale = useLocale();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<unknown[]>([]);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  function fallbackMessage() {
    return locale === "en"
      ? "The library file could not be read."
      : "Die Bibliotheksdatei konnte nicht gelesen werden.";
  }

  async function preview(file: File) {
    setPending(true);
    setMessage("");
    setRecords([]);
    const data = new FormData();
    data.set("file", file);
    try {
      const response = await fetch("/api/wiki/import", {
        method: "POST",
        body: data,
      });
      const body = await response
        .json()
        .catch(() => ({})) as { records?: unknown[]; error?: string };
      if (!response.ok || !Array.isArray(body.records)) {
        throw new Error(body.error || fallbackMessage());
      }
      setRecords(body.records);
      setName(file.name);
      setOpen(true);
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : fallbackMessage(),
      );
    } finally {
      setPending(false);
    }
  }

  async function importRecords() {
    setPending(true);
    setMessage("");
    try {
      const result = await importSourceRecords(records);
      setMessage(t("importComplete", result));
      setRecords([]);
      router.refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : fallbackMessage(),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <input
        hidden
        ref={fileInput}
        type="file"
        accept=".bib,.bibtex,.ris"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void preview(file);
          event.target.value = "";
        }}
      />
      <Button
        variant="outline"
        onClick={() => fileInput.current?.click()}
        disabled={pending}
      >
        <FileUp className="size-4" />
        {t("importLibrary")}
      </Button>
      <Button
        variant="outline"
        nativeButton={false}
        render={<a href="/api/wiki/export?format=bibtex" />}
      >
        <Download className="size-4" />
        BibTeX
      </Button>
      <Button
        variant="outline"
        nativeButton={false}
        render={<a href="/api/wiki/export?format=ris" />}
      >
        <Download className="size-4" />
        RIS
      </Button>
      {message && !open && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {message}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setRecords([]);
            setMessage("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reviewImport")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {t("importPreview", { name, count: records.length })}
          </p>
          {message && (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          )}
          <div className="max-h-64 divide-y overflow-y-auto rounded border">
            {records.slice(0, 100).map((record, index) => (
              <p key={index} className="p-2 text-sm">
                {(record as { title?: string }).title}
              </p>
            ))}
          </div>
          <Button
            disabled={!records.length || pending}
            onClick={() => void importRecords()}
          >
            {t("importConfirmed")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
