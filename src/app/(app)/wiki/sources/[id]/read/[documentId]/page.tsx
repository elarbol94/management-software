import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPdfReaderData } from "@/modules/wiki/pdf-queries";
import { PdfReader } from "@/modules/wiki/components/pdf-reader";
import { PdfProcessingState } from "@/modules/wiki/components/pdf-processing-state";
import { ensureUserMarkColor } from "@/lib/user-mark-colors.server";

export default async function PdfReaderPage({ params, searchParams }: {
  params: Promise<{ id: string; documentId: string }>;
  searchParams: Promise<{ page?: string; annotation?: string }>;
}) {
  const currentUser = await requireUser();
  const { id, documentId } = await params; const query = await searchParams;
  const data = getPdfReaderData(id, documentId); if (!data) notFound();
  if (data.document.status !== "ready") return <PdfProcessingState sourceId={id} documentId={documentId} status={data.document.status} pageCount={data.document.pageCount} progressPage={data.document.progressPage} error={data.document.error} />;
  const requestedPage = Number(query.page || 1);
  return <PdfReader
    sourceId={id} sourceTitle={data.document.sourceTitle} attachmentId={data.document.attachmentId}
    documentId={documentId} fileName={data.document.fileName} pages={data.pages}
    initialAnnotations={data.annotations.map((annotation) => ({ ...annotation, createdAt: annotation.createdAt.toISOString(), updatedAt: annotation.updatedAt.toISOString(), comments: annotation.comments.map((comment) => ({ ...comment, createdAt: comment.createdAt.toISOString() })) }))}
    initialPage={Number.isInteger(requestedPage) ? requestedPage : 1} initialAnnotationId={query.annotation}
    hasExplicitPage={typeof query.page === "string"}
    user={{ id: currentUser.id, name: currentUser.name, role: currentUser.role, markColor: ensureUserMarkColor(currentUser.id) }}
  />;
}
