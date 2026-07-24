"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
const SourceForm = dynamic(() =>
  import("./source-form").then((module) => module.SourceForm),
);
export function MetadataLookupDialog({ documentTypes = [] }: { documentTypes?: string[] }) { const t=useTranslations("wiki"); const [open,setOpen]=useState(false); const [kind,setKind]=useState("doi"); const [value,setValue]=useState(""); const [result,setResult]=useState<Record<string,unknown>|null>(null); const [error,setError]=useState(""); const [pending,setPending]=useState(false); async function lookup(){setPending(true);setError("");const response=await fetch("/api/wiki/metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,value})});const body=await response.json();if(response.ok)setResult(body);else setError(body.error);setPending(false);} return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button variant="outline"><Search className="size-4" />{t("lookupMetadata")}</Button>} /><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{t("lookupMetadata")}</DialogTitle></DialogHeader><div className="flex gap-2"><Select value={kind} onValueChange={(nextKind) => setKind(nextKind ?? "doi")}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="doi">DOI</SelectItem><SelectItem value="isbn">ISBN</SelectItem><SelectItem value="url">URL</SelectItem></SelectContent></Select><Input value={value} onChange={(event)=>setValue(event.target.value)} placeholder={kind.toUpperCase()} onKeyDown={(event)=>{if(event.key==="Enter")void lookup();}}/><Button disabled={!value.trim()||pending} onClick={lookup}>{t("lookup")}</Button></div>{error&&<p className="rounded border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}{result&&<><p className="text-sm text-muted-foreground">{t("reviewMetadata")}</p><SourceForm documentTypes={documentTypes} key={JSON.stringify(result)} initial={result as never} onSaved={()=>setOpen(false)} /></>}</DialogContent></Dialog>; }
