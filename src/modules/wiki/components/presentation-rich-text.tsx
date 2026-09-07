"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { presentationLinkSchema, type PresentationTextElement } from "../lib/presentation";

type Content = PresentationTextElement["content"];
function toDoc(content: Content): JSONContent {
  const paragraphs: JSONContent[] = [{ type: "paragraph", content: [] }];
  for (const run of content.runs ?? [{ text: content.text }]) {
    run.text.split("\n").forEach((text, index) => {
      if (index) paragraphs.push({ type: "paragraph", content: [] });
      if (!text) return;
      const marks = [run.bold && { type: "bold" }, run.italic && { type: "italic" }, run.underline && { type: "underline" }, run.href && { type: "link", attrs: { href: run.href } }].filter(Boolean) as JSONContent["marks"];
      paragraphs[paragraphs.length - 1].content!.push({ type: "text", text, marks });
    });
  }
  return { type: "doc", content: paragraphs };
}
function fromDoc(doc: JSONContent): Pick<Content, "text" | "runs"> {
  const runs: NonNullable<Content["runs"]> = [];
  doc.content?.forEach((paragraph, index) => {
    if (index) runs.push({ text: "\n" });
    for (const node of paragraph.content ?? []) {
      if (node.type === "hardBreak") { runs.push({ text: "\n" }); continue; }
      const href = node.marks?.find((mark) => mark.type === "link")?.attrs?.href;
      runs.push({ text: node.text ?? "", bold: node.marks?.some((mark) => mark.type === "bold"), italic: node.marks?.some((mark) => mark.type === "italic"), underline: node.marks?.some((mark) => mark.type === "underline"), href: typeof href === "string" && presentationLinkSchema.safeParse(href).success ? href : undefined });
    }
  });
  return { text: runs.map((run) => run.text).join(""), runs };
}

export function PresentationRichText({ content, onChange, disabled }: { content: Content; onChange: (content: Content) => void; disabled?: boolean }) {
  const t = useTranslations("presentationStudio");
  const current = useRef({ content, onChange });
  useEffect(() => { current.current = { content, onChange }; });
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, bulletList: false, orderedList: false, listItem: false, link: { openOnClick: false } })],
    content: toDoc(content), editable: !disabled,
    editorProps: { attributes: { class: "min-h-24 rounded-md border p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500", role: "textbox", "aria-label": t("richText"), "aria-multiline": "true" } },
    onUpdate: ({ editor }) => {
      const next = fromDoc(editor.getJSON());
      if (next.text.length <= 5000 && (next.runs?.length ?? 0) <= 200) current.current.onChange({ ...current.current.content, ...next });
      else editor.commands.undo();
    },
  });
  // Access changes are not content edits and must not add autosaves or undo steps.
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  useEffect(() => {
    if (editor && JSON.stringify(fromDoc(editor.getJSON())) !== JSON.stringify({ text: content.text, runs: content.runs })) {
      // Avoid replacing the selection for an update emitted by this editor.
      const next = toDoc(content);
      if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [content, editor]);
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-1">
      {(["bold", "italic", "underline"] as const).map((mark) => <Button key={mark} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => editor?.chain().focus().toggleMark(mark).run()}>{t(mark)}</Button>)}
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => {
        const href = window.prompt(t("linkPrompt"), editor?.getAttributes("link").href ?? "https://");
        if (href === null) return;
        if (!presentationLinkSchema.safeParse(href).success) return;
        if (!href) editor?.chain().focus().unsetLink().run(); else editor?.chain().focus().setLink({ href }).run();
      }}>{t("link")}</Button>
    </div>
    <EditorContent editor={editor} />
  </div>;
}
