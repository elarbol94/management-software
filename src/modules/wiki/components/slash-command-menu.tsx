"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Extension, type Editor } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { SlashCommandSearchItem } from "../lib/slash-commands";
import { canOpenSlashCommands, filterSlashCommands } from "../lib/slash-commands";

export type SlashCommandDefinition = SlashCommandSearchItem & {
  groupLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  execute: (editor: Editor) => void;
};

type SlashCommandMenuHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

type SlashCommandMenuProps = {
  items: SlashCommandDefinition[];
  command: (item: SlashCommandDefinition) => void;
  ariaLabel: string;
  emptyLabel: string;
};

const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(function SlashCommandMenu(
  { items, command, ariaLabel, emptyLabel },
  ref,
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);
  useEffect(() => {
    optionRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelectedIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelectedIndex((current) => (current - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Home") {
        setSelectedIndex(0);
        return true;
      }
      if (event.key === "End") {
        setSelectedIndex(items.length - 1);
        return true;
      }
      if (event.key === "Enter") {
        command(items[selectedIndex] ?? items[0]);
        return true;
      }
      return false;
    },
  }), [command, items, selectedIndex]);

  if (items.length === 0) {
    return <div role="status" className="z-[80] w-80 rounded-xl border bg-popover p-3 text-sm text-muted-foreground shadow-xl">{emptyLabel}</div>;
  }

  let previousGroup = "";
  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={`slash-command-${items[selectedIndex]?.id}`}
      className="z-[80] max-h-[min(24rem,60vh)] w-80 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        const showGroup = item.group !== previousGroup;
        previousGroup = item.group;
        return (
          <div key={item.id}>
            {showGroup && <div className="px-2 pb-1 pt-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase first:pt-1">{item.groupLabel}</div>}
            <button
              ref={(element) => { optionRefs.current[index] = element; }}
              id={`slash-command-${item.id}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent aria-selected:bg-accent"
              onPointerMove={() => setSelectedIndex(index)}
              onPointerDown={(event) => { event.preventDefault(); command(item); }}
            >
              <span className="mt-0.5 rounded-md border bg-background p-1.5"><Icon className="size-4" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

export function createSlashCommandExtension({
  commands,
  ariaLabel,
  emptyLabel,
}: {
  commands: SlashCommandDefinition[];
  ariaLabel: string;
  emptyLabel: string;
}) {
  return Extension.create({
    name: "slashCommands",
    priority: 200,
    addProseMirrorPlugins() {
      return [Suggestion<SlashCommandDefinition, SlashCommandDefinition>({
        pluginKey: new PluginKey("slashCommands"),
        editor: this.editor,
        char: "/",
        allowSpaces: true,
        allowedPrefixes: null,
        placement: "bottom-start",
        offset: { mainAxis: 6 },
        flip: true,
        items: ({ query }) => filterSlashCommands(commands, query),
        allow: ({ state, range }) => {
          const $slash = state.doc.resolve(range.from);
          if (!$slash.parent.isTextblock) return false;
          return canOpenSlashCommands({
            textBeforeSlash: $slash.parent.textBetween(0, $slash.parentOffset, " "),
            inCodeBlock: $slash.parent.type.name === "codeBlock",
            inLink: $slash.marks().some((mark) => mark.type.name === "link"),
          });
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.execute(editor);
        },
        render: () => {
          let component: ReactRenderer<SlashCommandMenuHandle, SlashCommandMenuProps> | undefined;
          let unmount: (() => void) | undefined;
          const renderProps = (props: SuggestionProps<SlashCommandDefinition, SlashCommandDefinition>) => ({
            items: props.items,
            command: props.command,
            ariaLabel,
            emptyLabel,
          });
          return {
            onStart(props) {
              component = new ReactRenderer(SlashCommandMenu, { props: renderProps(props), editor: props.editor });
              unmount = props.mount(component.element);
            },
            onUpdate(props) {
              component?.updateProps(renderProps(props));
            },
            onKeyDown({ event }) {
              return component?.ref?.onKeyDown(event) ?? false;
            },
            onExit() {
              unmount?.();
              component?.destroy();
              component = undefined;
              unmount = undefined;
            },
          };
        },
      })];
    },
  });
}
