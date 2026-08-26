"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Clock3, FileText, GripVertical, Search, UserRound } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import type { WorkspacePage } from "../research-queries";
import { parseTagList } from "../lib/tags";
import { buildPageTree } from "../lib/page-tree";
import { reorderPages } from "../actions";
import { Input } from "@/components/ui/input";

type Row = WorkspacePage & { depth: number };

function PageRow({ row, sortable, children }: { row: Row; sortable: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !sortable,
  });
  const t = useTranslations("wiki");
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        paddingLeft: `${12 + row.depth * 22}px`,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="group relative flex flex-wrap items-center gap-x-3 gap-y-1 bg-card p-3 transition-colors hover:bg-indigo-50/60 dark:hover:bg-indigo-950/20"
    >
      {sortable && (
        <button
          type="button"
          className="-ml-1 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={t("reorderPage", { title: row.title })}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      {children}
    </div>
  );
}

export function PageTreeList({ pages }: { pages: WorkspacePage[] }) {
  const t = useTranslations("wiki");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<WorkspacePage[]>(pages);
  // Optimistic order is local state, so a refreshed server list has to replace it;
  // without this the list keeps showing the pre-refresh order.
  const [syncedPages, setSyncedPages] = useState(pages);
  if (pages !== syncedPages) {
    setSyncedPages(pages);
    setOrder(pages);
  }
  const rows = useMemo(() => buildPageTree(order), [order]);
  const searching = query.trim().length > 0;
  const visible = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase(locale);
    if (!clean) return rows;
    // Filtering flattens the tree: a matching child without its parent must still be reachable.
    return rows
      .filter((row) =>
        [row.title, row.contentText, row.updatedByName, parseTagList(row.tags).map((tag) => tag.name).join(" ")]
          .some((value) => value.toLocaleLowerCase(locale).includes(clean)),
      )
      .map((row) => ({ ...row, depth: 0 }));
  }, [locale, query, rows]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const moved = order.find((page) => page.id === active.id);
    const target = order.find((page) => page.id === over.id);
    if (!moved || !target) return;
    // Reordering only rearranges siblings; dropping onto another branch would reparent,
    // which this list does not support yet.
    if ((moved.parentId ?? null) !== (target.parentId ?? null)) {
      toast.error(t("reorderSameLevelOnly"));
      return;
    }
    const siblings = order
      .filter((page) => (page.parentId ?? null) === (moved.parentId ?? null))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    const from = siblings.findIndex((page) => page.id === moved.id);
    const to = siblings.findIndex((page) => page.id === target.id);
    if (from < 0 || to < 0) return;
    const orderedIds = arrayMove(siblings, from, to).map((page) => page.id);

    const previous = order;
    const position = new Map(orderedIds.map((id, index) => [id, index]));
    setOrder((pagesInState) =>
      pagesInState.map((page) => (position.has(page.id) ? { ...page, sortOrder: position.get(page.id)! } : page)),
    );
    try {
      await reorderPages({ parentId: moved.parentId ?? null, orderedIds });
      router.refresh();
    } catch (error) {
      setOrder(previous);
      toast.error(error instanceof Error ? error.message : t("reorderFailed"));
    }
  }

  if (pages.length === 0)
    return <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-muted/20 text-center">
      <div>
        <FileText className="mx-auto mb-3 size-8 text-indigo-400" />
        <h2 className="font-medium">{t("noDocuments")}</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("noDocumentsDescription")}</p>
      </div>
    </div>;

  const rowBody = (row: Row) => <>
    <Link href={`/wiki/pages/${row.slug}`} className="flex min-w-0 flex-1 items-center gap-2">
      <FileText className="size-4 shrink-0 text-indigo-400" />
      <span className="truncate text-sm font-medium group-hover:text-indigo-700 dark:group-hover:text-indigo-300">{row.title}</span>
    </Link>
    {parseTagList(row.tags).map((tag) => <Link key={tag.id} href={`/wiki/tags/${tag.id}`} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900">{tag.name}</Link>)}
    <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{t(`pageStatuses.${row.status}`)}</span>
    <span className="flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="size-3" />{row.updatedByName}</span>
    <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{format.dateTime(new Date(row.updatedAt), { dateStyle: "medium" })}</span>
  </>;

  return <div className="space-y-4">
    <div className="relative">
      <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
      <Input aria-label={t("searchDocuments")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchDocuments")} className="pl-9" />
    </div>
    {visible.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("noSearchResults")}</p> :
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleDragEnd(event)}>
      {/* Search flattens the tree, so dragging is disabled while filtering: the visible
          order is no longer the sibling order the drop would write. */}
      <SortableContext items={visible.map((row) => row.id)} strategy={verticalListSortingStrategy}>
        <div className="divide-y overflow-hidden rounded-xl border">
          {visible.map((row) => <PageRow key={row.id} row={row} sortable={!searching}>{rowBody(row)}</PageRow>)}
        </div>
      </SortableContext>
    </DndContext>}
  </div>;
}
