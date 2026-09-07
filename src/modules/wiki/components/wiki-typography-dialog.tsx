"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { BookmarkPlus, Check, RotateCcw, Settings2, SlidersHorizontal, Trash2, Type } from "lucide-react";
import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  deleteMyWikiTypographyTemplate,
  saveMyWikiTypographyTemplate,
  updateMyWikiTypography,
} from "../wiki-preference-actions";
import {
  DEFAULT_WIKI_TYPOGRAPHY,
  applyWikiTypographyDensity,
  normalizeWikiTypography,
  wikiTypographyCssVariables,
  type WikiFontFamily,
  type WikiTypographyDensity,
  type WikiTypographySettingsV1,
  type WikiTypographyTemplate,
} from "../lib/wiki-typography";

export type WikiEditorPreferences = {
  statusVisible: boolean;
  minimalToolbar: boolean;
  typewriterMode: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  typography: WikiTypographySettingsV1;
  templates: WikiTypographyTemplate[];
  isPrimaryAuthor: boolean;
  editorPreferences: WikiEditorPreferences;
  onApplied: (typography: WikiTypographySettingsV1, preferences: WikiEditorPreferences) => void;
  onTemplatesChange: (templates: WikiTypographyTemplate[]) => void;
};

type NumericTypographyKey = {
  [Key in keyof WikiTypographySettingsV1]: WikiTypographySettingsV1[Key] extends number ? Key : never;
}[keyof WikiTypographySettingsV1];

type NumberControlProps = {
  field: NumericTypographyKey;
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  resetLabel: string;
};

function NumberControl({
  field,
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  unit,
  onChange,
  resetLabel,
}: NumberControlProps) {
  const id = `wiki-typography-${field}`;
  function update(raw: string) {
    const next = Number(raw);
    if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
  }
  return (
    <div className="grid gap-2 rounded-lg border bg-background/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-xs font-medium">{label}</Label>
        <div className="flex items-center gap-1">
          <Input
            aria-label={`${label} (${unit ?? ""})`}
            className="h-7 w-[4.75rem] px-2 text-right tabular-nums"
            data-testid={`${field}-number`}
            max={max}
            min={min}
            onChange={(event) => update(event.target.value)}
            step={step}
            type="number"
            value={value}
          />
          {unit ? <span className="w-6 text-[11px] text-muted-foreground">{unit}</span> : null}
          <Button
            aria-label={`${resetLabel}: ${label}`}
            className="size-7"
            onClick={() => onChange(defaultValue)}
            size="icon-sm"
            title={`${resetLabel}: ${label}`}
            type="button"
            variant="ghost"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>
      <input
        aria-label={label}
        className="wiki-typography-slider"
        data-testid={`${field}-slider`}
        id={id}
        max={max}
        min={min}
        onChange={(event) => update(event.target.value)}
        step={step}
        type="range"
        value={value}
      />
    </div>
  );
}

function PreferenceToggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background/70 p-3 transition-colors hover:bg-muted/40">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </Label>
  );
}

export function WikiTypographyDialog({
  open,
  onOpenChange,
  typography,
  templates: initialTemplates,
  isPrimaryAuthor,
  editorPreferences,
  onApplied,
  onTemplatesChange,
}: Props) {
  const t = useTranslations("wiki.editor.preferences");
  const [draft, setDraft] = useState(() => normalizeWikiTypography(typography));
  const [templates, setTemplates] = useState(initialTemplates);
  const [templateName, setTemplateName] = useState("");
  const [draftPreferences, setDraftPreferences] = useState(editorPreferences);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function patch<Key extends keyof WikiTypographySettingsV1>(key: Key, value: WikiTypographySettingsV1[Key]) {
    setDraft((current) => normalizeWikiTypography({ ...current, [key]: value, density: "custom" }));
  }

  function applyPreset(density: Exclude<WikiTypographyDensity, "custom">) {
    setDraft((current) => applyWikiTypographyDensity(current, density));
  }

  function save() {
    setError("");
    startTransition(async () => {
      try {
        const saved = await updateMyWikiTypography(draft);
        onApplied(saved, draftPreferences);
        onOpenChange(false);
      } catch {
        setError(t("saveFailed"));
      }
    });
  }

  function saveTemplate() {
    const name = templateName.trim();
    if (!name) return;
    setError("");
    startTransition(async () => {
      try {
        const template = await saveMyWikiTypographyTemplate({ name, typography: draft });
        const next = [...templates, template];
        setTemplates(next);
        onTemplatesChange(next);
        setTemplateName("");
      } catch {
        setError(t("templates.saveFailed"));
      }
    });
  }

  function removeTemplate(templateId: string) {
    setError("");
    startTransition(async () => {
      try {
        const deleted = await deleteMyWikiTypographyTemplate(templateId);
        if (!deleted) return;
        const next = templates.filter((template) => template.id !== templateId);
        setTemplates(next);
        onTemplatesChange(next);
      } catch {
        setError(t("templates.deleteFailed"));
      }
    });
  }

  const previewStyle = wikiTypographyCssVariables(draft) as CSSProperties;
  const numberControls: Array<Omit<NumberControlProps, "onChange" | "resetLabel" | "value" | "defaultValue">> = [
    { field: "bodySizePt", label: t("controls.bodySize"), min: 8, max: 16, step: 0.5, unit: "pt" },
    { field: "lineHeight", label: t("controls.lineHeight"), min: 1.1, max: 2, step: 0.05 },
    { field: "paragraphSpacingEm", label: t("controls.paragraphSpacing"), min: 0, max: 2, step: 0.05, unit: "em" },
    { field: "listItemSpacingEm", label: t("controls.listItemSpacing"), min: 0, max: 1.25, step: 0.05, unit: "em" },
    { field: "listBlockSpacingEm", label: t("controls.listBlockSpacing"), min: 0, max: 2, step: 0.05, unit: "em" },
    { field: "listIndentEm", label: t("controls.listIndent"), min: 1, max: 4, step: 0.05, unit: "em" },
  ];
  const headingControls: Array<Omit<NumberControlProps, "onChange" | "resetLabel" | "value" | "defaultValue">> = [
    { field: "h1SizeEm", label: t("controls.h1Size"), min: 1.5, max: 3.5, step: 0.05, unit: "em" },
    { field: "h2SizeEm", label: t("controls.h2Size"), min: 1.2, max: 2.75, step: 0.05, unit: "em" },
    { field: "h3SizeEm", label: t("controls.h3Size"), min: 1, max: 2, step: 0.05, unit: "em" },
    { field: "headingLineHeight", label: t("controls.headingLineHeight"), min: 1, max: 1.6, step: 0.05 },
    { field: "headingSpacingBeforeEm", label: t("controls.headingBefore"), min: 0, max: 3, step: 0.05, unit: "em" },
    { field: "headingSpacingAfterEm", label: t("controls.headingAfter"), min: 0, max: 2, step: 0.05, unit: "em" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-0 overflow-hidden p-0 sm:max-w-6xl"
        data-testid="wiki-typography-dialog"
        showCloseButton={!pending}
      >
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Type className="size-5 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(isPrimaryAuthor ? "scope.primaryAuthor" : "scope.otherPage")}</p>
        </DialogHeader>

        <Tabs defaultValue="typography" className="min-h-0 gap-0 overflow-hidden">
          <TabsList className="mx-5 mt-3">
            <TabsTrigger value="typography"><SlidersHorizontal />{t("tabs.typography")}</TabsTrigger>
            <TabsTrigger value="editor"><Settings2 />{t("tabs.editor")}</TabsTrigger>
          </TabsList>

          <TabsContent value="typography" className="min-h-0 overflow-y-auto">
            <div className="grid items-start gap-5 px-5 py-4 lg:grid-cols-[minmax(24rem,1fr)_minmax(22rem,0.9fr)]">
              <div className="grid gap-5">
                <section className="grid gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{t("density.title")}</h3>
                    <p className="text-xs leading-5 text-muted-foreground">{t("density.description")}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(["compact", "standard", "spacious"] as const).map((density) => (
                      <Button
                        aria-pressed={draft.density === density}
                        className="justify-between"
                        key={density}
                        onClick={() => applyPreset(density)}
                        size="sm"
                        type="button"
                        variant={draft.density === density ? "secondary" : "outline"}
                      >
                        {t(`density.${density}`)}
                        {draft.density === density ? <Check className="size-3.5" /> : null}
                      </Button>
                    ))}
                    <Button aria-pressed={draft.density === "custom"} disabled size="sm" type="button" variant={draft.density === "custom" ? "secondary" : "outline"}>
                      {t("density.custom")}
                    </Button>
                  </div>
                </section>

                <section className="grid gap-3 border-t pt-5">
                  <div>
                    <h3 className="text-sm font-semibold">{t("templates.title")}</h3>
                    <p className="text-xs leading-5 text-muted-foreground">{t("templates.description")}</p>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      aria-label={t("templates.name")}
                      className="h-9 min-w-0 flex-1"
                      data-testid="wiki-typography-template-name"
                      maxLength={80}
                      onChange={(event) => setTemplateName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveTemplate();
                        }
                      }}
                      placeholder={t("templates.namePlaceholder")}
                      value={templateName}
                    />
                    <Button disabled={pending || !templateName.trim()} onClick={saveTemplate} size="sm" type="button">
                      <BookmarkPlus className="size-4" />
                      {t("templates.save")}
                    </Button>
                  </div>
                  {templates.length === 0 ? (
                    <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{t("templates.empty")}</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {templates.map((template) => (
                        <div className="flex min-w-0 items-center gap-1 rounded-lg border bg-background/70 p-1.5" key={template.id}>
                          <Button
                            className="min-w-0 flex-1 justify-start"
                            data-testid={`wiki-typography-template-${template.id}`}
                            disabled={pending}
                            onClick={() => setDraft(normalizeWikiTypography(template.typography))}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            <span className="truncate">{template.name}</span>
                          </Button>
                          <Button
                            aria-label={t("templates.delete", { name: template.name })}
                            className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                            disabled={pending}
                            onClick={() => removeTemplate(template.id)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="grid gap-3">
                  <h3 className="text-sm font-semibold">{t("sections.type")}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["bodyFont", "headingFont"] as const).map((field) => (
                      <div className="grid gap-1.5" key={field}>
                        <Label className="text-xs" htmlFor={`wiki-${field}`}>{t(`controls.${field}`)}</Label>
                        <Select value={draft[field]} onValueChange={(value) => value && patch(field, value as WikiFontFamily)}>
                          <SelectTrigger className="w-full" id={`wiki-${field}`}><SelectValue>{t(`fonts.${draft[field]}`)}</SelectValue></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="humanist">{t("fonts.humanist")}</SelectItem>
                            <SelectItem value="serif">{t("fonts.serif")}</SelectItem>
                            <SelectItem value="system">{t("fonts.system")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  {numberControls.map((control) => (
                    <NumberControl
                      {...control}
                      defaultValue={DEFAULT_WIKI_TYPOGRAPHY[control.field]}
                      key={control.field}
                      onChange={(value) => patch(control.field, value)}
                      resetLabel={t("resetControl")}
                      value={draft[control.field]}
                    />
                  ))}
                </section>

                <section className="grid gap-3">
                  <h3 className="text-sm font-semibold">{t("sections.headings")}</h3>
                  {headingControls.map((control) => (
                    <NumberControl
                      {...control}
                      defaultValue={DEFAULT_WIKI_TYPOGRAPHY[control.field]}
                      key={control.field}
                      onChange={(value) => patch(control.field, value)}
                      resetLabel={t("resetControl")}
                      value={draft[control.field]}
                    />
                  ))}
                </section>

                <section className="grid gap-3">
                  <h3 className="text-sm font-semibold">{t("sections.colors")}</h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(["textColor", "accentColor", "mutedColor"] as const).map((field) => (
                      <Label className="grid gap-1.5 rounded-lg border bg-background/70 p-3 text-xs" key={field}>
                        <span>{t(`controls.${field}`)}</span>
                        <span className="flex items-center gap-2">
                          <ColorPicker
                            aria-label={t(`controls.${field}`)}
                            className="h-8 w-14 shrink-0"
                            onChange={(color) => patch(field, color)}
                            value={draft[field]}
                          />
                          <Input
                            aria-label={`${t(`controls.${field}`)} Hex`}
                            className="h-8 min-w-0 font-mono text-xs uppercase"
                            defaultValue={draft[field]}
                            key={`${field}-${draft[field]}`}
                            maxLength={7}
                            onBlur={(event) => {
                              const value = event.target.value.toUpperCase();
                              if (/^#[0-9A-F]{6}$/.test(value)) patch(field, value);
                              else event.target.value = draft[field];
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                            }}
                          />
                          <Button
                            aria-label={`${t("resetControl")}: ${t(`controls.${field}`)}`}
                            className="size-7 shrink-0"
                            onClick={() => patch(field, DEFAULT_WIKI_TYPOGRAPHY[field])}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <RotateCcw className="size-3.5" />
                          </Button>
                        </span>
                      </Label>
                    ))}
                  </div>
                </section>
              </div>

              <aside className="lg:sticky lg:top-0">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t("preview.title")}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{t("preview.live")}</span>
                </div>
                <div className="wiki-typography-preview" data-testid="wiki-typography-preview" style={previewStyle}>
                  <h2>{t("preview.heading")}</h2>
                  <p>{t("preview.paragraph")}</p>
                  <ul>
                    <li>{t("preview.bulletOne")}</li>
                    <li>{t("preview.bulletTwo")}</li>
                  </ul>
                  <ul data-type="taskList">
                    <li data-checked="true">
                      <label><input checked readOnly type="checkbox" /></label>
                      <div><p>{t("preview.taskOne")}</p></div>
                    </li>
                    <li data-checked="false">
                      <label><input readOnly type="checkbox" /></label>
                      <div><p>{t("preview.taskTwo")}</p></div>
                    </li>
                  </ul>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("preview.hint")}</p>
              </aside>
            </div>
          </TabsContent>

          <TabsContent value="editor" className="min-h-0 overflow-y-auto px-5 py-4">
            <div className="mx-auto grid max-w-2xl gap-3">
              <div className="mb-1">
                <h3 className="text-sm font-semibold">{t("editorSection.title")}</h3>
                <p className="text-xs leading-5 text-muted-foreground">{t("editorSection.description")}</p>
              </div>
              <PreferenceToggle
                checked={draftPreferences.minimalToolbar}
                description={t("minimalToolbarDescription")}
                label={t("minimalToolbar")}
                onChange={(minimalToolbar) => setDraftPreferences((current) => ({ ...current, minimalToolbar }))}
              />
              <PreferenceToggle
                checked={draftPreferences.typewriterMode}
                description={t("typewriterDescription")}
                label={t("typewriter")}
                onChange={(typewriterMode) => setDraftPreferences((current) => ({ ...current, typewriterMode }))}
              />
              <PreferenceToggle
                checked={draftPreferences.statusVisible}
                description={t("statusBarDescription")}
                label={t("statusBar")}
                onChange={(statusVisible) => setDraftPreferences((current) => ({ ...current, statusVisible }))}
              />
            </div>
          </TabsContent>
        </Tabs>

        {error ? <p role="alert" className="border-t bg-destructive/5 px-5 py-2 text-xs text-destructive">{error}</p> : null}
        <DialogFooter className="m-0 rounded-none px-5 py-3">
          <Button
            className="mr-auto"
            disabled={pending}
            onClick={() => {
              setDraft(DEFAULT_WIKI_TYPOGRAPHY);
              setDraftPreferences({ minimalToolbar: false, statusVisible: true, typewriterMode: false });
            }}
            type="button"
            variant="ghost"
          >
            <RotateCcw />
            {t("resetAll")}
          </Button>
          <Button disabled={pending} onClick={() => onOpenChange(false)} type="button" variant="outline">{t("cancel")}</Button>
          <Button disabled={pending} onClick={save} type="button">{pending ? t("saving") : t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
