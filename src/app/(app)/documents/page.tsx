import { requireUser } from "@/lib/auth";
import { DocumentsWorkspace } from "@/modules/accounting/components/documents-workspace";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; receiptCursor?: string }>;
}) {
  const [, params] = await Promise.all([requireUser(), searchParams]);

  return (
    <DocumentsWorkspace
      cursor={params.cursor}
      receiptCursor={params.receiptCursor}
    />
  );
}
