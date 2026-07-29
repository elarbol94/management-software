"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useMemo,
  useState,
  useTransition,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BadgeEuro,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  FileClock,
  Landmark,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SwitchLike } from "./switch-like";
import {
  activatePersonnelScenario,
  closePersonnelMonth,
  linkPersonnelFundingProject,
  savePersonnelScenario,
  upsertEmployeePlan,
  upsertFundingCostProfile,
  upsertProjectHourAllocation,
} from "../actions";
import type { PersonnelWorkspaceData } from "../queries";
import {
  allocatePlannedProjectCosts,
  applyFundingProfile,
  calculateAnnualPersonnelCost,
  calculatePayroll,
  solveGrossForNet,
  type EmploymentContractPeriod,
} from "../lib/engine";
import { getPayrollRuleSet } from "../lib/rules";
import type { PayrollEmploymentType } from "@/modules/accounting/lib/payroll-at-2026";
import { localDateInZone } from "@/modules/calendar/date-utils";

const tabs = ["overview", "people", "calculator", "projects", "funding", "scenarios", "rules"] as const;
type Tab = (typeof tabs)[number];

const copy = {
  de: {
    title: "Personalkosten",
    subtitle: "Von der Vergütung bis zum belastbaren Projektstundensatz.",
    planningAid: "Planungshilfe · keine zertifizierte Lohnverrechnung",
    overview: "Übersicht", people: "Personen", calculator: "Rechner", projects: "Projekte",
    funding: "Förderung", scenarios: "Szenarien", rules: "Regelstände",
    annualCost: "Arbeitgeberkosten p. a.", monthlyCost: "Ø Arbeitgeberkosten / Monat",
    productive: "Produktive Stunden", hourly: "Direkter Stundensatz",
    costFlow: "Kostenfluss", gross: "Brutto", net: "Netto", levies: "Abgaben", employer: "Arbeitgeber",
    closeMonth: "Monat als Sammelentwurf übergeben", closing: "Monatsabschluss",
    createPerson: "Person und Vertragsstand anlegen", person: "Person", contract: "Vertrag",
    savePerson: "Personalplanung speichern", incomplete: "Einrichtung unvollständig",
    complete: "Planungsbereit", noPeople: "Noch keine vollständige Personalplanung.",
    inputAs: "Eingabe als", year: "Regeljahr", state: "Bundesland", municipality: "Gemeinde",
    employmentType: "Beschäftigungsart", amount: "Monatsbetrag", weeklyHours: "Wochenstunden",
    vacationWeeks: "Urlaubswochen", sickHours: "Erwarteter Krankenstand (h)",
    trainingHours: "Weiterbildung (h)", internalHours: "Interne Zeiten (h)",
    overhead: "Gemeinkostenaufschlag (%)", markup: "Verkaufsaufschlag (%)",
    specialPayments: "13./14. Bezug einplanen", calculate: "Live-Berechnung",
    taxableBenefits: "Sachbezug / Monat", commuterAllowance: "Pendlerpauschale / Monat",
    commuterEuro: "Pendlereuro / Monat", familyBonus: "Familienbonus / Monat",
    svEmployee: "DN-Sozialversicherung", wageTax: "Lohnsteuer", svEmployer: "DG-Sozialversicherung",
    statutoryLevies: "DB, DZ, KommSt, Vorsorge", annual: "Jahreskosten", fullRate: "Interner Vollkostensatz",
    salesRate: "Verkaufssatz", saveScenario: "Als Szenario speichern", scenarioName: "Szenarioname",
    allocate: "Planstunden zuordnen", hours: "Stunden", month: "Monat",
    capacity: "Kapazität", overbooked: "Überbucht", remaining: "Verfügbar",
    cost: "Plankosten", fundingProfiles: "Förderprofile", createProfile: "Profil speichern",
    profileName: "Profilname", version: "Version", divisor: "Stundenteiler",
    hourlyCap: "Stundensatzobergrenze", maxHours: "Max. Jahresstunden",
    linkProject: "Projekt und Förderprojekt verknüpfen", activate: "Als Basis aktivieren",
    forecast: "Prognose", verified: "Geprüft", postingBlocked: "Buchungsübergabe gesperrt",
    restrictedTitle: "Projektkostenraten", restrictedBody: "Gehalts- und Steuerdetails sind durch die Personalrolle geschützt.",
    personnelNumber: "Personalnummer", userAccount: "Benutzerkonto", birthDate: "Geburtsdatum",
    collectiveAgreement: "Kollektivvertrag", location: "Betriebsstätte", joinedOn: "Eintritt",
    validFrom: "Gültig ab", noCollectiveAgreement: "Kein KV hinterlegt",
    prospectivePerson: "Prospektive Person", fundingProject: "Förderprojekt",
    fixedDivisor: "Fixer Teiler", fixed: "Fix", eligiblePlannedCosts: "Förderfähige Plankosten",
    ruleDescription: "Jede Berechnung speichert Regelversion, Status und Annahmen.",
    liveComparison: "vs. Live", defaultScenarioName: "Gehaltsszenario",
    genericError: "Fehler", monthClosed: "Sammelentwurf erstellt",
    scenarioSaved: "Szenario gespeichert", personnelPlanSaved: "Personalplanung gespeichert",
    allocationSaved: "Planstunden gespeichert", fundingProfileSaved: "Förderprofil gespeichert",
    fundingProjectLinked: "Förderprojekt verknüpft", scenarioActivated: "Szenario aktiviert",
  },
  en: {
    title: "Personnel costs",
    subtitle: "From compensation to a defensible project hourly rate.",
    planningAid: "Planning aid · not certified payroll",
    overview: "Overview", people: "People", calculator: "Calculator", projects: "Projects",
    funding: "Funding", scenarios: "Scenarios", rules: "Rule sets",
    annualCost: "Annual employer cost", monthlyCost: "Avg. employer cost / month",
    productive: "Productive hours", hourly: "Direct hourly rate",
    costFlow: "Cost flow", gross: "Gross", net: "Net", levies: "Levies", employer: "Employer",
    closeMonth: "Create consolidated accounting draft", closing: "Monthly close",
    createPerson: "Create person and contract period", person: "Person", contract: "Contract",
    savePerson: "Save personnel plan", incomplete: "Setup incomplete",
    complete: "Ready for planning", noPeople: "No complete personnel plans yet.",
    inputAs: "Input as", year: "Rule year", state: "State", municipality: "Municipality",
    employmentType: "Employment type", amount: "Monthly amount", weeklyHours: "Weekly hours",
    vacationWeeks: "Vacation weeks", sickHours: "Expected sick leave (h)",
    trainingHours: "Training (h)", internalHours: "Internal time (h)",
    overhead: "Overhead markup (%)", markup: "Sales markup (%)",
    specialPayments: "Plan 13th/14th salary", calculate: "Live calculation",
    taxableBenefits: "Taxable benefit / month", commuterAllowance: "Commuter allowance / month",
    commuterEuro: "Commuter credit / month", familyBonus: "Family bonus / month",
    svEmployee: "Employee social insurance", wageTax: "Wage tax", svEmployer: "Employer social insurance",
    statutoryLevies: "DB, DZ, municipal tax, provision", annual: "Annual cost", fullRate: "Internal full-cost rate",
    salesRate: "Sales rate", saveScenario: "Save as scenario", scenarioName: "Scenario name",
    allocate: "Allocate planned hours", hours: "Hours", month: "Month",
    capacity: "Capacity", overbooked: "Overbooked", remaining: "Available",
    cost: "Planned cost", fundingProfiles: "Funding profiles", createProfile: "Save profile",
    profileName: "Profile name", version: "Version", divisor: "Hour divisor",
    hourlyCap: "Hourly cap", maxHours: "Max. annual hours",
    linkProject: "Link project and funding project", activate: "Activate as baseline",
    forecast: "Forecast", verified: "Verified", postingBlocked: "Accounting transfer blocked",
    restrictedTitle: "Project cost rates", restrictedBody: "Salary and tax details are protected by the personnel role.",
    personnelNumber: "Personnel number", userAccount: "User account", birthDate: "Date of birth",
    collectiveAgreement: "Collective agreement", location: "Work location", joinedOn: "Start date",
    validFrom: "Valid from", noCollectiveAgreement: "No collective agreement",
    prospectivePerson: "Prospective person", fundingProject: "Funding project",
    fixedDivisor: "Fixed divisor", fixed: "Fixed", eligiblePlannedCosts: "Eligible planned costs",
    ruleDescription: "Each calculation records its rule version, status, and assumptions.",
    liveComparison: "vs. live", defaultScenarioName: "Salary scenario",
    genericError: "Error", monthClosed: "Consolidated draft created",
    scenarioSaved: "Scenario saved", personnelPlanSaved: "Personnel plan saved",
    allocationSaved: "Planned hours saved", fundingProfileSaved: "Funding profile saved",
    fundingProjectLinked: "Funding project linked", scenarioActivated: "Scenario activated",
  },
};

type Text = typeof copy.de;
const euro = (cents: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(cents / 100);
const number = (value: number, locale: string, digits = 1) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
const decimal = (value: string) => Number(value.replace(",", ".")) || 0;
const money = (value: string) => Math.round(decimal(value) * 100);

const employmentLabels: Record<
  PayrollEmploymentType,
  { de: string; en: string }
> = {
  worker: { de: "Arbeiter/in", en: "Worker" },
  employee: { de: "Angestellte/r", en: "Employee" },
  marginal: { de: "Geringfügig", en: "Marginal employment" },
  apprentice: { de: "Lehrling", en: "Apprentice" },
  freelance: { de: "Freie/r Dienstnehmer/in", en: "Freelance employee" },
  managing_director_asvg: { de: "Geschäftsführung ASVG", en: "Managing director (ASVG)" },
  shareholder_managing_director_gsvg: { de: "Geschäftsführung GSVG", en: "Shareholder managing director (GSVG)" },
};

function employmentLabel(type: string, locale: string) {
  const normalized =
    type === "managing_director" ? "managing_director_asvg" : type;
  const labels = employmentLabels[normalized as PayrollEmploymentType];
  return labels?.[locale.startsWith("de") ? "de" : "en"] ?? type;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const generatedId = useId();
  if (!isValidElement<{ id?: string }>(children)) {
    return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
  }
  const control = children as ReactElement<{ id?: string }>;
  const id = control.props.id ?? generatedId;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(control, { id })}
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "blue" | "amber" }) {
  const color = tone === "blue" ? "text-[#315c7b]" : tone === "amber" ? "text-[#9a5b13]" : "text-[#173c32]";
  return <div className="border-l border-[#dce5e1] pl-4 first:border-0 first:pl-0"><p className="text-[11px] font-semibold tracking-[0.08em] text-[#71807a] uppercase">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p></div>;
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <div><p className="text-[11px] font-semibold tracking-[0.14em] text-[#688079] uppercase">{eyebrow}</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-[#173c32]">{title}</h2>{description && <p className="mt-1 max-w-2xl text-sm text-[#6c7b76]">{description}</p>}</div>;
}

export function PersonnelWorkspace({ data, locale }: { data: PersonnelWorkspaceData; locale: string }) {
  const t = (locale.startsWith("de") ? copy.de : copy.en) as Text;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [pending, startTransition] = useTransition();
  const firstLocation = data.locations[0];
  const [calc, setCalc] = useState<CalculatorState>({
    year: data.year,
    inputMode: "gross" as "gross" | "net",
    amount: "4500",
    employmentType: "employee" as PayrollEmploymentType,
    locationId: firstLocation?.id ?? "",
    weeklyHours: "40",
    vacationWeeks: "5",
    sickHours: "0",
    trainingHours: "0",
    internalHours: "0",
    overhead: "15",
    markup: "20",
    specialPayments: true,
    taxableBenefits: "0",
    commuterAllowance: "0",
    commuterEuro: "0",
    familyBonus: "0",
  });
  const [scenarioName, setScenarioName] = useState(t.defaultScenarioName);
  const [scenarioEmployeeId, setScenarioEmployeeId] = useState("");
  const location = data.locations.find((row) => row.id === calc.locationId) ?? firstLocation;
  const contract = useMemo<EmploymentContractPeriod>(() => ({
    validFrom: `${calc.year}-01-01`,
    employmentType: calc.employmentType,
    inputMode: calc.inputMode,
    monthlyAmountCents: money(calc.amount),
    weeklyMinutes: Math.round(Number(calc.weeklyHours.replace(",", ".")) * 60),
    workdaysPerWeek: 5,
    specialPaymentsEnabled: calc.specialPayments,
    holidayPayMonth: 6,
    christmasPayMonth: 11,
    vacationWeeksHundredths: Math.round(Number(calc.vacationWeeks.replace(",", ".")) * 100),
    expectedSickHoursHundredths: Math.round(Number(calc.sickHours.replace(",", ".")) * 100),
    trainingHoursHundredths: Math.round(Number(calc.trainingHours.replace(",", ".")) * 100),
    internalHoursHundredths: Math.round(Number(calc.internalHours.replace(",", ".")) * 100),
    overheadRateBasisPoints: Math.round(Number(calc.overhead.replace(",", ".")) * 100),
    salesMarkupBasisPoints: Math.round(Number(calc.markup.replace(",", ".")) * 100),
  }), [calc]);
  const tax = useMemo(() => ({
    taxableBenefitsCents: money(calc.taxableBenefits),
    commuterAllowanceCents: money(calc.commuterAllowance),
    commuterEuroCents: money(calc.commuterEuro),
    familyBonusCents: money(calc.familyBonus),
  }), [calc.commuterAllowance, calc.commuterEuro, calc.familyBonus, calc.taxableBenefits]);
  const annual = useMemo(() => location ? calculateAnnualPersonnelCost({
    year: calc.year,
    contract,
    location: { state: location.state, municipality: location.municipality },
    tax,
  }) : null, [calc.year, contract, location, tax]);
  const regularGross = calc.inputMode === "gross" ? money(calc.amount) : location ? solveGrossForNet({
    year: calc.year,
    payrollMonth: `${calc.year}-01`,
    targetNetCents: money(calc.amount),
    employmentType: calc.employmentType,
    location: { state: location.state, municipality: location.municipality },
    ...tax,
  }).grossCents : 0;
  const monthly = location ? calculatePayroll({
    year: calc.year,
    payrollMonth: `${calc.year}-01`,
    grossCents: regularGross,
    employmentType: calc.employmentType,
    location: { state: location.state, municipality: location.municipality },
    ...tax,
  }) : null;
  const totals = data.people.reduce((acc, person) => ({
    cost: acc.cost + (person.annual?.annualEmployerCostCents ?? 0),
    hours: acc.hours + (person.annual?.productiveHoursHundredths ?? 0),
  }), { cost: 0, hours: 0 });

  function run(action: () => Promise<unknown>, success: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(success);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.genericError);
      }
    });
  }

  if (!data.fullAccess) {
    return <div className="mx-auto max-w-[1200px] space-y-6">
      <Header t={t} />
      <div className="rounded-2xl border border-[#dce5e1] bg-[#f6f9f8] p-6">
        <ShieldCheck className="size-7 text-[#315c7b]" />
        <h2 className="mt-4 text-xl font-semibold text-[#173c32]">{t.restrictedTitle}</h2>
        <p className="mt-1 text-sm text-[#6c7b76]">{t.restrictedBody}</p>
      </div>
      <AllocationTable data={data} locale={locale} t={t} />
    </div>;
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <Header t={t} />
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-[#dce5e1] bg-[#f7f9f8] p-1" aria-label={t.title}>
        {tabs.map((key) => <button key={key} type="button" aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${tab === key ? "bg-white text-[#173c32] shadow-sm" : "text-[#71807a] hover:text-[#29463e]"}`}>{t[key]}</button>)}
      </nav>

      {tab === "overview" && <div className="space-y-5">
        <section className="grid gap-4 rounded-2xl border border-[#cbdad4] bg-white p-5 shadow-[0_10px_30px_rgba(23,60,50,0.05)] md:grid-cols-4">
          <Metric label={t.annualCost} value={euro(totals.cost, locale)} />
          <Metric label={t.monthlyCost} value={euro(Math.round(totals.cost / 12), locale)} />
          <Metric label={t.productive} value={`${number(totals.hours / 100, locale)} h`} tone="blue" />
          <Metric label={t.hourly} value={totals.hours ? euro(Math.round(totals.cost * 100 / totals.hours), locale) : "—"} />
        </section>
        <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-2xl border border-[#dce5e1] bg-white p-5">
            <SectionTitle eyebrow={t.costFlow} title={data.people.length ? `${data.people.length} ${t.people}` : t.noPeople} />
            <div className="mt-5 space-y-3">
              {data.people.map((person) => <article key={person.id} className="grid items-center gap-4 rounded-xl border border-[#e2e9e6] px-4 py-3 md:grid-cols-[1fr_auto_auto_auto]">
                <div><p className="font-medium text-[#203f36]">{person.name}</p><p className="text-xs text-[#71807a]">{person.locationName} · {employmentLabel(person.employmentType as PayrollEmploymentType, locale)}</p></div>
                <span className={`w-fit rounded-full px-2 py-1 text-xs font-medium ${person.annual ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{person.annual ? t.complete : t.incomplete}</span>
                <div className="text-right"><p className="text-xs text-[#71807a]">{t.annual}</p><p className="font-semibold tabular-nums text-[#173c32]">{person.annual ? euro(person.annual.annualEmployerCostCents, locale) : "—"}</p></div>
                <div className="text-right"><p className="text-xs text-[#71807a]">{t.hourly}</p><p className="font-semibold tabular-nums text-[#315c7b]">{person.annual ? euro(person.annual.directHourlyRateCents, locale) : "—"}</p></div>
              </article>)}
            </div>
          </div>
          <div className="rounded-2xl border border-[#d8cfba] bg-[#fffdf7] p-5">
            <SectionTitle eyebrow={t.closing} title={`${data.year}`} description={t.planningAid} />
            <Field label={t.month}><Input id="close-month" type="month" defaultValue={`${data.year}-07`} /></Field>
            <Button disabled={pending || getPayrollRuleSet(data.year).status !== "verified"} className="mt-4 w-full bg-[#173c32] text-white hover:bg-[#244f43]" onClick={() => {
              const value = (document.getElementById("close-month") as HTMLInputElement).value;
              run(() => closePersonnelMonth(value), t.monthClosed);
            }}><FileClock className="size-4" />{t.closeMonth}</Button>
            {getPayrollRuleSet(data.year).status !== "verified" && <p className="mt-3 flex items-center gap-2 text-sm text-amber-800"><CircleAlert className="size-4" />{t.postingBlocked}</p>}
          </div>
        </section>
      </div>}

      {tab === "people" && <PeoplePanel data={data} t={t} locale={locale} pending={pending} run={run} />}
      {tab === "calculator" && <CalculatorPanel t={t} locale={locale} calc={calc} setCalc={setCalc} annual={annual} monthly={monthly} scenarioName={scenarioName} setScenarioName={setScenarioName} scenarioEmployeeId={scenarioEmployeeId} setScenarioEmployeeId={setScenarioEmployeeId} people={data.people} locations={data.locations} pending={pending} save={() => annual && run(() => savePersonnelScenario({ name: scenarioName, employeeId: scenarioEmployeeId || null, planningYear: calc.year, input: { ...calc, ...employeePlanFromCalculator(calc, location?.id ?? "") }, result: annual as unknown as Record<string, unknown>, ruleVersion: annual.ruleVersion }), t.scenarioSaved)} />}
      {tab === "projects" && <ProjectsPanel data={data} t={t} locale={locale} pending={pending} run={run} />}
      {tab === "funding" && <FundingPanel data={data} t={t} locale={locale} pending={pending} run={run} />}
      {tab === "scenarios" && <ScenariosPanel data={data} t={t} locale={locale} pending={pending} run={run} currentAnnual={annual} />}
      {tab === "rules" && <RulesPanel data={data} t={t} />}
    </div>
  );
}

function Header({ t }: { t: Text }) {
  return <header className="relative overflow-hidden rounded-2xl bg-[#173c32] px-6 py-7 text-white">
    <div className="absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(135deg,transparent,rgba(255,255,255,0.08))]" />
    <div className="relative flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-[11px] font-semibold tracking-[0.16em] text-[#b9ccc5] uppercase">{t.planningAid}</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">{t.title}</h1><p className="mt-2 text-sm text-[#c7d7d1]">{t.subtitle}</p></div>
      <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs"><ShieldCheck className="size-4" />AT 2025–2027</div>
    </div>
  </header>;
}

function PeoplePanel({ data, t, locale, pending, run }: { data: PersonnelWorkspaceData; t: Text; locale: string; pending: boolean; run: (action: () => Promise<unknown>, success: string) => void }) {
  const [open, setOpen] = useState(false);
  const today = localDateInZone(new Date(), "Europe/Vienna");
  return <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
    <section className="rounded-2xl border border-[#dce5e1] bg-white p-5">
      <div className="flex items-center justify-between gap-3"><SectionTitle eyebrow={t.people} title={t.createPerson} /><Button variant="outline" aria-label={t.createPerson} aria-expanded={open} onClick={() => setOpen((value) => !value)}><Plus className="size-4" /></Button></div>
      {open && <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        run(() => upsertEmployeePlan({
          name: String(fd.get("name")),
          personnelNumber: String(fd.get("personnelNumber")),
          userId: String(fd.get("userId") || "") || null,
          birthDate: String(fd.get("birthDate") || "") || null,
          collectiveAgreement: String(fd.get("collectiveAgreement")),
          locationId: String(fd.get("locationId")),
          joinedOn: String(fd.get("joinedOn") || "") || null,
          leftOn: null,
          validFrom: String(fd.get("validFrom")),
          employmentType: String(fd.get("employmentType")) as PayrollEmploymentType,
          inputMode: "gross",
          monthlyAmountCents: money(String(fd.get("amount"))),
          weeklyMinutes: Math.round(Number(String(fd.get("weeklyHours")).replace(",", ".")) * 60),
          workdaysPerWeek: 5,
          specialPaymentsEnabled: true,
          holidayPayMonth: 6,
          christmasPayMonth: 11,
          vacationWeeksHundredths: 500,
          expectedSickHoursHundredths: 0,
          trainingHoursHundredths: 0,
          internalHoursHundredths: 0,
          overheadRateBasisPoints: 0,
          salesMarkupBasisPoints: 0,
          taxableBenefitsCents: 0,
          commuterAllowanceCents: 0,
          commuterEuroCents: 0,
          familyBonusCents: 0,
          soleEarnerCreditCents: 0,
          singleParentCreditCents: 0,
        }), t.personnelPlanSaved);
      }}>
        <Field label={t.person}><Input name="name" required /></Field>
        <Field label={t.personnelNumber}><Input name="personnelNumber" /></Field>
        <Field label={t.userAccount}><select name="userId" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"><option value="">—</option>{data.users.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
        <Field label={t.birthDate}><Input name="birthDate" type="date" /></Field>
        <Field label={t.collectiveAgreement}><Input name="collectiveAgreement" /></Field>
        <Field label={t.location}><select name="locationId" required className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">{data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
        <Field label={t.employmentType}><select name="employmentType" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">{(Object.keys(employmentLabels) as PayrollEmploymentType[]).map((value) => <option key={value} value={value}>{employmentLabel(value, locale)}</option>)}</select></Field>
        <Field label={t.joinedOn}><Input name="joinedOn" type="date" defaultValue={today} /></Field>
        <Field label={t.validFrom}><Input name="validFrom" type="date" defaultValue={today} required /></Field>
        <Field label={t.amount}><Input name="amount" inputMode="decimal" defaultValue="4500" required /></Field>
        <Field label={t.weeklyHours}><Input name="weeklyHours" inputMode="decimal" defaultValue="40" required /></Field>
        <Button type="submit" disabled={pending || data.locations.length === 0} className="sm:col-span-2 bg-[#173c32] text-white"><Save className="size-4" />{t.savePerson}</Button>
      </form>}
    </section>
    <section className="rounded-2xl border border-[#dce5e1] bg-white p-5">
      <SectionTitle eyebrow={t.people} title={`${data.people.length} ${t.people}`} />
      <div className="mt-4 divide-y divide-[#e7ecea]">{data.people.map((person) => <div key={person.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_auto_auto]"><div><p className="font-medium text-[#173c32]">{person.name}</p><p className="text-xs text-[#71807a]">{person.personnelNumber || "—"} · {person.collectiveAgreement || t.noCollectiveAgreement}</p></div><div className="text-right"><p className="text-xs text-[#71807a]">{t.annual}</p><p className="font-medium tabular-nums">{person.annual ? euro(person.annual.annualEmployerCostCents, locale) : "—"}</p></div><span className={`h-fit rounded-full px-2 py-1 text-xs ${person.annual ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{person.annual ? t.complete : t.incomplete}</span></div>)}</div>
    </section>
  </div>;
}

type CalculatorState = {
  year: number;
  inputMode: "gross" | "net";
  amount: string;
  employmentType: PayrollEmploymentType;
  locationId: string;
  weeklyHours: string;
  vacationWeeks: string;
  sickHours: string;
  trainingHours: string;
  internalHours: string;
  overhead: string;
  markup: string;
  specialPayments: boolean;
  taxableBenefits: string;
  commuterAllowance: string;
  commuterEuro: string;
  familyBonus: string;
};

function employeePlanFromCalculator(calc: CalculatorState, locationId: string) {
  return {
    name: "Szenario", personnelNumber: "", userId: null, birthDate: null, collectiveAgreement: "",
    locationId, joinedOn: `${calc.year}-01-01`, leftOn: null, validFrom: `${calc.year}-01-01`,
    employmentType: calc.employmentType, inputMode: calc.inputMode, monthlyAmountCents: money(calc.amount),
    weeklyMinutes: Math.round(Number(calc.weeklyHours.replace(",", ".")) * 60), workdaysPerWeek: 5,
    specialPaymentsEnabled: calc.specialPayments, holidayPayMonth: 6, christmasPayMonth: 11,
    vacationWeeksHundredths: Math.round(decimal(calc.vacationWeeks) * 100),
    expectedSickHoursHundredths: Math.round(decimal(calc.sickHours) * 100),
    trainingHoursHundredths: Math.round(decimal(calc.trainingHours) * 100),
    internalHoursHundredths: Math.round(decimal(calc.internalHours) * 100),
    overheadRateBasisPoints: Math.round(decimal(calc.overhead) * 100),
    salesMarkupBasisPoints: Math.round(decimal(calc.markup) * 100),
    taxableBenefitsCents: money(calc.taxableBenefits), commuterAllowanceCents: money(calc.commuterAllowance),
    commuterEuroCents: money(calc.commuterEuro), familyBonusCents: money(calc.familyBonus),
    soleEarnerCreditCents: 0, singleParentCreditCents: 0,
  };
}
function CalculatorPanel({ t, locale, calc, setCalc, annual, monthly, scenarioName, setScenarioName, scenarioEmployeeId, setScenarioEmployeeId, people, locations, pending, save }: {
  t: Text; locale: string; calc: CalculatorState; setCalc: React.Dispatch<React.SetStateAction<CalculatorState>>;
  annual: ReturnType<typeof calculateAnnualPersonnelCost> | null; monthly: ReturnType<typeof calculatePayroll> | null;
  scenarioName: string; setScenarioName: (value: string) => void; scenarioEmployeeId: string; setScenarioEmployeeId: (value: string) => void;
  people: PersonnelWorkspaceData["people"]; locations: PersonnelWorkspaceData["locations"]; pending: boolean; save: () => void;
}) {
  const update = <K extends keyof typeof calc>(key: K, value: (typeof calc)[K]) => setCalc((current) => ({ ...current, [key]: value }));
  return <div className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]">
    <section className="rounded-2xl border border-[#dce5e1] bg-white p-5">
      <SectionTitle eyebrow={t.calculator} title={t.calculate} />
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Field label={t.year}><select value={calc.year} onChange={(e) => update("year", Number(e.target.value))} className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"><option>2025</option><option>2026</option><option>2027</option></select></Field>
        <Field label={t.inputAs}><select value={calc.inputMode} onChange={(e) => update("inputMode", e.target.value as "gross" | "net")} className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"><option value="gross">{t.gross}</option><option value="net">{t.net}</option></select></Field>
        <Field label={t.amount}><Input value={calc.amount} onChange={(e) => update("amount", e.target.value)} inputMode="decimal" /></Field>
        <Field label={t.employmentType}><select value={calc.employmentType} onChange={(e) => update("employmentType", e.target.value as PayrollEmploymentType)} className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">{(Object.keys(employmentLabels) as PayrollEmploymentType[]).map((value) => <option key={value} value={value}>{employmentLabel(value, locale)}</option>)}</select></Field>
        <Field label={t.location}><select value={calc.locationId} onChange={(e) => update("locationId", e.target.value)} className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">{locations.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.state}</option>)}</select></Field>
        {(["weeklyHours", "vacationWeeks", "sickHours", "trainingHours", "internalHours", "overhead", "markup"] as const).map((key) => <Field key={key} label={t[key]}><Input value={calc[key]} onChange={(e) => update(key, e.target.value)} inputMode="decimal" /></Field>)}
        {(["taxableBenefits", "commuterAllowance", "commuterEuro", "familyBonus"] as const).map((key) => <Field key={key} label={t[key]}><Input value={calc[key]} onChange={(e) => update(key, e.target.value)} inputMode="decimal" /></Field>)}
        <div className="sm:col-span-2"><SwitchLike checked={calc.specialPayments} onChange={(value) => update("specialPayments", value)} label={t.specialPayments} /></div>
      </div>
    </section>
    <section className="overflow-hidden rounded-2xl border border-[#cbdad4] bg-white">
      <div className="border-b border-[#dce5e1] bg-[#edf4f1] px-5 py-4"><SectionTitle eyebrow={t.costFlow} title={annual ? euro(annual.annualEmployerCostCents, locale) : "—"} description={annual?.ruleVersion} /></div>
      {monthly && annual && <div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-2 px-5 py-6">
          <Flow label={t.gross} value={euro(monthly.grossCents, locale)} /><ArrowRight className="size-4 text-[#9aada6]" />
          <Flow label={t.net} value={euro(monthly.netCents, locale)} /><ArrowRight className="size-4 text-[#9aada6]" />
          <Flow label={t.levies} value={euro(monthly.employerTotalCents - monthly.grossCents, locale)} /><ArrowRight className="size-4 text-[#9aada6]" />
          <Flow label={t.employer} value={euro(monthly.employerTotalCents, locale)} strong />
        </div>
        <div className="grid gap-px border-y border-[#e2e9e6] bg-[#e2e9e6] sm:grid-cols-2">
          <Breakdown label={t.svEmployee} value={monthly.components.employeeSv.amountCents} locale={locale} />
          <Breakdown label={t.wageTax} value={monthly.components.wageTax.amountCents} locale={locale} />
          <Breakdown label={t.svEmployer} value={monthly.employerSocialCents} locale={locale} />
          <Breakdown label={t.statutoryLevies} value={monthly.components.db.amountCents + monthly.components.dz.amountCents + monthly.components.municipalTax.amountCents + monthly.components.bvContribution.amountCents} locale={locale} />
        </div>
        <div className="grid gap-4 bg-[#173c32] p-5 text-white sm:grid-cols-4">
          <MetricDark label={t.annual} value={euro(annual.annualEmployerCostCents, locale)} />
          <MetricDark label={t.productive} value={`${number(annual.productiveHoursHundredths / 100, locale)} h`} />
          <MetricDark label={t.fullRate} value={euro(annual.fullHourlyRateCents, locale)} />
          <MetricDark label={t.salesRate} value={euro(annual.salesHourlyRateCents, locale)} />
        </div>
        <div className="grid gap-2 p-5 sm:grid-cols-[1fr_1fr_auto]"><Input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} aria-label={t.scenarioName} /><select aria-label={t.person} value={scenarioEmployeeId} onChange={(e) => setScenarioEmployeeId(e.target.value)} className="h-9 rounded-md border bg-transparent px-3 text-sm"><option value="">{t.prospectivePerson}</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><Button variant="outline" disabled={pending || !scenarioName.trim()} onClick={save}><Sparkles className="size-4" />{t.saveScenario}</Button></div>
      </div>}
    </section>
  </div>;
}

function Flow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={`min-w-0 ${strong ? "rounded-xl bg-[#173c32] px-3 py-3 text-white" : ""}`}><p className={`text-[10px] font-semibold tracking-[0.08em] uppercase ${strong ? "text-white/60" : "text-[#71807a]"}`}>{label}</p><p className="mt-1 truncate text-base font-semibold tabular-nums">{value}</p></div>;
}
function Breakdown({ label, value, locale }: { label: string; value: number; locale: string }) {
  return <div className="flex items-center justify-between bg-white px-5 py-3 text-sm"><span className="text-[#50635d]">{label}</span><strong className="tabular-nums text-[#173c32]">{euro(value, locale)}</strong></div>;
}
function MetricDark({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-semibold tracking-[0.08em] text-white/55 uppercase">{label}</p><p className="mt-1 font-semibold tabular-nums">{value}</p></div>;
}

function ProjectsPanel({ data, t, locale, pending, run }: PanelProps) {
  const ready = data.people.filter((row) => row.annual);
  return <div className="grid gap-5 lg:grid-cols-[0.65fr_1.35fr]"><section className="rounded-2xl border border-[#dce5e1] bg-white p-5"><SectionTitle eyebrow={t.projects} title={t.allocate} /><form className="mt-5 space-y-3" onSubmit={(event) => {
    event.preventDefault(); const fd = new FormData(event.currentTarget); const person = ready.find((row) => row.id === fd.get("employeeId"));
    if (!person?.annual) return;
    const costRateCents = person.annual.fullHourlyRateCents;
    run(() => upsertProjectHourAllocation({ employeeId: person.id, projectId: String(fd.get("projectId")), payrollMonth: String(fd.get("month")), plannedMinutes: Math.round(Number(fd.get("hours")) * 60), costRateCents }), t.allocationSaved);
  }}><Field label={t.person}><select name="employeeId" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">{ready.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field><Field label={t.projects}><select name="projectId" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">{data.projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field><Field label={t.month}><Input name="month" type="month" defaultValue={`${data.year}-07`} required /></Field><Field label={t.hours}><Input name="hours" type="number" step="0.25" defaultValue="40" required /></Field><Button type="submit" disabled={pending || ready.length === 0 || data.projects.length === 0} className="w-full bg-[#315c7b] text-white"><CalendarClock className="size-4" />{t.allocate}</Button></form></section><AllocationTable data={data} locale={locale} t={t} /></div>;
}

function AllocationTable({ data, locale, t }: { data: PersonnelWorkspaceData; locale: string; t: Text }) {
  const groups = new Map<string, typeof data.allocations>();
  for (const row of data.allocations) { const key = `${row.employeeId}:${row.payrollMonth}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return <section className="rounded-2xl border border-[#dce5e1] bg-white p-5"><SectionTitle eyebrow={t.capacity} title={t.projects} /><div className="mt-4 space-y-4">{[...groups.values()].map((rows) => {
    const person = data.people.find((candidate) => candidate.id === rows[0].employeeId);
    const monthlyCapacity = person?.annual ? Math.round(person.annual.productiveHoursHundredths / 12 / 100 * 60) : 9_600;
    const allocation = allocatePlannedProjectCosts(rows.map((row) => ({ projectId: row.projectId, plannedMinutes: row.plannedMinutes, costRateCents: row.costRateCents })), monthlyCapacity);
    return <article key={`${rows[0].employeeId}:${rows[0].payrollMonth}`} className={`rounded-xl border p-4 ${allocation.overbooked ? "border-amber-300 bg-amber-50/40" : "border-[#e2e9e6]"}`}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium text-[#173c32]">{rows[0].employeeName} · {rows[0].payrollMonth}</p><p className="text-xs text-[#71807a]">{t.remaining}: {number(allocation.remainingMinutes / 60, locale)} h</p></div><span className={`rounded-full px-2 py-1 text-xs font-medium ${allocation.overbooked ? "bg-amber-100 text-amber-900" : "bg-blue-50 text-[#315c7b]"}`}>{allocation.overbooked ? t.overbooked : t.capacity}</span></div><div className="mt-3 space-y-2">{rows.map((row) => <div key={row.id} className="grid grid-cols-[1fr_auto_auto] gap-4 text-sm"><span>{row.projectName}</span><span className="tabular-nums">{number(row.plannedMinutes / 60, locale)} h</span><strong className="tabular-nums">{euro(Math.round(row.plannedMinutes * row.costRateCents / 60), locale)}</strong></div>)}</div></article>;
  })}{!groups.size && <p className="text-sm text-[#71807a]">{t.noPeople}</p>}</div></section>;
}

type PanelProps = { data: PersonnelWorkspaceData; t: Text; locale: string; pending: boolean; run: (action: () => Promise<unknown>, success: string) => void };
function FundingPanel({ data, t, locale, pending, run }: PanelProps) {
  const estimates = data.fundingLinks.flatMap((link) => {
    const profile = data.fundingProfiles.find((row) => row.id === link.fundingProfileId);
    const rows = data.allocations.filter((row) => row.projectId === link.projectId);
    if (!profile) return [];
    return rows.flatMap((row) => {
      const person = data.people.find((candidate) => candidate.id === row.employeeId);
      if (!person?.annual) return [];
      const result = applyFundingProfile({
        annualEmployerCostCents: person.annual.annualEmployerCostCents,
        productiveHoursHundredths: person.annual.productiveHoursHundredths,
        plannedHoursHundredths: Math.round(row.plannedMinutes / 60 * 100),
        profile: { ...profile, eligibleComponents: profile.eligibleComponentsJson },
      });
      return [{ key: `${link.id}:${row.id}`, person: person.name, project: row.projectName, profile: profile.name, result }];
    });
  });
  return <div className="space-y-5"><div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border border-[#dce5e1] bg-white p-5"><SectionTitle eyebrow={t.funding} title={t.fundingProfiles} /><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const fd = new FormData(event.currentTarget); run(() => upsertFundingCostProfile({ name: String(fd.get("name")), version: String(fd.get("version")), validFrom: String(fd.get("validFrom")), validTo: null, divisorMode: String(fd.get("divisorMode")) as "productive_hours" | "fixed", fixedAnnualDivisor: Number(fd.get("fixedDivisor")) || null, eligibleComponents: ["gross", "employerSocial", "statutoryLevies"], hourlyCapCents: money(String(fd.get("hourlyCap"))) || null, maxAnnualHoursHundredths: Math.round(Number(fd.get("maxHours")) * 100) || null, overheadRateBasisPoints: Math.round(Number(fd.get("overhead")) * 100), roundingMode: "cent" }), t.fundingProfileSaved); }}><Field label={t.profileName}><Input name="name" required /></Field><Field label={t.version}><Input name="version" defaultValue="1.0" required /></Field><Field label={t.validFrom}><Input name="validFrom" type="date" defaultValue={`${data.year}-01-01`} required /></Field><Field label={t.divisor}><select name="divisorMode" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"><option value="productive_hours">{t.productive}</option><option value="fixed">{t.fixed}</option></select></Field><Field label={t.fixedDivisor}><Input name="fixedDivisor" type="number" defaultValue="1720" /></Field><Field label={t.hourlyCap}><Input name="hourlyCap" inputMode="decimal" /></Field><Field label={t.maxHours}><Input name="maxHours" type="number" /></Field><Field label={t.overhead}><Input name="overhead" defaultValue="0" /></Field><Button type="submit" disabled={pending} className="sm:col-span-2"><Landmark className="size-4" />{t.createProfile}</Button></form></section><section className="rounded-2xl border border-[#dce5e1] bg-white p-5"><SectionTitle eyebrow={t.funding} title={t.linkProject} /><form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); const fd = new FormData(event.currentTarget); run(() => linkPersonnelFundingProject({ projectId: String(fd.get("projectId")), fundingProjectId: String(fd.get("fundingProjectId")), fundingProfileId: String(fd.get("profileId")) || null }), t.fundingProjectLinked); }}><Field label={t.projects}><select name="projectId" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">{data.projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field><Field label={t.fundingProject}><select name="fundingProjectId" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">{data.fundingProjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field><Field label={t.fundingProfiles}><select name="profileId" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"><option value="">—</option>{data.fundingProfiles.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.version}</option>)}</select></Field><Button type="submit" disabled={pending || data.projects.length === 0 || data.fundingProjects.length === 0} className="w-full"><BriefcaseBusiness className="size-4" />{t.linkProject}</Button></form><div className="mt-5 space-y-2">{data.fundingProfiles.map((profile) => <div key={profile.id} className="rounded-xl border border-[#e2e9e6] p-3"><div className="flex justify-between"><strong className="text-sm text-[#173c32]">{profile.name}</strong><span className="text-xs text-[#71807a]">{profile.version}</span></div><p className="mt-1 text-xs text-[#71807a]">{profile.divisorMode === "fixed" ? `${profile.fixedAnnualDivisor} h` : t.productive} · {t.overhead} {profile.overheadRateBasisPoints / 100} %</p></div>)}</div></section></div>{estimates.length > 0 && <section className="rounded-2xl border border-[#dce5e1] bg-white p-5"><SectionTitle eyebrow={t.funding} title={t.eligiblePlannedCosts} /><div className="mt-4 divide-y">{estimates.map((row) => <div key={row.key} className="grid gap-2 py-3 sm:grid-cols-[1fr_1fr_auto]"><div><p className="font-medium text-[#173c32]">{row.person}</p><p className="text-xs text-[#71807a]">{row.project} · {row.profile}</p></div><span className="text-sm tabular-nums">{row.result.eligibleHoursHundredths / 100} h × {euro(row.result.eligibleHourlyRateCents, locale)}</span><strong className="text-right tabular-nums text-[#173c32]">{euro(row.result.totalEligibleCents, locale)}</strong></div>)}</div></section>}</div>;
}

function ScenariosPanel({ data, t, locale, pending, run, currentAnnual }: PanelProps & { currentAnnual: ReturnType<typeof calculateAnnualPersonnelCost> | null }) {
  return <section className="rounded-2xl border border-[#dce5e1] bg-white p-5"><SectionTitle eyebrow={t.scenarios} title={t.saveScenario} /><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.scenarios.map((scenario) => {
    const result = scenario.resultJson as { annualEmployerCostCents?: number; directHourlyRateCents?: number };
    const delta = currentAnnual && result.annualEmployerCostCents ? result.annualEmployerCostCents - currentAnnual.annualEmployerCostCents : null;
    return <article key={scenario.id} className="rounded-xl border border-[#e2e9e6] p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-medium text-[#173c32]">{scenario.name}</p><p className="text-xs text-[#71807a]">{scenario.ruleVersion} · {scenario.planningYear}</p></div><Sparkles className="size-4 text-[#9a5b13]" /></div><p className="mt-4 text-xl font-semibold tabular-nums text-[#173c32]">{euro(result.annualEmployerCostCents ?? 0, locale)}</p>{delta !== null && <p className={`mt-1 text-xs ${delta > 0 ? "text-amber-800" : "text-emerald-800"}`}>{delta > 0 ? "+" : ""}{euro(delta, locale)} {t.liveComparison}</p>}{scenario.employeeId && <Button size="sm" variant="outline" className="mt-4 w-full" disabled={pending} onClick={() => run(() => activatePersonnelScenario(scenario.id), t.scenarioActivated)}><CheckCircle2 className="size-4" />{t.activate}</Button>}</article>;
  })}</div></section>;
}

function RulesPanel({ data, t }: { data: PersonnelWorkspaceData; t: Text }) {
  return <section className="rounded-2xl border border-[#dce5e1] bg-white p-5"><SectionTitle eyebrow={t.rules} title="AT 2025–2027" description={t.ruleDescription} /><div className="mt-5 grid gap-4 md:grid-cols-3">{data.rules.map((rule) => <article key={rule.version} className={`rounded-xl border p-4 ${rule.status === "forecast" ? "border-amber-300 bg-amber-50/40" : "border-emerald-200 bg-emerald-50/30"}`}><div className="flex items-center justify-between"><BadgeEuro className={rule.status === "forecast" ? "text-amber-700" : "text-emerald-700"} /><span className={`rounded-full px-2 py-1 text-xs font-medium ${rule.status === "forecast" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{rule.status === "forecast" ? t.forecast : t.verified}</span></div><h3 className="mt-4 font-semibold text-[#173c32]">{rule.label}</h3><p className="mt-1 text-xs text-[#71807a]">{rule.version}</p><ul className="mt-3 space-y-1 text-xs text-[#5f706a]">{rule.assumptions.map((item) => <li key={item}>• {item}</li>)}</ul><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">{rule.references.map((reference) => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#315c7b] underline-offset-2 hover:underline">{reference.label}</a>)}</div>{rule.status === "forecast" && <p className="mt-3 flex items-center gap-2 text-xs font-medium text-amber-800"><CircleAlert className="size-4" />{t.postingBlocked}</p>}</article>)}</div></section>;
}
