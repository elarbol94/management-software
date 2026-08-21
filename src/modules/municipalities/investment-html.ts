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
    trend: "Investment trend", breakdown: "Breakdown by task area", details: "Investment positions",
    noResults: "No positions match the selected filters.", amount: "Amount", description: "Description",
    project: "Project code", sourceDetail: "Source detail", detailed: "Municipality detail", aggregated: "Aggregated",
    correction: "Correction", methodology: "Source and methodology",
    methodologyText: "A position is an account position, not necessarily an individual purchase contract. Municipality detail is used only when its direct-investment total reconciles exactly to the Statistics Austria file; otherwise the aggregated source controls.",
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
    trend: "Investitionsverlauf", breakdown: "Verteilung nach Aufgabenbereich", details: "Investitionspositionen",
    noResults: "Für die gewählten Filter wurden keine Positionen gefunden.", amount: "Betrag", description: "Bezeichnung",
    project: "Vorhabencode", sourceDetail: "Quelldetail", detailed: "Gemeindedetail", aggregated: "Aggregiert",
    correction: "Berichtigung", methodology: "Quelle und Methodik",
    methodologyText: "Eine Position ist eine Haushalts- bzw. Kontoposition und nicht zwingend ein einzelner Kaufvertrag. Gemeindedetails werden nur verwendet, wenn ihre Direktinvestitionssumme centgenau mit der Statistik-Austria-Datei übereinstimmt; andernfalls gilt die aggregierte Quelle.",
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
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--teal)}button,input,select{font:inherit}.wrap{width:min(1440px,calc(100% - 32px));margin:0 auto;padding:34px 0 56px}.eyebrow{margin:0;color:var(--teal);font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}h1{margin:4px 0 8px;font-size:clamp(28px,4vw,46px);line-height:1.06}h2{margin:0 0 16px;font-size:19px}.muted{color:var(--muted)}.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.chip,.badge{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;background:#fff;padding:5px 9px;font-size:12px}.badge.detail{background:#ebfaf6;color:#056a58}.badge.aggregate{background:#f1f3f2;color:#53605c}.badge.negative{background:#fff0ee;color:var(--red)}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:24px 0}.card,.panel{border:1px solid var(--line);border-radius:18px;background:var(--card);box-shadow:var(--shadow)}.card{padding:18px}.card strong{display:block;margin-top:5px;font-size:25px;font-variant-numeric:tabular-nums}.panel{padding:20px;margin-top:14px}.filters{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.field{display:grid;gap:5px}.field label{font-size:12px;font-weight:700;color:var(--muted)}input,select{min-width:0;width:100%;height:40px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:0 10px;color:var(--ink)}.grid2{display:grid;grid-template-columns:1.15fr .85fr;gap:14px}.bars{display:grid;gap:9px}.bar-row{display:grid;grid-template-columns:minmax(110px,1fr) minmax(120px,2fr) auto;align-items:center;gap:10px;font-size:13px}.bar-track{height:12px;overflow:hidden;border-radius:999px;background:#e9efed}.bar-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--teal),#35aa92)}.bar-value{font-variant-numeric:tabular-nums;font-weight:700}.table-scroll{overflow:auto;border:1px solid var(--line);border-radius:13px}table{width:100%;border-collapse:collapse;min-width:980px}th,td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}th{position:sticky;top:0;background:#eef4f2;color:#41504b;font-size:12px;z-index:1}th button{border:0;background:none;padding:0;color:inherit;font-weight:800;cursor:pointer}td.amount{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}.group td{background:#f6f9f8;font-weight:800;color:#34433e}.empty{padding:28px;text-align:center;color:var(--muted)}.footer{margin-top:18px;padding:18px;border-left:4px solid var(--teal);background:#edf7f4;border-radius:10px}.footer h2{font-size:15px;margin-bottom:6px}.footer p{margin:5px 0}.index-controls{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin:22px 0}.link{display:inline-flex;border-radius:8px;background:var(--teal);color:#fff;text-decoration:none;padding:7px 10px;font-weight:700}.nojs{margin-top:16px}
@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}.filters{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}.bar-row{grid-template-columns:minmax(100px,1fr) minmax(90px,1.3fr) auto}}
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
<section class="cards" aria-label="${escapeHtml(labels.directInvestments)}"><article class="card"><span class="muted">${escapeHtml(labels.directInvestments)}</span><strong id="kpi-direct">—</strong></article><article class="card"><span class="muted">${escapeHtml(labels.positions)}</span><strong id="kpi-count">—</strong></article><article class="card"><span class="muted">${escapeHtml(labels.investiveInflows)}</span><strong id="kpi-inflows">—</strong></article><article class="card"><span class="muted">${escapeHtml(labels.investiveBalance)}</span><strong id="kpi-balance">—</strong></article></section>
<section class="panel"><div class="filters"><div class="field"><label for="year">${escapeHtml(labels.year)}</label><select id="year"></select></div><div class="field"><label for="task">${escapeHtml(labels.taskArea)}</label><select id="task"></select></div><div class="field"><label for="type">${escapeHtml(labels.investmentType)}</label><select id="type"></select></div><div class="field"><label for="minimum">${escapeHtml(labels.minimum)}</label><input id="minimum" type="number" min="0" step="100" inputmode="decimal"></div><div class="field"><label for="search">${escapeHtml(labels.search)}</label><input id="search" type="search" placeholder="${escapeHtml(labels.searchPlaceholder)}"></div></div></section>
<div class="grid2"><section class="panel"><h2>${escapeHtml(labels.trend)}</h2><div class="bars" id="trend"></div></section><section class="panel"><h2>${escapeHtml(labels.breakdown)}</h2><div class="bars" id="breakdown"></div></section></div>
<section class="panel"><h2>${escapeHtml(labels.details)} <span class="muted" id="result-count"></span></h2><div class="table-scroll"><table><thead><tr><th><button data-sort="year">${escapeHtml(labels.year)}</button></th><th>${escapeHtml(labels.taskArea)}</th><th><button data-sort="description">${escapeHtml(labels.description)}</button></th><th>${escapeHtml(labels.investmentType)}</th><th>${escapeHtml(labels.project)}</th><th>${escapeHtml(labels.sourceDetail)}</th><th><button data-sort="amount">${escapeHtml(labels.amount)}</button></th></tr></thead><tbody id="positions"></tbody></table><p class="empty" id="empty" hidden>${escapeHtml(labels.noResults)}</p></div></section>
<section class="footer"><h2>${escapeHtml(labels.methodology)}</h2><p>${escapeHtml(labels.methodologyText)}</p><p>${escapeHtml(labels.source)}: <a href="${data.source.url}" rel="noreferrer">${escapeHtml(data.source.title)}</a> · <a href="${data.source.definitionUrl}" rel="noreferrer">VRV 2015</a></p><p class="muted">${escapeHtml(data.years.map((year) => `${year.year}: ${year.statisticsFile}${year.municipalityFile ? ` + ${year.municipalityFile}` : ""}`).join(" · "))}</p></section>
<noscript><section class="panel nojs"><p>${escapeHtml(labels.methodologyText)}</p><div class="table-scroll"><table><thead><tr><th>${escapeHtml(labels.year)}</th><th>${escapeHtml(labels.taskArea)}</th><th>${escapeHtml(labels.description)}</th><th>${escapeHtml(labels.investmentType)}</th><th>${escapeHtml(labels.amount)}</th></tr></thead><tbody>${noScriptRows}</tbody></table></div></section></noscript></main>
<script type="application/json" id="investment-data">${embeddedJson(data)}</script><script type="application/json" id="investment-labels">${embeddedJson(labels)}</script>
<script>(()=>{const data=JSON.parse(document.getElementById('investment-data').textContent);const l=JSON.parse(document.getElementById('investment-labels').textContent);const money=new Intl.NumberFormat(l.lang==='de'?'de-AT':'en',{style:'currency',currency:'EUR',maximumFractionDigits:0});const exactMoney=new Intl.NumberFormat(l.lang==='de'?'de-AT':'en',{style:'currency',currency:'EUR'});const els={year:document.getElementById('year'),task:document.getElementById('task'),type:document.getElementById('type'),minimum:document.getElementById('minimum'),search:document.getElementById('search'),body:document.getElementById('positions'),empty:document.getElementById('empty'),trend:document.getElementById('trend'),breakdown:document.getElementById('breakdown')};let sort='amount',direction=-1;
function option(select,value,text){const item=document.createElement('option');item.value=value;item.textContent=text;select.append(item)}option(els.year,'all',l.allYears);data.availableYears.slice().reverse().forEach(y=>option(els.year,String(y),String(y)));els.year.value=data.availableYears.includes(2024)?'2024':String(data.availableYears.at(-1));option(els.task,'all',l.allTaskAreas);Object.entries(l.taskAreas).forEach(([id,text])=>option(els.task,id,text));option(els.type,'all',l.allInvestmentTypes);Object.entries(l.investmentTypes).forEach(([id,text])=>option(els.type,id,text));
function filtered(){const q=els.search.value.trim().toLocaleLowerCase(l.lang==='de'?'de-AT':'en');const min=(Number(els.minimum.value)||0)*100;return data.positions.filter(p=>(els.year.value==='all'||p.year===Number(els.year.value))&&(els.task.value==='all'||p.taskArea===els.task.value)&&(els.type.value==='all'||p.investmentType===els.type.value)&&Math.abs(p.amountCents)>=min&&(!q||(p.approachText+' '+p.accountText+' '+p.projectCode+' '+p.approachCode+' '+p.accountCode).toLocaleLowerCase(l.lang==='de'?'de-AT':'en').includes(q)))}
function bar(container,label,value,max,negative=false){const row=document.createElement('div');row.className='bar-row';const name=document.createElement('span');name.textContent=label;const track=document.createElement('div');track.className='bar-track';const fill=document.createElement('div');fill.className='bar-fill';if(negative)fill.style.background='#c94c43';fill.style.width=(max?Math.max(1,Math.abs(value)/max*100):0)+'%';track.append(fill);const amount=document.createElement('span');amount.className='bar-value';amount.textContent=money.format(value/100);row.append(name,track,amount);container.append(row)}
function renderBars(rows){els.trend.replaceChildren();const search=els.search.value.trim().toLocaleLowerCase(l.lang==='de'?'de-AT':'en');const minimum=(Number(els.minimum.value)||0)*100;const trendRows=data.positions.filter(p=>(els.task.value==='all'||p.taskArea===els.task.value)&&(els.type.value==='all'||p.investmentType===els.type.value)&&Math.abs(p.amountCents)>=minimum&&(!search||(p.approachText+' '+p.accountText+' '+p.projectCode+' '+p.approachCode+' '+p.accountCode).toLocaleLowerCase(l.lang==='de'?'de-AT':'en').includes(search)));const byYear=new Map(data.availableYears.map(y=>[y,0]));trendRows.forEach(p=>byYear.set(p.year,(byYear.get(p.year)||0)+p.amountCents));const maxYear=Math.max(0,...Array.from(byYear.values()).map(Math.abs));byYear.forEach((value,year)=>bar(els.trend,String(year),value,maxYear,value<0));els.breakdown.replaceChildren();const byTask=new Map();rows.forEach(p=>byTask.set(p.taskArea,(byTask.get(p.taskArea)||0)+p.amountCents));const entries=Array.from(byTask.entries()).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));const maxTask=Math.max(0,...entries.map(([,value])=>Math.abs(value)));entries.forEach(([id,value])=>bar(els.breakdown,l.taskAreas[id],value,maxTask,value<0));if(!entries.length){const p=document.createElement('p');p.className='muted';p.textContent=l.noResults;els.breakdown.append(p)}}
function render(){const rows=filtered();const summaries=els.year.value==='all'?data.years:data.years.filter(y=>y.year===Number(els.year.value));const direct=rows.reduce((sum,p)=>sum+p.amountCents,0);document.getElementById('kpi-direct').textContent=money.format(direct/100);document.getElementById('kpi-count').textContent=new Intl.NumberFormat(l.lang==='de'?'de-AT':'en').format(rows.length);document.getElementById('kpi-inflows').textContent=money.format(summaries.reduce((sum,y)=>sum+y.investiveInflowsCents,0)/100);document.getElementById('kpi-balance').textContent=money.format(summaries.reduce((sum,y)=>sum+y.investiveBalanceCents,0)/100);document.getElementById('result-count').textContent='('+rows.length+')';rows.sort((a,b)=>{let result=sort==='year'?a.year-b.year:sort==='amount'?a.amountCents-b.amountCents:(a.approachText+' '+a.accountText).localeCompare(b.approachText+' '+b.accountText,l.lang);return a.taskArea.localeCompare(b.taskArea)||result*direction});els.body.replaceChildren();let group=null;rows.forEach(p=>{if(p.taskArea!==group){group=p.taskArea;const tr=document.createElement('tr');tr.className='group';const td=document.createElement('td');td.colSpan=7;td.textContent=l.taskAreas[p.taskArea];tr.append(td);els.body.append(tr)}const tr=document.createElement('tr');const values=[p.year,l.taskAreas[p.taskArea],p.approachText+(p.accountText?' · '+p.accountText:''),l.investmentTypes[p.investmentType],p.projectCode,p.detailLevel==='municipality'?l.detailed:l.aggregated];values.forEach(value=>{const td=document.createElement('td');td.textContent=String(value||'—');tr.append(td)});const amount=document.createElement('td');amount.className='amount';amount.textContent=exactMoney.format(p.amountCents/100);if(p.amountCents<0){const badge=document.createElement('span');badge.className='badge negative';badge.textContent=l.correction;amount.prepend(badge,' ')}tr.append(amount);els.body.append(tr)});els.empty.hidden=rows.length>0;renderBars(rows)}
[els.year,els.task,els.type,els.minimum,els.search].forEach(el=>el.addEventListener(el===els.search||el===els.minimum?'input':'change',render));document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{const next=button.dataset.sort;if(sort===next)direction*=-1;else{sort=next;direction=next==='description'?1:-1}render()}));render()})();</script></body></html>`;
}

export function renderMunicipalityInvestmentIndexHtml(index: MunicipalityInvestmentIndex, locale: InvestmentHtmlLocale = "de") {
  const labels = investmentHtmlLabels(locale);
  const unavailableRows = index.unavailableMunicipalities.map((municipality) => `<tr><td>${escapeHtml(municipality.name)} · ${municipality.code}</td><td>${escapeHtml(municipality.state)}</td><td>${municipality.availableYears.length ? `${municipality.availableYears[0]}–${municipality.availableYears.at(-1)}` : "—"}</td><td>${municipality.missingYears.join(", ")}</td><td>${escapeHtml(labels.noReliableData)}</td></tr>`).join("");
  return `<!doctype html><html lang="${labels.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${escapeHtml(labels.indexTitle)}</title><style>${sharedStyles}</style></head><body><main class="wrap"><header><p class="eyebrow">${escapeHtml(labels.eyebrow)}</p><h1>${escapeHtml(labels.indexTitle)}</h1><p class="muted">${escapeHtml(labels.indexSubtitle)}</p><div class="meta"><span class="chip">${index.municipalityCount} ${escapeHtml(labels.municipality)}</span><span class="chip">${index.skippedMunicipalityCount} ${escapeHtml(labels.noReliableData)}</span><span class="chip">${index.firstYear}–${index.latestYear}</span></div></header><section class="index-controls"><div class="field"><label for="search">${escapeHtml(labels.search)}</label><input id="search" type="search" placeholder="${escapeHtml(labels.searchPlaceholder)}"></div><div class="field"><label for="state">${escapeHtml(labels.state)}</label><select id="state"></select></div></section><section class="panel"><div class="table-scroll"><table><thead><tr><th><button data-sort="name">${escapeHtml(labels.municipality)}</button></th><th>${escapeHtml(labels.state)}</th><th>${escapeHtml(labels.coverage)}</th><th><button data-sort="latest">${escapeHtml(labels.latestYear)}</button></th><th><button data-sort="total">${escapeHtml(labels.totalPeriod)}</button></th><th></th></tr></thead><tbody id="rows"></tbody></table></div></section><section class="panel"><h2>${escapeHtml(labels.unavailableTitle)}</h2><div class="table-scroll"><table><thead><tr><th>${escapeHtml(labels.municipality)}</th><th>${escapeHtml(labels.state)}</th><th>${escapeHtml(labels.coverage)}</th><th>${escapeHtml(labels.missingYears)}</th><th></th></tr></thead><tbody>${unavailableRows}</tbody></table></div></section><script type="application/json" id="index-data">${embeddedJson(index)}</script><script type="application/json" id="index-labels">${embeddedJson(labels)}</script><script>(()=>{const data=JSON.parse(document.getElementById('index-data').textContent);const l=JSON.parse(document.getElementById('index-labels').textContent);const money=new Intl.NumberFormat(l.lang==='de'?'de-AT':'en',{style:'currency',currency:'EUR',maximumFractionDigits:0});const search=document.getElementById('search'),state=document.getElementById('state'),body=document.getElementById('rows');let sort='name',direction=1;function option(v,t){const o=document.createElement('option');o.value=v;o.textContent=t;state.append(o)}option('all',l.allStates);Array.from(new Set(data.municipalities.map(m=>m.state))).sort().forEach(value=>option(value,value));function render(){const q=search.value.trim().toLocaleLowerCase(l.lang);const rows=data.municipalities.filter(m=>(state.value==='all'||m.state===state.value)&&(!q||(m.name+' '+m.code).toLocaleLowerCase(l.lang).includes(q))).sort((a,b)=>{const result=sort==='name'?a.name.localeCompare(b.name,l.lang):sort==='latest'?a.latestYearInvestmentCents-b.latestYearInvestmentCents:a.directInvestmentCents-b.directInvestmentCents;return result*direction});body.replaceChildren();rows.forEach(m=>{const tr=document.createElement('tr');const coverage=m.availableYears[0]+'–'+m.availableYears.at(-1)+' · '+(m.missingYears.length?l.missingYears+': '+m.missingYears.join(', '):l.completeCoverage);[m.name+' · '+m.code,m.state,coverage,money.format(m.latestYearInvestmentCents/100),money.format(m.directInvestmentCents/100)].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td)});const td=document.createElement('td'),a=document.createElement('a');a.className='link';a.href='gemeinden/'+m.htmlFile;a.textContent=l.open;td.append(a);tr.append(td);body.append(tr)})}search.addEventListener('input',render);state.addEventListener('change',render);document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{const next=button.dataset.sort;if(sort===next)direction*=-1;else{sort=next;direction=next==='name'?1:-1}render()}));render()})();</script></main></body></html>`;
}
