"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { GitMerge, Pencil } from "lucide-react";
import { mergeTags, renameTag } from "../research-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function TagAdminActions({ tag, tags }: { tag: { id: string; name: string }; tags: Array<{ id: string; name: string }> }) {
  const t = useTranslations("wiki");
  const common = useTranslations("common");
  const router = useRouter();
  const others = tags.filter((item) => item.id !== tag.id);
  const [renameOpen, setRenameOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [name, setName] = useState(tag.name);
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);

  async function submitRename() {
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      await renameTag(tag.id, name.trim());
      setRenameOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function submitMerge() {
    if (!target || pending) return;
    setPending(true);
    try {
      await mergeTags(tag.id, target);
      setMergeOpen(false);
      router.push(`/wiki/tags/${target}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return <div className="flex gap-1">
    <Dialog open={renameOpen} onOpenChange={(open) => { setRenameOpen(open); if (open) setName(tag.name); }}>
      <DialogTrigger render={<Button variant="outline" size="sm"><Pencil className="size-3.5" />{t("rename")}</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("rename")}</DialogTitle></DialogHeader>
        <Input aria-label={t("tagName")} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitRename(); }} placeholder={t("tagName")} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameOpen(false)}>{common("cancel")}</Button>
          <Button disabled={!name.trim() || pending} onClick={() => void submitRename()}>{common("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={mergeOpen} onOpenChange={(open) => { setMergeOpen(open); if (open) setTarget(""); }}>
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={others.length === 0}><GitMerge className="size-3.5" />{t("mergeTag")}</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("mergeTag")}</DialogTitle><DialogDescription>{t("mergeTagDescription", { name: tag.name })}</DialogDescription></DialogHeader>
        <Select value={target} onValueChange={(value) => setTarget(value ?? "")}>
          <SelectTrigger aria-label={t("mergeTagTarget")}><SelectValue placeholder={t("mergeTagTarget")} /></SelectTrigger>
          <SelectContent>{others.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => setMergeOpen(false)}>{common("cancel")}</Button>
          <Button disabled={!target || pending} onClick={() => void submitMerge()}>{t("mergeTag")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
