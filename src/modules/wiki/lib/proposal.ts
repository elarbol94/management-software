import type { TiptapNode } from "./tiptap";

export type ProposalWorkspaceData = {
  company: { name: string; address: string; uid: string };
  people: Array<{ id: string; name: string; role: string }>;
  fundingProjects: Array<{
    id: string;
    name: string;
    programme: string;
    fundingBody: string;
    start: string | null;
    end: string | null;
    totalCostCents: number;
    approvedFundingCents: number;
  }>;
};

function text(value: string): TiptapNode[] {
  return value ? [{ type: "text", text: value }] : [];
}

function cell(value: string, header = false): TiptapNode {
  return {
    type: header ? "markdownTableHeader" : "markdownTableCell",
    attrs: { alignment: header ? "left" : "left", widthPercent: null },
    content: [{ type: "paragraph", content: text(value) }],
  };
}

export function proposalTable(
  kind: "generic" | "budget" | "workPackages" | "timeline" | "risks" | "kpis" | "team",
  rows?: string[][],
): TiptapNode {
  const presets: Record<typeof kind, string[][]> = {
    generic: [["Column 1", "Column 2", "Column 3"], ["", "", ""]],
    budget: [["Cost item", "Work package", "Quantity", "Unit price", "Total", "Eligible"], ["Personnel", "WP1", "1", "€ 0.00", "€ 0.00", "€ 0.00"]],
    workPackages: [["WP", "Objective", "Activities", "Lead", "Deliverable", "Period"], ["WP1", "", "", "", "", "M1–M3"]],
    timeline: [["Milestone", "Owner", "Due", "Evidence"], ["M1", "", "", ""]],
    risks: [["Risk", "Likelihood", "Impact", "Mitigation", "Owner"], ["", "Medium", "Medium", "", ""]],
    kpis: [["KPI", "Baseline", "Target", "Measurement", "Due"], ["", "", "", "", ""]],
    team: [["Name", "Role", "Responsibility"], ["", "", ""]],
  };
  const values = rows?.length ? rows : presets[kind];
  return {
    type: "markdownTable",
    attrs: { tableId: `${kind}-${crypto.randomUUID()}`, caption: "", includeInTableIndex: true },
    content: values.map((row, rowIndex) => ({
      type: "markdownTableRow",
      content: row.map((value) => cell(value, rowIndex === 0)),
    })),
  };
}

export function formatEuro(cents: number) {
  return new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function proposalSectionSnippet(kind: "executiveSummary" | "objectives" | "deliverables" | "assumptions" | "decision"): TiptapNode[] {
  const snippets: Record<typeof kind, [string, string]> = {
    executiveSummary: ["Executive summary", "Summarise the need, proposed solution, expected impact, budget, and decision required."],
    objectives: ["Objectives and outcomes", "Define measurable objectives, target groups, indicators, and the intended long-term outcome."],
    deliverables: ["Deliverables and milestones", "List each deliverable, its owner, acceptance evidence, and due date."],
    assumptions: ["Assumptions and exclusions", "State the assumptions, dependencies, constraints, and work explicitly outside the scope."],
    decision: ["Decision requested", "State the exact approval or commitment required, by whom, and by when."],
  };
  const [heading, guidance] = snippets[kind];
  return [
    { type: "heading", attrs: { level: 1, id: kind + "-" + crypto.randomUUID() }, content: text(heading) },
    { type: "paragraph", content: text(guidance) },
  ];
}

export function proposalStarterContent(kind: "funding" | "project" | "business" | "client" | "investor" | "partnership"): TiptapNode {
  const definitions: Record<typeof kind, Array<[string, string, string, TiptapNode?]>> = {
    funding: [
      ["executive-summary", "Kurzfassung", "Beschreiben Sie Problem, Lösung, Wirkung und Förderbedarf auf einer Seite."],
      ["applicant", "Antragsteller und Team", "Stellen Sie Organisation, Qualifikation und Rollen vor.", proposalTable("team")],
      ["need", "Ausgangslage und Bedarf", "Belegen Sie den Bedarf mit Daten und Quellen."],
      ["objectives", "Ziele und Wirkung", "Formulieren Sie messbare Ziele und Zielgruppen."],
      ["work-packages", "Arbeitspakete", "Strukturieren Sie Umsetzung, Verantwortliche und Ergebnisse.", proposalTable("workPackages")],
      ["budget", "Budget und Finanzierung", "Begründen Sie alle Kosten und deren Förderfähigkeit.", proposalTable("budget")],
      ["risks", "Risiken und Maßnahmen", "Benennen Sie die wichtigsten Risiken und Gegenmaßnahmen.", proposalTable("risks")],
      ["sustainability", "Nachhaltigkeit", "Erläutern Sie die Fortführung nach Projektende."],
    ],
    project: [
      ["summary", "Executive summary", "State the decision, outcome, scope, cost, and timing."],
      ["problem", "Problem and opportunity", "Describe the current situation and evidence."],
      ["scope", "Scope and deliverables", "Define what is included and explicitly excluded."],
      ["work-packages", "Work packages", "Break the delivery into accountable packages.", proposalTable("workPackages")],
      ["timeline", "Milestones", "Set the critical milestones and evidence of completion.", proposalTable("timeline")],
      ["budget", "Budget", "Show the cost basis and assumptions.", proposalTable("budget")],
      ["risks", "Risks", "Describe the highest-impact uncertainties.", proposalTable("risks")],
      ["decision", "Decision requested", "Make the requested approval explicit."],
    ],
    business: [
      ["summary", "Executive summary", "Summarise the venture, traction, ask, and expected outcome."],
      ["market", "Market and customer", "Define the customer, pain point, market size, and alternatives."],
      ["solution", "Product and value proposition", "Explain the product and why it wins."],
      ["business-model", "Business model", "Describe pricing, margins, acquisition, and retention."],
      ["go-to-market", "Go-to-market", "Set channels, milestones, and owners."],
      ["team", "Team", "Show responsibilities and relevant experience.", proposalTable("team")],
      ["financials", "Financial plan", "State assumptions, runway, use of funds, and scenarios.", proposalTable("budget")],
      ["risks", "Risks and mitigations", "Address execution, market, regulatory, and financing risks.", proposalTable("risks")],
    ],
    client: [
      ["understanding", "Your situation", "Confirm the client’s needs and desired outcome."],
      ["solution", "Proposed solution", "Describe the approach in outcome-oriented language."],
      ["scope", "Scope and deliverables", "List deliverables, assumptions, and exclusions."],
      ["timeline", "Timeline", "Show milestones and client dependencies.", proposalTable("timeline")],
      ["investment", "Investment", "Present pricing, payment schedule, and validity.", proposalTable("budget")],
      ["next-steps", "Next steps", "State how the proposal is accepted and what happens next."],
    ],
    investor: [
      ["thesis", "Investment thesis", "Explain the opportunity and why now."],
      ["traction", "Traction", "Show validated demand and the metrics that matter.", proposalTable("kpis")],
      ["market", "Market", "Define the reachable market and competitive position."],
      ["model", "Business model", "Explain unit economics and scale."],
      ["team", "Team", "Connect experience to the risks being solved.", proposalTable("team")],
      ["ask", "Funding ask and use of funds", "State amount, runway, milestones, and allocation.", proposalTable("budget")],
    ],
    partnership: [
      ["opportunity", "Shared opportunity", "Describe the mutual customer or mission outcome."],
      ["contribution", "Contributions", "Define what each partner provides."],
      ["operating-model", "Operating model", "Set roles, governance, communication, and decisions."],
      ["work-plan", "Joint work plan", "Plan packages, owners, and outputs.", proposalTable("workPackages")],
      ["commercials", "Commercial model", "Explain costs, revenue, IP, and liabilities."],
      ["next-steps", "Next steps", "List the decisions and owners required to begin."],
    ],
  };
  return {
    type: "doc",
    content: definitions[kind].flatMap(([id, heading, guidance, block]) => [
      { type: "heading", attrs: { level: 1, id }, content: text(heading) },
      { type: "paragraph", content: text(guidance) },
      ...(block ? [block] : []),
    ]),
  };
}
