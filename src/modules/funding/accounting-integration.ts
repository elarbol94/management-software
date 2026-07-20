import { eq } from "drizzle-orm";
import { db } from "@/db";
import { fundingIncomeLinks, fundingProjects } from "@/db/schema";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Funding-owned adapter used inside the accounting mutation transaction. */
export function syncFundingIncomeLink(
  tx: DbTransaction,
  accountingEntryId: string,
  projectId: string | null,
) {
  tx.delete(fundingIncomeLinks)
    .where(eq(fundingIncomeLinks.accountingEntryId, accountingEntryId))
    .run();
  if (!projectId) return;
  const project = tx
    .select({ id: fundingProjects.id })
    .from(fundingProjects)
    .where(eq(fundingProjects.id, projectId))
    .get();
  if (!project) throw new Error("Funding project not found");
  tx.insert(fundingIncomeLinks).values({ projectId, accountingEntryId }).run();
}
