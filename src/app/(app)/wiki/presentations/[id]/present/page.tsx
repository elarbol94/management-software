import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPresentation } from "@/modules/wiki/presentation-queries";
import { PresentationPlayer } from "@/modules/wiki/components/presentation-player";

export default async function PresentPage({ params }: { params: Promise<{ id: string }> }) {
  const [viewer, { id }] = await Promise.all([requireUser(), params]);
  const presentation = getPresentation(id, viewer);
  if (!presentation) notFound();
  return <PresentationPlayer presentation={presentation} />;
}
