import type {
  InvestmentTaskAreaId,
  InvestmentTypeId,
  MunicipalityInvestmentData,
  MunicipalityInvestmentIndex,
} from "./investments";

export type InvestmentHtmlLocale = "de" | "en";

type HtmlLabels = {
  lang: string;
  title: string;
  eyebrow: string;
  subtitle: string;
  allYears: string;
  allTaskAreas: string;
  allInvestmentTypes: string;
  allStates: string;
  year: string;
  taskArea: string;
  investmentType: string;
  minimum: string;
  search: string;
  searchPlaceholder: string;
  directInvestments: string;
  positions: string;
  investiveInflows: string;
  investiveBalance: string;
  assetDetails: string;
  averagePosition: string;
  activeFilters: string;
  resetFilters: string;
  typeBreakdown: string;
  assetMatched: string;
  assetAmbiguous: string;
  linkedAssets: string;
  noAssetDetails: string;
  ambiguousAssetDetails: string;
  exactlyMatched: string;
  assetAddition: string;
  assetDisposal: string;
  openingBalance: string;
  closingBalance: string;
  projectHistory: string;
  trend: string;
  breakdown: string;
  details: string;
  noResults: string;
  amount: string;
  description: string;
  project: string;
  sourceDetail: string;
  detailed: string;
  aggregated: string;
  correction: string;
  methodology: string;
  methodologyText: string;
  source: string;
  coverage: string;
  indexTitle: string;
  indexSubtitle: string;
  municipality: string;
  state: string;
  latestYear: string;
  totalPeriod: string;
  open: string;
  completeCoverage: string;
  missingYears: string;
  unavailableTitle: string;
  noReliableData: string;
  taskAreas: Record<InvestmentTaskAreaId, string>;
  investmentTypes: Record<InvestmentTypeId, string>;
};

const taskAreasDe: HtmlLabels["taskAreas"] = {
  "0": "Vertretungskörper und allgemeine Verwaltung",
  "1": "Öffentliche Ordnung und Sicherheit",
  "2": "Unterricht, Erziehung, Sport und Wissenschaft",
  "3": "Kunst, Kultur und Kultus",
  "4": "Soziale Wohlfahrt und Wohnbauförderung",
  "5": "Gesundheit",
  "6": "Straßen- und Wasserbau, Verkehr",
  "7": "Wirtschaftsförderung",
  "8": "Dienstleistungen",
  "9": "Finanzwirtschaft",
};

const taskAreasEn: HtmlLabels["taskAreas"] = {
  "0": "Representative bodies and general administration",
  "1": "Public order and safety",
  "2": "Education, sport and science",
  "3": "Arts, culture and religious affairs",
  "4": "Social welfare and housing support",
  "5": "Health",
  "6": "Road and water construction, transport",
  "7": "Economic development",
  "8": "Services",
  "9": "Financial administration",
};

const investmentTypesDe: HtmlLabels["investmentTypes"] = {
  "3411": "Immaterielles Vermögen",
  "3412": "Grundstücke und Infrastruktur",
  "3413": "Gebäude und Bauten",
  "3414": "Technische Anlagen, Fahrzeuge und Maschinen",
  "3415": "Amts-, Betriebs- und Geschäftsausstattung",
  "3416": "Kulturgüter",
  "3417": "Beteiligungen",
};

const investmentTypesEn: HtmlLabels["investmentTypes"] = {
  "3411": "Intangible assets",
  "3412": "Land and infrastructure",
  "3413": "Buildings and structures",
  "3414": "Technical equipment, vehicles and machinery",
  "3415": "Office, operating and business equipment",
  "3416": "Cultural assets",
  "3417": "Equity interests",
};

export function investmentHtmlLabels(locale: InvestmentHtmlLocale): HtmlLabels {
  if (locale === "en") return {
    lang: "en", title: "Purchases and investments", eyebrow: "Municipal finances",
    subtitle: "Direct investment positions from final accounts, MVAG 3411–3417.", allYears: "All years", allTaskAreas: "All task areas", allInvestmentTypes: "All investment types", allStates: "All states",
    year: "Year", taskArea: "Task area", investmentType: "Investment type", minimum: "Minimum amount (€)",
    search: "Search", searchPlaceholder: "Description, project or code…", directInvestments: "Direct investments",
    positions: "Account positions", investiveInflows: "Investive inflows", investiveBalance: "Investive balance",
    assetDetails: "Positions with asset details", averagePosition: "Average per position", activeFilters: "Active filters", resetFilters: "Reset all filters", typeBreakdown: "Breakdown by investment type", assetMatched: "Asset detail", assetAmbiguous: "Assignment unclear", linkedAssets: "Linked assets", noAssetDetails: "No uniquely assignable asset details are available.", ambiguousAssetDetails: "Multiple assignments are possible; no asset detail is shown as confirmed.", exactlyMatched: "Exactly reconciled", assetAddition: "Addition", assetDisposal: "Disposal", openingBalance: "Opening carrying amount", closingBalance: "Closing carrying amount", projectHistory: "Same project in other years",
    trend: "Investment trend", breakdown: "Breakdown by task area", details: "Investment positions",
    noResults: "No positions match the selected filters.", amount: "Amount", description: "Description",
    project: "Project code", sourceDetail: "Source detail", detailed: "Municipality detail", aggregated: "Aggregated",
    correction: "Correction", methodology: "Source and methodology",
    methodologyText: "A position is an account position, not necessarily an individual purchase contract. Asset details are included only from approved asset classes when VHH balances and assignments reconcile exactly and uniquely. Supplier, invoice and contract details are not contained in the sources.",
    source: "Source", coverage: "Coverage", indexTitle: "Municipality investments", indexSubtitle: "Offline overview of available municipality pages, 2010–2024.",
    municipality: "Municipality", state: "State", latestYear: "Latest year", totalPeriod: "Total 2010–2024", open: "Open",
    completeCoverage: "complete", missingYears: "missing", unavailableTitle: "Municipalities without reliable investment data", noReliableData: "No reliable investment data",
    taskAreas: taskAreasEn, investmentTypes: investmentTypesEn,
  };
  return {
    lang: "de", title: "Anschaffungen und Investitionen", eyebrow: "Gemeindefinanzen",
    subtitle: "Direkte Investitionspositionen aus Rechnungsabschlüssen, MVAG 3411–3417.", allYears: "Alle Jahre", allTaskAreas: "Alle Aufgabenbereiche", allInvestmentTypes: "Alle Investitionsarten", allStates: "Alle Bundesländer",
    year: "Jahr", taskArea: "Aufgabenbereich", investmentType: "Investitionsart", minimum: "Mindestbetrag (€)",
    search: "Suchen", searchPlaceholder: "Bezeichnung, Vorhaben oder Code…", directInvestments: "Direkte Investitionen",
    positions: "Kontopositionen", investiveInflows: "Investive Einzahlungen", investiveBalance: "Investiver Saldo",
    assetDetails: "Positionen mit Vermögensdetails", averagePosition: "Durchschnitt pro Position", activeFilters: "Aktive Filter", resetFilters: "Alle Filter zurücksetzen", typeBreakdown: "Verteilung nach Investitionsart", assetMatched: "Vermögensdetail", assetAmbiguous: "Zuordnung unklar", linkedAssets: "Verknüpfte Vermögensobjekte", noAssetDetails: "Keine eindeutig zuordenbaren Vermögensdetails verfügbar.", ambiguousAssetDetails: "Mehrere Zuordnungen sind möglich; daher werden keine Details als gesichert dargestellt.", exactlyMatched: "Eindeutig abgestimmt", assetAddition: "Zugang", assetDisposal: "Abgang", openingBalance: "Anfangsbuchwert", closingBalance: "Schlussbuchwert", projectHistory: "Dasselbe Vorhaben in anderen Jahren",
    trend: "Investitionsverlauf", breakdown: "Verteilung nach Aufgabenbereich", details: "Investitionspositionen",
    noResults: "Für die gewählten Filter wurden keine Positionen gefunden.", amount: "Betrag", description: "Bezeichnung",
    project: "Vorhabencode", sourceDetail: "Quelldetail", detailed: "Gemeindedetail", aggregated: "Aggregiert",
    correction: "Berichtigung", methodology: "Quelle und Methodik",
    methodologyText: "Eine Position ist eine Haushalts- bzw. Kontoposition und nicht zwingend ein einzelner Kaufvertrag. Vermögensdetails stammen nur aus freigegebenen Anlageklassen und werden ausschließlich bei centgenauem, eindeutigem Abgleich gezeigt. Lieferanten-, Rechnungs- und Vertragsdaten fehlen in den Quellen.",
    source: "Quelle", coverage: "Datenabdeckung", indexTitle: "Investitionen der Gemeinden", indexSubtitle: "Offline-Übersicht der verfügbaren Gemeindeseiten 2010–2024.",
    municipality: "Gemeinde", state: "Bundesland", latestYear: "Letztes Jahr", totalPeriod: "Summe 2010–2024", open: "Öffnen",
    completeCoverage: "vollständig", missingYears: "fehlt", unavailableTitle: "Gemeinden ohne belastbare Investitionsdaten", noReliableData: "Keine belastbaren Investitionsdaten",
    taskAreas: taskAreasDe, investmentTypes: investmentTypesDe,
  };
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function embeddedJson(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function slug(value: string) {
  return value.toLocaleLowerCase("de-AT").replaceAll("ß", "ss").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gemeinde";
}

export function municipalityInvestmentHtmlFilename(code: string, name: string) {
  return `${code}-${slug(name)}.html`;
}

const sharedStyles = `
:root{color-scheme:light;--bg:#f4f7f6;--card:#fff;--ink:#15201d;--muted:#63706c;--line:#dbe4e1;--teal:#087f6b;--teal2:#bce6dc;--red:#b42318;--shadow:0 12px 32px rgba(21,32,29,.07)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--teal)}button,input,select{font:inherit}.wrap{width:min(1440px,calc(100% - 32px));margin:0 auto;padding:34px 0 56px}.eyebrow{margin:0;color:var(--teal);font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}h1{margin:4px 0 8px;font-size:clamp(28px,4vw,46px);line-height:1.06}h2{margin:0 0 16px;font-size:19px}.muted{color:var(--muted)}.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.chip,.badge{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;background:#fff;padding:5px 9px;font-size:12px}.badge.detail{background:#ebfaf6;color:#056a58}.badge.aggregate{background:#f1f3f2;color:#53605c}.badge.negative{background:#fff0ee;color:var(--red)}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:24px 0}.card,.panel{border:1px solid var(--line);border-radius:18px;background:var(--card);box-shadow:var(--shadow)}.card{padding:18px}.card strong{display:block;margin-top:5px;font-size:25px;font-variant-numeric:tabular-nums}.panel{padding:20px;margin-top:14px}.filters{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.field{display:grid;gap:5px}.field label{font-size:12px;font-weight:700;color:var(--muted)}input,select{min-width:0;width:100%;height:40px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:0 10px;color:var(--ink)}.dashboard-layout{display:grid;grid-template-columns:1fr;gap:14px;align-items:start}@media(min-width:1280px){.dashboard-layout{grid-template-columns:minmax(19rem,.7fr) minmax(0,1.3fr)}}.stack{display:grid;gap:14px}.dashboard-layout>.panel,.stack>.panel{margin-top:14px}.bars{display:grid;gap:9px}button.bar-row{width:100%;border:0;background:transparent;text-align:left;cursor:pointer;border-radius:10px;padding:7px}.bar-row{display:grid;grid-template-columns:minmax(110px,1fr) minmax(120px,2fr) auto;align-items:center;gap:10px;font-size:13px}.bar-track{height:12px;overflow:hidden;border-radius:999px;background:#e9efed}.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-fill{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--teal),#35aa92)}.bar-value{font-variant-numeric:tabular-nums;font-weight:700}.bar-row[aria-pressed=true]{background:#e8f7f3;outline:1px solid #55aa98}.filter-strip{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}.filter-chip{border:1px solid var(--line);border-radius:999px;background:#fff;padding:5px 9px;cursor:pointer}.reset{margin-left:auto;border:0;background:transparent;color:var(--teal);font-weight:700;cursor:pointer}.detail-link{border:0;background:none;padding:0;color:inherit;text-align:left;cursor:pointer}.detail-link:hover{text-decoration:underline;color:var(--teal)}dialog{width:min(760px,calc(100% - 24px));max-height:90vh;overflow:auto;border:1px solid var(--line);border-radius:18px;padding:0;box-shadow:0 24px 80px rgba(0,0,0,.25)}dialog::backdrop{background:rgba(10,20,17,.55)}.dialog-head{position:sticky;top:0;display:flex;justify-content:space-between;gap:16px;align-items:start;padding:18px 20px;background:#fff;border-bottom:1px solid var(--line)}.dialog-body{padding:20px}.dialog-close{border:0;background:#eef4f2;border-radius:999px;width:34px;height:34px;cursor:pointer}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.detail-item{border:1px solid var(--line);border-radius:10px;padding:10px}.asset-card{margin-top:12px;border:1px solid var(--line);border-radius:12px;padding:14px}.asset-card h3{margin:0 0 4px}.detail-item small,.asset-card small{display:block;color:var(--muted);font-weight:700}.type-panel{margin-top:14px}.table-scroll{overflow:auto;border:1px solid var(--line);border-radius:13px}table{width:100%;border-collapse:collapse;min-width:980px}th,td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}th{position:sticky;top:0;background:#eef4f2;color:#41504b;font-size:12px;z-index:1}th button{border:0;background:none;padding:0;color:inherit;font-weight:800;cursor:pointer}td.amount{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}.group td{background:#f6f9f8;font-weight:800;color:#34433e}.empty{padding:28px;text-align:center;color:var(--muted)}.footer{margin-top:18px;padding:18px;border-left:4px solid var(--teal);background:#edf7f4;border-radius:10px}.footer h2{font-size:15px;margin-bottom:6px}.footer p{margin:5px 0}.index-controls{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;margin:22px 0}.link{display:inline-flex;border-radius:8px;background:var(--teal);color:#fff;text-decoration:none;padding:7px 10px;font-weight:700}.nojs{margin-top:16px}
@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}.filters{grid-template-columns:repeat(2,1fr)}.dashboard-layout{grid-template-columns:1fr}.bar-row{grid-template-columns:minmax(100px,1fr) minmax(90px,1.3fr) auto}}
@media(max-width:560px){.wrap{width:min(100% - 20px,1440px);padding-top:22px}.cards{grid-template-columns:1fr}.filters,.index-controls{grid-template-columns:1fr}.panel{padding:14px}}
@media print{body{background:#fff}.wrap{width:100%;padding:0}.filters,.index-controls,.link{display:none!important}.card,.panel{box-shadow:none;break-inside:avoid}.table-scroll{overflow:visible}table{min-width:0;font-size:10px}th,td{padding:5px}.footer{break-inside:avoid}}
`;

export function renderMunicipalityInvestmentHtml(data: MunicipalityInvestmentData, locale: InvestmentHtmlLocale = "de") {
  const labels = investmentHtmlLabels(locale);
  const years = data.availableYears.length ? `${data.availableYears[0]}–${data.availableYears.at(-1)}` : "—";
  const noScriptRows = data.positions.slice(0, 200).map((position) => `<tr><td>${position.year}</td><td>${escapeHtml(labels.taskAreas[position.taskArea])}</td><td>${escapeHtml(position.approachText)}</td><td>${escapeHtml(position.accountText)}</td><td>${(position.amountCents / 100).toLocaleString(locale === "de" ? "de-AT" : "en", { style: "currency", currency: "EUR" })}</td></tr>`).join("");
  return `<!doctype html>
<html lang="${labels.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${escapeHtml(data.municipality.name)} · ${escapeHtml(labels.title)}</title><style>${sharedStyles}</style></head>
<body><main class="wrap"><header><p class="eyebrow">${escapeHtml(labels.eyebrow)}</p><h1>${escapeHtml(data.municipality.name)}</h1><p class="muted">${escapeHtml(labels.subtitle)}</p><div class="meta"><span class="chip">${escapeHtml(data.municipality.state)}</span><span class="chip">${data.municipality.code}</span><span class="chip">${escapeHtml(labels.coverage)}: ${years}</span></div></header>
<section class="cards" aria-label="${escapeHtml(labels.directInvestments)}"><article class="card"><span class="muted">${escapeHtml(labels.directInvestments)}</span><strong id="kpi-direct">—</strong></article><article class="card"><span class="muted">${escapeHtml(labels.positions)}</span><strong id="kpi-count">—</strong></article><article class="card"><span class="muted">${escapeHtml(labels.assetDetails)}</span><strong id="kpi-assets">—</strong></article><article class="card"><span class="muted">${escapeHtml(labels.averagePosition)}</span><strong id="kpi-average">—</strong></article></section>
<section class="panel"><div class="filters"><div class="field"><label for="year">${escapeHtml(labels.year)}</label><select id="year"></select></div><div class="field"><label for="task">${escapeHtml(labels.taskArea)}</label><select id="task"></select></div><div class="field"><label for="type">${escapeHtml(labels.investmentType)}</label><select id="type"></select></div><div class="field"><label for="minimum">${escapeHtml(labels.minimum)}</label><input id="minimum" type="number" min="0" step="100" inputmode="decimal"></div><div class="field"><label for="search">${escapeHtml(labels.search)}</label><input id="search" type="search" placeholder="${escapeHtml(labels.searchPlaceholder)}"></div></div><div class="filter-strip"><strong class="muted">${escapeHtml(labels.activeFilters)}</strong><span id="active-filters"></span><button class="reset" id="reset" type="button">${escapeHtml(labels.resetFilters)}</button></div></section>
<div class="dashboard-layout"><section class="panel"><h2>${escapeHtml(labels.trend)}</h2><div class="bars" id="trend"></div></section><div class="stack"><section class="panel"><h2>${escapeHtml(labels.breakdown)}</h2><div class="bars" id="breakdown"></div></section><section class="panel"><h2>${escapeHtml(labels.typeBreakdown)}</h2><div class="bars" id="type-breakdown"></div></section></div></div>
<section class="panel"><h2>${escapeHtml(labels.details)} <span class="muted" id="result-count"></span></h2><div class="table-scroll"><table><thead><tr><th><button data-sort="year">${escapeHtml(labels.year)}</button></th><th>${escapeHtml(labels.taskArea)}</th><th><button data-sort="description">${escapeHtml(labels.description)}</button></th><th>${escapeHtml(labels.investmentType)}</th><th>${escapeHtml(labels.project)}</th><th>${escapeHtml(labels.sourceDetail)}</th><th><button data-sort="amount">${escapeHtml(labels.amount)}</button></th></tr></thead><tbody id="positions"></tbody></table><p class="empty" id="empty" hidden>${escapeHtml(labels.noResults)}</p></div></section>
<section class="footer"><h2>${escapeHtml(labels.methodology)}</h2><p>${escapeHtml(labels.methodologyText)}</p><p>${escapeHtml(labels.source)}: <a href="${data.source.url}" rel="noreferrer">${escapeHtml(data.source.title)}</a> · <a href="${data.source.definitionUrl}" rel="noreferrer">VRV 2015</a></p><p class="muted">${escapeHtml(data.years.map((year) => `${year.year}: ${year.statisticsFile}${year.municipalityFile ? ` + ${year.municipalityFile}` : ""}`).join(" · "))}</p></section>
<dialog id="detail-dialog"><div class="dialog-head"><div><p class="eyebrow">${escapeHtml(labels.eyebrow)}</p><h2 id="dialog-title"></h2></div><button class="dialog-close" id="dialog-close" type="button" aria-label="Close">×</button></div><div class="dialog-body" id="dialog-body"></div></dialog>
<noscript><section class="panel nojs"><p>${escapeHtml(labels.methodologyText)}</p><div class="table-scroll"><table><thead><tr><th>${escapeHtml(labels.year)}</th><th>${escapeHtml(labels.taskArea)}</th><th>${escapeHtml(labels.description)}</th><th>${escapeHtml(labels.investmentType)}</th><th>${escapeHtml(labels.amount)}</th></tr></thead><tbody>${noScriptRows}</tbody></table></div></section></noscript></main>
<script type="application/json" id="investment-data">${embeddedJson(data)}</script><script type="application/json" id="investment-labels">${embeddedJson(labels)}</script>
<script>(()=>{const d=JSON.parse(document.getElementById('investment-data').textContent),l=JSON.parse(document.getElementById('investment-labels').textContent),loc=l.lang==='de'?'de-AT':'en',money=new Intl.NumberFormat(loc,{style:'currency',currency:'EUR',maximumFractionDigits:0}),exact=new Intl.NumberFormat(loc,{style:'currency',currency:'EUR'}),num=new Intl.NumberFormat(loc),assets=new Map(d.assets.map(a=>[a.id,a])),e={year:document.querySelector('#year'),task:document.querySelector('#task'),type:document.querySelector('#type'),min:document.querySelector('#minimum'),q:document.querySelector('#search'),body:document.querySelector('#positions'),empty:document.querySelector('#empty'),trend:document.querySelector('#trend'),tasks:document.querySelector('#breakdown'),types:document.querySelector('#type-breakdown'),active:document.querySelector('#active-filters'),dialog:document.querySelector('#detail-dialog'),dialogTitle:document.querySelector('#dialog-title'),dialogBody:document.querySelector('#dialog-body')};let sort='amount',dir=-1;
function opt(s,v,t){const o=document.createElement('option');o.value=v;o.textContent=t;s.append(o)}opt(e.year,'all',l.allYears);d.availableYears.slice().reverse().forEach(y=>opt(e.year,String(y),String(y)));opt(e.task,'all',l.allTaskAreas);Object.entries(l.taskAreas).forEach(x=>opt(e.task,x[0],x[1]));opt(e.type,'all',l.allInvestmentTypes);Object.entries(l.investmentTypes).forEach(x=>opt(e.type,x[0],x[1]));
function norm(v){return v.trim().toLocaleLowerCase(loc).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}function text(p){return[p.approachText,p.accountText,p.projectCode,p.approachCode,p.accountCode,...p.assetIds.flatMap(id=>{const a=assets.get(id);return a?[a.approachText,a.accountText,a.sourceAssetId]:[]})].join(' ')}function ok(p,omit){const q=norm(e.q.value),min=(Number(e.min.value)||0)*100;return(omit==='year'||e.year.value==='all'||p.year===Number(e.year.value))&&(omit==='task'||e.task.value==='all'||p.taskArea===e.task.value)&&(omit==='type'||e.type.value==='all'||p.investmentType===e.type.value)&&Math.abs(p.amountCents)>=min&&(!q||norm(text(p)).includes(q))}
function read(){const p=new URLSearchParams(location.hash.slice(1)),def=d.availableYears.includes(2024)?'2024':String(d.availableYears.at(-1)),y=p.get('year');e.year.value=y==='all'||d.availableYears.includes(Number(y))?y:def;e.task.value=Object.hasOwn(l.taskAreas,p.get('task'))?p.get('task'):'all';e.type.value=Object.hasOwn(l.investmentTypes,p.get('type'))?p.get('type'):'all';e.min.value=p.get('min')||'';e.q.value=(p.get('q')||'').slice(0,200)}function hash(){const p=new URLSearchParams(),def=d.availableYears.includes(2024)?'2024':String(d.availableYears.at(-1));if(e.year.value!==def)p.set('year',e.year.value);if(e.task.value!=='all')p.set('task',e.task.value);if(e.type.value!=='all')p.set('type',e.type.value);if(e.min.value)p.set('min',e.min.value);if(e.q.value)p.set('q',e.q.value);history.replaceState(null,'',location.pathname+(p.size?'#'+p:''))}
function bars(container,groups,selected,setter){container.replaceChildren();const max=Math.max(1,...groups.map(g=>Math.abs(g[2]))),total=groups.reduce((s,g)=>s+Math.abs(g[2]),0)||1;groups.forEach(g=>{const b=document.createElement('button');b.type='button';b.className='bar-row';b.setAttribute('aria-pressed',String(selected===g[0]));b.title=g[1]+': '+exact.format(g[2]/100)+' · '+g[3]+' · '+Math.round(Math.abs(g[2])/total*1000)/10+'%';const n=document.createElement('span');n.textContent=g[1];n.className='truncate';const track=document.createElement('span');track.className='bar-track';const fill=document.createElement('span');fill.className='bar-fill';fill.style.width=Math.max(1,Math.abs(g[2])/max*100)+'%';if(g[2]<0)fill.style.background='#c94c43';track.append(fill);const a=document.createElement('span');a.className='bar-value';a.textContent=money.format(g[2]/100);b.append(n,track,a);b.onclick=()=>{setter(selected===g[0]?'all':g[0]);render()};container.append(b)})}
function item(label,value,parent){const x=document.createElement('div');x.className='detail-item';const s=document.createElement('small');s.textContent=label;const v=document.createElement('span');v.textContent=value||'—';x.append(s,v);parent.append(x)}function open(p){e.dialogTitle.textContent=p.approachText||p.accountText||l.details;e.dialogBody.replaceChildren();const grid=document.createElement('div');grid.className='detail-grid';item(l.year,String(p.year),grid);item(l.amount,exact.format(p.amountCents/100),grid);item(l.taskArea,l.taskAreas[p.taskArea]+' · '+p.approachCode,grid);item(l.investmentType,l.investmentTypes[p.investmentType]+' · '+p.investmentType,grid);item(l.description,p.approachText+' · '+p.accountText+' · '+p.accountCode,grid);item(l.project,p.projectCode,grid);e.dialogBody.append(grid);const h=document.createElement('h2');h.textContent=l.linkedAssets;h.style.marginTop='22px';e.dialogBody.append(h);const linked=p.assetIds.map(id=>assets.get(id)).filter(Boolean);if(linked.length)linked.forEach(a=>{const c=document.createElement('section');c.className='asset-card';const title=document.createElement('h3');title.textContent=a.accountText||a.approachText||a.sourceAssetId;const meta=document.createElement('p');meta.className='muted';meta.textContent=a.approachText+' · MVAG '+a.mvagCode+' · '+a.sourceAssetId;const g=document.createElement('div');g.className='detail-grid';item(l.assetAddition,exact.format(a.additionsCents/100),g);item(l.assetDisposal,exact.format(a.disposalsCents/100),g);item(l.openingBalance,exact.format(a.openingBalanceCents/100),g);item(l.closingBalance,exact.format(a.closingBalanceCents/100),g);const src=document.createElement('p');src.className='muted';src.textContent=l.source+': '+a.sourceFile+' · '+l.exactlyMatched;c.append(title,meta,g,src);e.dialogBody.append(c)});else{const x=document.createElement('p');x.className='asset-card muted';x.textContent=p.assetMatchStatus==='ambiguous'?l.ambiguousAssetDetails:l.noAssetDetails;e.dialogBody.append(x)}if(p.projectCode!=='0000000'){const history=d.positions.filter(x=>x.id!==p.id&&x.projectCode===p.projectCode);if(history.length){const ph=document.createElement('h2');ph.textContent=l.projectHistory;ph.style.marginTop='22px';e.dialogBody.append(ph);history.forEach(x=>item(String(x.year),x.approachText+' · '+x.accountText+' · '+exact.format(x.amountCents/100),e.dialogBody))}}e.dialog.showModal()}
function chips(){e.active.replaceChildren();const values=[];if(e.year.value!=='all')values.push([l.year+': '+e.year.value,()=>e.year.value='all']);if(e.task.value!=='all')values.push([l.taskAreas[e.task.value],()=>e.task.value='all']);if(e.type.value!=='all')values.push([l.investmentTypes[e.type.value],()=>e.type.value='all']);if(e.min.value)values.push(['≥ '+e.min.value+' €',()=>e.min.value='']);if(e.q.value)values.push(['„'+e.q.value+'“',()=>e.q.value='']);values.forEach(v=>{const b=document.createElement('button');b.type='button';b.className='filter-chip';b.textContent=v[0]+' ×';b.onclick=()=>{v[1]();render()};e.active.append(b)})}
function group(id,label,omit,field){const r=d.positions.filter(p=>ok(p,omit)&&String(p[field])===id);return[id,label,r.reduce((s,p)=>s+p.amountCents,0),r.length]}function renderCharts(){bars(e.trend,d.availableYears.map(y=>group(String(y),String(y),'year','year')),e.year.value,v=>e.year.value=v);bars(e.tasks,Object.entries(l.taskAreas).map(x=>group(x[0],x[1],'task','taskArea')).filter(x=>x[3]).sort((a,b)=>Math.abs(b[2])-Math.abs(a[2])),e.task.value,v=>e.task.value=v);bars(e.types,Object.entries(l.investmentTypes).map(x=>group(x[0],x[1],'type','investmentType')).filter(x=>x[3]).sort((a,b)=>Math.abs(b[2])-Math.abs(a[2])),e.type.value,v=>e.type.value=v)}
function render(){const rows=d.positions.filter(p=>ok(p)),direct=rows.reduce((s,p)=>s+p.amountCents,0);document.querySelector('#kpi-direct').textContent=money.format(direct/100);document.querySelector('#kpi-count').textContent=num.format(rows.length);document.querySelector('#kpi-assets').textContent=num.format(rows.filter(p=>p.assetMatchStatus==='matched').length);document.querySelector('#kpi-average').textContent=money.format((rows.length?direct/rows.length:0)/100);document.querySelector('#result-count').textContent='('+rows.length+')';rows.sort((a,b)=>{const v=sort==='year'?a.year-b.year:sort==='amount'?a.amountCents-b.amountCents:(a.approachText+' '+a.accountText).localeCompare(b.approachText+' '+b.accountText,loc);return a.taskArea.localeCompare(b.taskArea)||v*dir});e.body.replaceChildren();let current=null;rows.forEach(p=>{if(current!==p.taskArea){current=p.taskArea;const tr=document.createElement('tr');tr.className='group';const td=document.createElement('td');td.colSpan=7;td.textContent=l.taskAreas[p.taskArea];tr.append(td);e.body.append(tr)}const tr=document.createElement('tr'),vals=[String(p.year),l.taskAreas[p.taskArea]+' · '+p.approachCode,null,l.investmentTypes[p.investmentType]+' · '+p.investmentType,p.projectCode,(p.detailLevel==='municipality'?l.detailed:l.aggregated)+(p.assetMatchStatus==='matched'?' · '+l.assetMatched:p.assetMatchStatus==='ambiguous'?' · '+l.assetAmbiguous:'')];vals.forEach((v,i)=>{const td=document.createElement('td');if(i===2){const b=document.createElement('button');b.type='button';b.className='detail-link';b.textContent=p.approachText+(p.accountText?' · '+p.accountText+' · '+p.accountCode:'');b.onclick=()=>open(p);td.append(b)}else td.textContent=v;tr.append(td)});const amount=document.createElement('td');amount.className='amount';amount.textContent=exact.format(p.amountCents/100);if(p.amountCents<0){const badge=document.createElement('span');badge.className='badge negative';badge.textContent=l.correction;amount.prepend(badge,' ')}tr.append(amount);e.body.append(tr)});e.empty.hidden=rows.length>0;renderCharts();chips();hash()}
[e.year,e.task,e.type,e.min,e.q].forEach(x=>x.addEventListener(x===e.min||x===e.q?'input':'change',render));document.querySelector('#reset').onclick=()=>{e.year.value='all';e.task.value='all';e.type.value='all';e.min.value='';e.q.value='';render()};document.querySelector('#dialog-close').onclick=()=>e.dialog.close();document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{const n=b.dataset.sort;if(sort===n)dir*=-1;else{sort=n;dir=n==='description'?1:-1}render()});read();render()})();</script></body></html>`;
}

export function renderMunicipalityInvestmentIndexHtml(index: MunicipalityInvestmentIndex, locale: InvestmentHtmlLocale = "de") {
  const labels = investmentHtmlLabels(locale);
  const unavailableRows = index.unavailableMunicipalities.map((municipality) => `<tr><td>${escapeHtml(municipality.name)} · ${municipality.code}</td><td>${escapeHtml(municipality.state)}</td><td>${municipality.availableYears.length ? `${municipality.availableYears[0]}–${municipality.availableYears.at(-1)}` : "—"}</td><td>${municipality.missingYears.join(", ")}</td><td>${escapeHtml(labels.noReliableData)}</td></tr>`).join("");
  return `<!doctype html><html lang="${labels.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${escapeHtml(labels.indexTitle)}</title><style>${sharedStyles}</style></head><body><main class="wrap"><header><p class="eyebrow">${escapeHtml(labels.eyebrow)}</p><h1>${escapeHtml(labels.indexTitle)}</h1><p class="muted">${escapeHtml(labels.indexSubtitle)}</p><div class="meta"><span class="chip">${index.municipalityCount} ${escapeHtml(labels.municipality)}</span><span class="chip">${index.skippedMunicipalityCount} ${escapeHtml(labels.noReliableData)}</span><span class="chip">${index.firstYear}–${index.latestYear}</span></div></header><section class="index-controls"><div class="field"><label for="search">${escapeHtml(labels.search)}</label><input id="search" type="search" placeholder="${escapeHtml(labels.searchPlaceholder)}"></div><div class="field"><label for="state">${escapeHtml(labels.state)}</label><select id="state"></select></div><div class="field"><label for="index-year">${escapeHtml(labels.year)}</label><select id="index-year"></select></div></section><section class="panel"><div class="table-scroll"><table><thead><tr><th><button data-sort="name">${escapeHtml(labels.municipality)}</button></th><th>${escapeHtml(labels.state)}</th><th>${escapeHtml(labels.coverage)}</th><th><button data-sort="latest" id="selected-year-heading">${escapeHtml(labels.latestYear)}</button></th><th><button data-sort="total">${escapeHtml(labels.totalPeriod)}</button></th><th></th></tr></thead><tbody id="rows"></tbody></table></div></section><section class="panel"><h2>${escapeHtml(labels.unavailableTitle)}</h2><div class="table-scroll"><table><thead><tr><th>${escapeHtml(labels.municipality)}</th><th>${escapeHtml(labels.state)}</th><th>${escapeHtml(labels.coverage)}</th><th>${escapeHtml(labels.missingYears)}</th><th></th></tr></thead><tbody>${unavailableRows}</tbody></table></div></section><script type="application/json" id="index-data">${embeddedJson(index)}</script><script type="application/json" id="index-labels">${embeddedJson(labels)}</script><script>(()=>{const d=JSON.parse(document.querySelector('#index-data').textContent),l=JSON.parse(document.querySelector('#index-labels').textContent),loc=l.lang==='de'?'de-AT':'en',money=new Intl.NumberFormat(loc,{style:'currency',currency:'EUR',maximumFractionDigits:0}),search=document.querySelector('#search'),state=document.querySelector('#state'),year=document.querySelector('#index-year'),body=document.querySelector('#rows'),heading=document.querySelector('#selected-year-heading');let sort='name',direction=1;function option(s,v,t){const o=document.createElement('option');o.value=v;o.textContent=t;s.append(o)}option(state,'all',l.allStates);Array.from(new Set(d.municipalities.map(m=>m.state))).sort().forEach(v=>option(state,v,v));option(year,'all',l.totalPeriod);for(let y=d.latestYear;y>=d.firstYear;y--)option(year,String(y),String(y));const requested=new URLSearchParams(location.hash.slice(1)).get('year');year.value=requested==='all'||Number(requested)>=d.firstYear&&Number(requested)<=d.latestYear?requested:String(d.latestYear);function selected(m){if(year.value==='all')return m.directInvestmentCents;const row=m.yearTotals.find(x=>x.year===Number(year.value));return row?row.directInvestmentCents:0}function render(){heading.textContent=year.value==='all'?l.totalPeriod:year.value;const q=search.value.trim().toLocaleLowerCase(loc),rows=d.municipalities.filter(m=>(state.value==='all'||m.state===state.value)&&(!q||(m.name+' '+m.code).toLocaleLowerCase(loc).includes(q))).sort((a,b)=>{const v=sort==='name'?a.name.localeCompare(b.name,loc):sort==='latest'?selected(a)-selected(b):a.directInvestmentCents-b.directInvestmentCents;return v*direction});body.replaceChildren();rows.forEach(m=>{const tr=document.createElement('tr'),coverage=m.availableYears[0]+'–'+m.availableYears.at(-1)+' · '+(m.missingYears.length?l.missingYears+': '+m.missingYears.join(', '):l.completeCoverage);[m.name+' · '+m.code,m.state,coverage,money.format(selected(m)/100),money.format(m.directInvestmentCents/100)].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});const td=document.createElement('td'),a=document.createElement('a');a.className='link';a.href='gemeinden/'+m.htmlFile+'#year='+encodeURIComponent(year.value);a.textContent=l.open;td.append(a);tr.append(td);body.append(tr)});history.replaceState(null,'',location.pathname+'#year='+encodeURIComponent(year.value))}search.addEventListener('input',render);state.addEventListener('change',render);year.addEventListener('change',render);document.querySelectorAll('[data-sort]').forEach(b=>b.addEventListener('click',()=>{const next=b.dataset.sort;if(sort===next)direction*=-1;else{sort=next;direction=next==='name'?1:-1}render()}));render()})();</script></main></body></html>`;
}
