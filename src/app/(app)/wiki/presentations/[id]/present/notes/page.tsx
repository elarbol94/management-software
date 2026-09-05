import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPresentation } from "@/modules/wiki/presentation-queries";
import { PresentationPresenterView } from "@/modules/wiki/components/presentation-presenter-view";

export default async function PresenterNotesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ session?: string }> }) {
  const [viewer, { id }, { session }] = await Promise.all([requireUser(), params, searchParams]);
  const presentation = getPresentation(id, viewer);
  if (!presentation || (presentation.role !== "edit" && presentation.role !== "owner")) notFound();
  return <PresentationPresenterView presentation={presentation} sessionId={typeof session === "string" ? session : undefined} />;
}
