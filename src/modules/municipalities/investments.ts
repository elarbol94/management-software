export const MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION = 2;
export const MUNICIPALITY_INVESTMENTS_FIRST_YEAR = 2010;
export const MUNICIPALITY_INVESTMENTS_LATEST_YEAR = 2024;

export const INVESTMENT_TYPES = [
  { id: "3411" },
  { id: "3412" },
  { id: "3413" },
  { id: "3414" },
  { id: "3415" },
  { id: "3416" },
  { id: "3417" },
] as const;

export const INVESTMENT_TASK_AREAS = [
  { id: "0" }, { id: "1" }, { id: "2" }, { id: "3" }, { id: "4" },
  { id: "5" }, { id: "6" }, { id: "7" }, { id: "8" }, { id: "9" },
] as const;

export type InvestmentTypeId = (typeof INVESTMENT_TYPES)[number]["id"];
export type InvestmentTaskAreaId = (typeof INVESTMENT_TASK_AREAS)[number]["id"];
export type InvestmentDetailLevel = "municipality" | "statistics";
export type InvestmentAssetMatchStatus = "matched" | "unmatched" | "ambiguous";
export type InvestmentAssetMatchMethod = "project-code" | "exact-description" | "exact-amount" | "group-sum";

export const INVESTMENT_ASSET_MVAG_CODES = [
  "1010",
  "1021", "1022", "1023", "1024", "1025", "1026", "1027", "1028", "1029",
  "1041", "1042", "1043", "1044",
] as const;

export type InvestmentAssetMvagCode = (typeof INVESTMENT_ASSET_MVAG_CODES)[number];

export type MunicipalityInvestmentAsset = {
  id: string;
  sourceAssetId: string;
  year: number;
  mvagCode: InvestmentAssetMvagCode;
  approachCode: string;
  approachText: string;
  accountCode: string;
  accountText: string;
  projectCode: string;
  normalizedDescription: string;
  openingBalanceCents: number;
  additionsCents: number;
  disposalsCents: number;
  changesCents: number;
  closingBalanceCents: number;
  sourceFile: string;
};

export type MunicipalityInvestmentPosition = {
  id: string;
  year: number;
  taskArea: InvestmentTaskAreaId;
  approachCode: string;
  approachText: string;
  accountCode: string;
  accountText: string;
  projectCode: string;
  investmentType: InvestmentTypeId;
  amountCents: number;
  normalizedDescription: string;
  detailLevel: InvestmentDetailLevel;
  assetIds: string[];
  assetMatchStatus: InvestmentAssetMatchStatus;
  assetMatchMethod: InvestmentAssetMatchMethod | null;
};

export type MunicipalityInvestmentYear = {
  year: number;
  directInvestmentCents: number;
  investiveInflowsCents: number;
  investiveOutflowsCents: number;
  investiveBalanceCents: number;
  positionCount: number;
  detailLevel: InvestmentDetailLevel;
  statisticsFile: string;
  municipalityFile: string | null;
  reconciliation: "matched" | "statistics-only" | "mismatch-fallback";
  assetDetailLevel: "municipality" | "unavailable";
  assetStatisticsFile: string | null;
  assetMunicipalityFile: string | null;
  assetReconciliation: "matched" | "statistics-only" | "mismatch-fallback" | "unavailable";
};

export type MunicipalityInvestmentData = {
  schemaVersion: typeof MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION;
  municipality: {
    code: string;
    name: string;
    state: string;
  };
  firstYear: typeof MUNICIPALITY_INVESTMENTS_FIRST_YEAR;
  latestYear: typeof MUNICIPALITY_INVESTMENTS_LATEST_YEAR;
  availableYears: number[];
  generatedAt: string;
  unit: "cents";
  source: {
    title: "Statistik Austria via OffenerHaushalt.at";
    url: "https://www.offenerhaushalt.at/";
    definitionUrl: "https://www.bmf.gv.at/themen/budget/finanzbeziehungen-laender-gemeinden/vrv-2015.html";
  };
  years: MunicipalityInvestmentYear[];
  positions: MunicipalityInvestmentPosition[];
  assets: MunicipalityInvestmentAsset[];
};

export type MunicipalityInvestmentYearTotal = {
  year: number;
  directInvestmentCents: number;
  positionCount: number;
};

export type MunicipalityInvestmentIndexEntry = {
  code: string;
  name: string;
  state: string;
  availableYears: number[];
  missingYears: number[];
  latestAvailableYear: number;
  directInvestmentCents: number;
  latestYearInvestmentCents: number;
  positionCount: number;
  yearTotals: MunicipalityInvestmentYearTotal[];
  htmlFile: string;
  dataFile: string;
};

export type MunicipalityInvestmentUnavailableEntry = {
  code: string;
  name: string;
  state: string;
  availableYears: number[];
  missingYears: number[];
  reason: "no-statistics-files" | "no-nonzero-investments";
};

export type MunicipalityInvestmentIndex = {
  schemaVersion: typeof MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION;
  firstYear: typeof MUNICIPALITY_INVESTMENTS_FIRST_YEAR;
  latestYear: typeof MUNICIPALITY_INVESTMENTS_LATEST_YEAR;
  generatedAt: string;
  municipalityCount: number;
  skippedMunicipalityCount: number;
  mismatchFallbackCount: number;
  municipalities: MunicipalityInvestmentIndexEntry[];
  unavailableMunicipalities: MunicipalityInvestmentUnavailableEntry[];
};

export function isInvestmentTypeId(value: string): value is InvestmentTypeId {
  return INVESTMENT_TYPES.some(({ id }) => id === value);
}

export function isInvestmentTaskAreaId(value: string): value is InvestmentTaskAreaId {
  return INVESTMENT_TASK_AREAS.some(({ id }) => id === value);
}

export function isInvestmentAssetMvagCode(value: string): value is InvestmentAssetMvagCode {
  return INVESTMENT_ASSET_MVAG_CODES.some((code) => code === value);
}

export function isAssetCompatibleWithInvestmentType(
  assetMvagCode: InvestmentAssetMvagCode,
  investmentType: InvestmentTypeId,
) {
  if (investmentType === "3411") return assetMvagCode === "1010";
  if (investmentType === "3412") return ["1021", "1023", "1024", "1028", "1029"].includes(assetMvagCode);
  if (investmentType === "3413") return ["1022", "1028", "1029"].includes(assetMvagCode);
  if (investmentType === "3414") return ["1025", "1028"].includes(assetMvagCode);
  if (investmentType === "3415") return ["1026", "1028"].includes(assetMvagCode);
  if (investmentType === "3416") return ["1027", "1028"].includes(assetMvagCode);
  return assetMvagCode.startsWith("104");
}

export function normalizeInvestmentDescription(value: string) {
  return value.trim().toLocaleLowerCase("de-AT").replaceAll("ß", "ss").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function assertSafeCents(value: number, label: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`Ungültiger Centbetrag für ${label}.`);
}

export function validateMunicipalityInvestmentData(data: MunicipalityInvestmentData) {
  if (
    data.schemaVersion !== MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION
    || data.firstYear !== MUNICIPALITY_INVESTMENTS_FIRST_YEAR
    || data.latestYear !== MUNICIPALITY_INVESTMENTS_LATEST_YEAR
    || data.unit !== "cents"
    || !/^\d{5}$/.test(data.municipality.code)
    || !data.municipality.name.trim()
  ) throw new Error("Unerwartete Version oder Gemeindezuordnung der Investitionsdaten.");
  const availableYears = new Set(data.availableYears);
  if (
    data.availableYears.some((year) => !Number.isInteger(year)
      || year < MUNICIPALITY_INVESTMENTS_FIRST_YEAR
      || year > MUNICIPALITY_INVESTMENTS_LATEST_YEAR)
    || data.availableYears.join("|") !== [...data.availableYears].sort((left, right) => left - right).join("|")
  ) throw new Error("Ungültiger Zeitraum der Investitionsdaten.");
  const years = new Map(data.years.map((year) => [year.year, year]));
  if (years.size !== data.years.length || years.size !== availableYears.size) {
    throw new Error("Doppelte oder fehlende Investitionsjahre.");
  }
  for (const year of data.years) {
    if (!availableYears.has(year.year)) throw new Error(`Unerwartetes Investitionsjahr ${year.year}.`);
    assertSafeCents(year.directInvestmentCents, `${year.year}/Direktinvestitionen`);
    assertSafeCents(year.investiveInflowsCents, `${year.year}/Einzahlungen`);
    assertSafeCents(year.investiveOutflowsCents, `${year.year}/Auszahlungen`);
    assertSafeCents(year.investiveBalanceCents, `${year.year}/Saldo`);
    if (year.investiveBalanceCents !== year.investiveInflowsCents - year.investiveOutflowsCents) {
      throw new Error(`Investiver Saldo stimmt für ${year.year} nicht.`);
    }
  }
  const ids = new Set<string>();
  const assetIds = new Set<string>();
  const assetsById = new Map<string, MunicipalityInvestmentAsset>();
  for (const asset of data.assets) {
    if (assetIds.has(asset.id) || !availableYears.has(asset.year) || !isInvestmentAssetMvagCode(asset.mvagCode)) {
      throw new Error(`Ungültiger Vermögenswert ${asset.id}.`);
    }
    assetIds.add(asset.id);
    assetsById.set(asset.id, asset);
    for (const [label, value] of Object.entries({
      opening: asset.openingBalanceCents,
      additions: asset.additionsCents,
      disposals: asset.disposalsCents,
      changes: asset.changesCents,
      closing: asset.closingBalanceCents,
    })) assertSafeCents(value, `${asset.id}/${label}`);
    if (/\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/i.test(`${asset.approachText} ${asset.accountText}`)) {
      throw new Error(`Vermögenswert ${asset.id} enthält eine unzulässige IBAN.`);
    }
  }
  const totals = new Map<number, number>();
  const counts = new Map<number, number>();
  for (const position of data.positions) {
    if (ids.has(position.id)) throw new Error(`Doppelte Investitionsposition ${position.id}.`);
    ids.add(position.id);
    if (!availableYears.has(position.year) || !isInvestmentTypeId(position.investmentType)
      || !isInvestmentTaskAreaId(position.taskArea) || position.amountCents === 0) {
      throw new Error(`Ungültige Investitionsposition ${position.id}.`);
    }
    assertSafeCents(position.amountCents, position.id);
    if (position.assetIds.some((assetId) => !assetIds.has(assetId))) {
      throw new Error(`Investitionsposition ${position.id} verweist auf einen unbekannten Vermögenswert.`);
    }
    if ((position.assetMatchStatus === "matched") !== (position.assetIds.length > 0)
      || (position.assetMatchStatus === "matched") !== (position.assetMatchMethod !== null)) {
      throw new Error(`Inkonsistenter Vermögensabgleich für ${position.id}.`);
    }
    for (const assetId of position.assetIds) {
      const asset = assetsById.get(assetId)!;
      const requiresCompatibleClass = position.assetMatchMethod === "project-code" || position.assetMatchMethod === "exact-amount";
      if (asset.year !== position.year || (requiresCompatibleClass && !isAssetCompatibleWithInvestmentType(asset.mvagCode, position.investmentType))) {
        throw new Error(`Inkompatibler Vermögenswert ${assetId} für ${position.id}.`);
      }
    }
    totals.set(position.year, (totals.get(position.year) ?? 0) + position.amountCents);
    counts.set(position.year, (counts.get(position.year) ?? 0) + 1);
  }
  for (const year of data.years) {
    if ((totals.get(year.year) ?? 0) !== year.directInvestmentCents
      || (counts.get(year.year) ?? 0) !== year.positionCount) {
      throw new Error(`Investitionspositionen stimmen für ${year.year} nicht mit der Jahressumme überein.`);
    }
  }
  return data;
}

export function municipalityInvestmentTotal(data: MunicipalityInvestmentData, year?: number) {
  return data.years
    .filter((entry) => year === undefined || entry.year === year)
    .reduce((sum, entry) => sum + entry.directInvestmentCents, 0);
}
