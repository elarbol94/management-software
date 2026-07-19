import { requireUser } from "@/lib/auth";
import { DocumentsWorkspace } from "@/modules/accounting/components/documents-workspace";

export default async function DocumentsPage() {
  await requireUser();

  return <DocumentsWorkspace />;
}
