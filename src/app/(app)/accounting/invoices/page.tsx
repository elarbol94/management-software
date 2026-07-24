import { requireUser } from "@/lib/auth";
import { DocumentsWorkspace } from "@/modules/accounting/components/documents-workspace";

/** Legacy entry point kept for bookmarks and the existing invoice flow. */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; receiptCursor?: string }>;
}) {
  const [, params] = await Promise.all([requireUser(), searchParams]);

  return (
    <DocumentsWorkspace
      cursor={params.cursor}
      receiptCursor={params.receiptCursor}
      basePath="/accounting/invoices"
    />
  );
}
