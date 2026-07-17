"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Strikethrough,
} from "lucide-react";
import { savePageContent } from "@/modules/wiki/actions";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type PageRef = { id: string; title: string; slug: string };

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon-sm"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor selection
        onClick();
      }}
    >
      {children}
    </Button>
  );
}

function PageLinkPicker({ editor, pages }: { editor: Editor; pages: PageRef[] }) {
  const t = useTranslations("wiki");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" title={t("linkPage")} />}
      >
        <Link2 className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="flex max-h-64 w-64 flex-col gap-0.5 overflow-y-auto p-1">
        {pages.map((page) => (
          <button
            key={page.id}
            type="button"
            className="rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              const { empty } = editor.state.selection;
              if (empty) {
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: page.title,
                    marks: [{ type: "link", attrs: { href: `/wiki/${page.slug}` } }],
                  })
                  .run();
              } else {
                editor
                  .chain()
                  .focus()
                  .setLink({ href: `/wiki/${page.slug}` })
                  .run();
              }
              setOpen(false);
            }}
          >
            {page.title}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function WikiEditor({
  pageId,
  initialContent,
  allPages,
}: {
  pageId: string;
  initialContent: string;
  allPages: PageRef[];
}) {
  const t = useTranslations("wiki");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  let content: object | undefined;
  try {
    content = initialContent ? JSON.parse(initialContent) : undefined;
  } catch {
    content = undefined;
  }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content,
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral dark:prose-invert max-w-none min-h-64 focus:outline-none",
      },
    },
    onUpdate({ editor }) {
      dirty.current = true;
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const result = await savePageContent({
            id: pageId,
            contentJson: JSON.stringify(editor.getJSON()),
          });
          dirty.current = !result.saved;
          setSaveState(result.saved ? "saved" : "idle");
        } catch {
          setSaveState("idle");
        }
      }, 800);
    },
  });

  // Flush pending edits when unmounting (e.g. navigating to another page).
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirty.current && editor && !editor.isDestroyed) {
        void savePageContent({
          id: pageId,
          contentJson: JSON.stringify(editor.getJSON()),
        }).catch(() => undefined);
      }
    };
  }, [editor, pageId]);

  if (!editor) return <div className="min-h-64" />;

  function setLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-md border bg-background/95 p-1 backdrop-blur">
        <ToolbarButton
          title="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="size-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          title="H1"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="H2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="H3"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 className="size-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          title="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Ordered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Task list"
          active={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListTodo className="size-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          title="Blockquote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Code block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code className="size-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          title={t("insertLink")}
          active={editor.isActive("link")}
          onClick={setLink}
        >
          <Link2 className="size-4 rotate-45" />
        </ToolbarButton>
        <PageLinkPicker editor={editor} pages={allPages} />
        <span className="ml-auto pr-2 text-xs text-muted-foreground">
          {saveState === "saving" && t("saving")}
          {saveState === "saved" && t("saved")}
        </span>
      </div>
      <EditorContent editor={editor} data-testid="wiki-editor" />
    </div>
  );
}
