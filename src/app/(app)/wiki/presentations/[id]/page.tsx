import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPresentation, listPresentationRevisions } from "@/modules/wiki/presentation-queries";
import { PresentationEditor } from "@/modules/wiki/components/presentation-editor";

export default async function PresentationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const [viewer, { id }] = await Promise.all([requireUser(), params]);
  const presentation = getPresentation(id, viewer);
  if (!presentation) notFound();
  return <PresentationEditor presentation={presentation} revisions={presentation.role === "edit" || presentation.role === "owner" ? listPresentationRevisions(id, viewer) : []} />;
}
