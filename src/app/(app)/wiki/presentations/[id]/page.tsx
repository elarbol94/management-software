import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPresentation } from "@/modules/wiki/presentation-queries";
import { PresentationEditor } from "@/modules/wiki/components/presentation-editor";

export default async function PresentationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requireUser(), params]);
  const presentation = getPresentation(id);
  if (!presentation) notFound();
  return <PresentationEditor presentation={presentation} />;
}
