export type FinancingAmount = {
  sourceType:
    | "requested_grant"
    | "own_funds"
    | "own_services"
    | "bank"
    | "shareholder"
    | "other_public"
    | "private_investor";
  amountCents: number;
};

export function calculateBudgetItemTotal(
  quantityThousandths: number,
  unitPriceCents: number,
) {
  return Math.round((quantityThousandths * unitPriceCents) / 1000);
}

export function calculateFinancing(
  totalProjectCostCents: number,
  sources: FinancingAmount[],
) {
  const sum = (types: FinancingAmount["sourceType"][]) =>
    sources
      .filter((source) => types.includes(source.sourceType))
      .reduce((total, source) => total + source.amountCents, 0);

  const requestedGrantCents = sum(["requested_grant"]);
  const otherPublicSupportCents = sum(["other_public"]);
  const financingTotalCents = sources.reduce(
    (total, source) => total + source.amountCents,
    0,
  );

  // "Required own funds" is the project cost not covered by requested grant
  // or other public support. Bank/private financing can cover this need but
  // does not reduce the underlying own-financing requirement.
  const requiredOwnFundsCents = Math.max(
    0,
    totalProjectCostCents - requestedGrantCents - otherPublicSupportCents,
  );

  return {
    requestedGrantCents,
    otherPublicSupportCents,
    requiredOwnFundsCents,
    financingTotalCents,
    financingGapCents: totalProjectCostCents - financingTotalCents,
  };
}

export function calculateMaximumGrant(
  eligibleCostCents: number,
  fundingRateBasisPoints: number,
  fundingCapCents: number | null,
) {
  const rateAmount = Math.round(
    (eligibleCostCents * fundingRateBasisPoints) / 10_000,
  );
  return fundingCapCents === null
    ? rateAmount
    : Math.min(rateAmount, fundingCapCents);
}

export type FundingWarningCode =
  | "cost_before_start"
  | "plan_overrun"
  | "missing_evidence"
  | "financing_gap"
  | "project_end_near";

export function calculateWarningCodes(input: {
  projectStart: string | null;
  projectEnd: string | null;
  projectStatus: string;
  financingGapCents: number;
  budgetActuals: Array<{
    plannedCents: number;
    actualCents: number;
  }>;
  bookings: Array<{
    bookingDate: string;
    evidenceStatus: string;
  }>;
  today?: string;
}): FundingWarningCode[] {
  const warnings: FundingWarningCode[] = [];

  if (
    input.projectStart &&
    input.bookings.some((booking) => booking.bookingDate < input.projectStart!)
  ) {
    warnings.push("cost_before_start");
  }
  if (
    input.budgetActuals.some((item) => item.actualCents > item.plannedCents)
  ) {
    warnings.push("plan_overrun");
  }
  if (
    input.bookings.some((booking) => booking.evidenceStatus !== "complete")
  ) {
    warnings.push("missing_evidence");
  }
  if (input.financingGapCents > 0) warnings.push("financing_gap");

  if (input.projectEnd && input.projectStatus !== "completed") {
    const today = new Date(`${input.today ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const end = new Date(`${input.projectEnd}T00:00:00Z`);
    const days = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
    if (days >= 0 && days <= 60) warnings.push("project_end_near");
  }

  return warnings;
}
