import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPresentation } from "@/modules/wiki/presentation-queries";
import { PresentationPresenterView } from "@/modules/wiki/components/presentation-presenter-view";

export default async function PresenterNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requireUser(), params]);
  const presentation = getPresentation(id);
  if (!presentation) notFound();
  return <PresentationPresenterView presentation={presentation} />;
}
