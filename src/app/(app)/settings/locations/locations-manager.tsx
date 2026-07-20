"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, MapPin, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { setBusinessLocationActive, upsertBusinessLocation } from "@/modules/settings/actions";
import type { businessLocations as businessLocationsTable } from "@/modules/accounting/schema";
import { payrollStates } from "@/modules/accounting/lib/payroll-at-2026";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Location = typeof businessLocationsTable.$inferSelect;

export function LocationsManager({ locations }: { locations: Location[] }) {
  const t = useTranslations("settings.locations");
  const tc = useTranslations("common");
  const router = useRouter();
  const [editing, setEditing] = useState<Location | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [state, setState] = useState<(typeof payrollStates)[number] | "">("");
  const [municipality, setMunicipality] = useState("");
  const [pending, setPending] = useState(false);

  function edit(location: Location | null) {
    setEditing(location);
    setName(location?.name ?? "");
    setState((location?.state ?? "") as (typeof payrollStates)[number] | "");
    setMunicipality(location?.municipality ?? "");
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!state) return;
    setPending(true);
    try {
      await upsertBusinessLocation({ id: editing?.id, name, state, municipality, active: editing?.active ?? true });
      toast.success(tc("saved"));
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(tc("error"));
    } finally {
      setPending(false);
    }
  }

  return <div className="flex flex-col gap-4">
    <Button size="sm" className="self-start" onClick={() => edit(null)}><Plus className="size-4" />{t("add")}</Button>
    <div className="divide-y rounded-lg border">
      {locations.map((location) => <div key={location.id} className="flex items-center gap-3 px-3 py-3">
        <span className="grid size-8 place-items-center rounded-lg bg-emerald-50 text-emerald-800"><MapPin className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className={location.active ? "text-sm font-medium" : "text-sm text-muted-foreground line-through"}>{location.name}</p><p className="text-xs text-muted-foreground">{location.municipality} · {location.state}</p></div>
        {location.name === "Graz / Steiermark" && <Badge variant="secondary">{t("default")}</Badge>}
        {!location.active && <Badge variant="outline">{t("inactive")}</Badge>}
        <Button type="button" variant="ghost" size="icon-xs" onClick={() => edit(location)} aria-label={t("edit")}><Pencil className="size-3.5" /></Button>
        <Button type="button" variant="ghost" size="icon-xs" onClick={async () => { await setBusinessLocationActive(location.id, !location.active); router.refresh(); }} aria-label={location.active ? t("archive") : t("restore")}>{location.active ? <Archive className="size-3.5" /> : <ArchiveRestore className="size-3.5" />}</Button>
      </div>)}
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{editing ? t("edit") : t("add")}</DialogTitle></DialogHeader><form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2"><Label htmlFor="location-name">{t("name")}</Label><Input id="location-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
      <div className="grid gap-2"><Label htmlFor="location-state">{t("state")}</Label><Select value={state} onValueChange={(value) => setState((value ?? "") as (typeof payrollStates)[number] | "")}><SelectTrigger id="location-state"><SelectValue /></SelectTrigger><SelectContent>{payrollStates.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-2"><Label htmlFor="location-municipality">{t("municipality")}</Label><Input id="location-municipality" value={municipality} onChange={(event) => setMunicipality(event.target.value)} required /></div>
      <Button type="submit" disabled={pending}>{tc("save")}</Button>
    </form></DialogContent></Dialog>
  </div>;
}
