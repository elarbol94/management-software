import type { CSSProperties, SVGProps, ReactElement } from "react";
import { presentationFontFamilies, presentationIconNames, type PresentationElement } from "../lib/presentation";

// Pure vectors, with no client-component or hook dependency: authored icons must
// also render in downloadable HTML outside Next.js's client-component protocol.
const glyphs = {
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  lightbulb: <><path d="M8 16c0-3-3-4-3-8a7 7 0 0 1 14 0c0 4-3 5-3 8M8 19h8M10 22h4M10 16v-5l-2-2m6 7v-5l2-2" /></>,
  users: <><circle cx="9" cy="7" r="3" /><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6m2 4a6 6 0 0 1 3 5v2" /></>,
  rocket: <><path d="m7 15 2-7c3-4 7-5 12-5 0 5-1 9-5 12l-7 2zM8 9H4l-2 6h5m8 1v4l-6 2v-5M5 19l-2 2" /><circle cx="15" cy="9" r="2" /></>,
  heart: <path d="M12 21 3 12C-3 5 7-2 12 6c5-8 15-1 9 6z" />,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 6h14M5 18h14" /></>,
  check: <path d="m3 12 6 6L21 5" />,
  star: <path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1z" />,
  calendar: <><rect x="3" y="5" width="18" height="17" rx="2" /><path d="M3 10h18M7 2v6m10-6v6M7 14h2m6 0h2M7 18h2m6 0h2" /></>,
  chart: <><path d="M3 2v19h19M7 17v-6m5 6V5m5 12V8" /></>,
  briefcase: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M8 7V3h8v4M2 12l10 4 10-4M10 14h4v4h-4z" /></>,
  leaf: <><path d="M21 3C9 1 2 8 5 15s17 3 16-12ZM3 22 17 8" /></>,
  play: <path d="m7 3 15 9-15 9z" />,
  audio: <><path d="M3 9h4l6-6v18l-6-6H3zM17 7a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16" /></>,
};
function PresentationSymbol({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof glyphs }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>{glyphs[name]}</svg>;
}
export const presentationIcons = Object.fromEntries(presentationIconNames.map((name) => [name, function CatalogIcon(props: SVGProps<SVGSVGElement>) { return <PresentationSymbol {...props} name={name} />; }])) as Record<typeof presentationIconNames[number], (props: SVGProps<SVGSVGElement>) => ReactElement>;

/** Shared by the editor, presenter previews, print, public and offline delivery. */
export function PresentationContent({ element, mediaUrl = (id) => `/api/files/${id}`, interactive = true }: {
  element: PresentationElement; mediaUrl?: (id: string) => string; interactive?: boolean;
}) {
  if (element.type === "text") {
    const c = element.content;
    const style: CSSProperties = { fontFamily: presentationFontFamilies[c.font ?? "sans"], fontSize: c.fontSize,
      fontWeight: c.bold ? 700 : 400, fontStyle: c.italic ? "italic" : undefined, textDecoration: c.underline ? "underline" : undefined,
      textAlign: c.align, color: c.color || "inherit", whiteSpace: "pre-wrap", overflowWrap: "break-word", lineHeight: 1.15, height: "100%", overflow: "hidden" };
    const runs = c.runs ?? [{ text: c.text }];
    const renderRuns = (entries: typeof runs) => entries.map((run, i) => {
      const child = <span style={{ fontWeight: run.bold ? 700 : undefined, fontStyle: run.italic ? "italic" : undefined, textDecoration: run.underline ? "underline" : undefined, color: run.color || undefined }}>{run.text}</span>;
      return run.href && interactive ? <a key={i} href={run.href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>{child}</a> : <span key={i}>{child}</span>;
    });
    if (c.list && c.list !== "none") {
      const lines: Array<typeof runs> = [[]];
      for (const run of runs) run.text.split("\n").forEach((text, index) => {
        if (index) lines.push([]);
        lines[lines.length - 1].push({ ...run, text });
      });
      return <div style={style}>{lines.map((line, i) => <div key={i}>{c.list === "bullet" ? "• " : `${i + 1}. `}{renderRuns(line)}</div>)}</div>;
    }
    return <div style={style}>{renderRuns(runs)}</div>;
  }
  if (element.type === "image") {
    const c = element.content;
    return <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: c.mask === "circle" ? "50%" : c.mask === "rounded" ? "10%" : undefined, clipPath: c.mask === "diamond" ? "polygon(50% 0,100% 50%,50% 100%,0 50%)" : undefined }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl(c.attachmentId)} alt={c.alt} draggable={false} style={{ width: "100%", height: "100%", objectFit: c.fit ?? "contain", objectPosition: `${c.cropX ?? 50}% ${c.cropY ?? 50}%`, transform: `scale(${c.zoom ?? 1})`, transformOrigin: `${c.cropX ?? 50}% ${c.cropY ?? 50}%` }} />
    </div>;
  }
  if (element.type === "video" || element.type === "audio") {
    if (!interactive) {
      return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: 12, borderRadius: 12, backgroundColor: "#eef2ff", color: "#312e81", overflow: "hidden" }}><PresentationSymbol name={element.type === "video" ? "play" : "audio"} width={32} height={32} aria-hidden /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{element.content.title}</span></div>;
    }
    const props = { src: mediaUrl(element.content.attachmentId), controls: interactive, loop: element.content.loop, preload: "metadata" as const, "aria-label": element.content.title, style: { width: "100%", height: "100%" } };
    return element.type === "video" ? <video {...props} playsInline /> : <audio {...props} />;
  }
  if (element.type === "icon") {
    const Icon = presentationIcons[element.content.name];
    return <Icon width="100%" height="100%" color={element.content.color || "currentColor"} aria-label={element.content.label || element.content.name} role="img" />;
  }
  if (element.type === "chart") {
    const { data, kind, title, color = "#6366f1" } = element.content;
    const min = Math.min(0, ...data.map((point) => point.value));
    const max = Math.max(1, ...data.map((point) => point.value));
    const y = (value: number) => 210 - (value - min) / (max - min) * 165;
    const x = (i: number) => 40 + (i + 0.5) * 500 / data.length;
    const total = data.reduce((sum, point) => sum + Math.max(0, point.value), 0) || 1;
    return <div style={{ height: "100%", overflow: "auto" }}>
      <svg viewBox="0 0 580 270" width="100%" height={interactive ? "82%" : "100%"} role="img" aria-label={title}>
        <text x="290" y="24" textAnchor="middle" fill="currentColor" fontSize="18">{title}</text>
        {kind !== "pie" && <line x1="40" y1={y(0)} x2="550" y2={y(0)} stroke="currentColor" opacity="0.3" />}
        {kind === "line" && <polyline points={data.map((point, i) => `${x(i)},${y(point.value)}`).join(" ")} fill="none" stroke={color} strokeWidth="3" />}
        {data.map((point, i) => {
          const label = `${point.label}: ${point.value}`;
          if (kind === "pie") {
            if (point.value <= 0) return null;
            const start = -Math.PI / 2 + data.slice(0, i).reduce((sum, item) => sum + Math.max(0, item.value), 0) / total * Math.PI * 2;
            const end = start + Math.max(0, point.value) / total * Math.PI * 2 - 0.00001;
            return <path key={i} tabIndex={interactive ? 0 : undefined} aria-label={label} d={`M290 150 L${290 + Math.cos(start) * 100} ${150 + Math.sin(start) * 100} A100 100 0 ${end - start > Math.PI ? 1 : 0} 1 ${290 + Math.cos(end) * 100} ${150 + Math.sin(end) * 100} Z`} fill={color} opacity={0.35 + (i % 5) * 0.13}><title>{label}</title></path>;
          }
          return <g key={i} tabIndex={interactive ? 0 : undefined} aria-label={label}><title>{label}</title>
            {kind === "bar" ? <rect x={x(i) - 180 / data.length} y={Math.min(y(point.value), y(0))} width={360 / data.length} height={Math.max(1, Math.abs(y(point.value) - y(0)))} fill={color} /> : <circle cx={x(i)} cy={y(point.value)} r="5" fill={color} />}
            {data.length <= 10 && <text x={x(i)} y="242" textAnchor="middle" fontSize="12" fill="currentColor">{point.label.slice(0, 14)}</text>}
          </g>;
        })}
      </svg>
      {interactive && <details className="nodrag nowheel text-xs"><summary>{title}</summary><table style={{ width: "100%" }}><tbody>{data.map((point, i) => <tr key={i}><th scope="row" style={{ textAlign: "left" }}>{point.label}</th><td>{point.value}</td></tr>)}</tbody></table></details>}
    </div>;
  }
  if (element.type === "frame") return <div style={{ height: "100%", border: element.content.shape === "none" ? undefined : `2px solid ${element.content.color || "currentColor"}`, borderRadius: element.content.shape === "circle" ? "50%" : 12 }}>
    {element.content.label && <span style={{ position: "absolute", top: -24, fontSize: 14, color: element.content.color || "inherit" }}>{element.content.label}</span>}
  </div>;
  const { shape, fill, stroke, strokeWidth, opacity } = element.content;
  const w = element.width, h = element.height, inset = strokeWidth / 2, head = Math.min(Math.max(strokeWidth * 3, 10), w / 2);
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" style={{ opacity, overflow: "visible" }}>
    {shape === "rect" && <rect x={inset} y={inset} width={Math.max(0, w - strokeWidth)} height={Math.max(0, h - strokeWidth)} fill={fill || "none"} stroke={stroke || "currentColor"} strokeWidth={strokeWidth} />}
    {shape === "ellipse" && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w - strokeWidth) / 2} ry={Math.max(0, h - strokeWidth) / 2} fill={fill || "none"} stroke={stroke || "currentColor"} strokeWidth={strokeWidth} />}
    {(shape === "line" || shape === "arrow") && <line x1="0" y1={h / 2} x2={shape === "arrow" ? w - head : w} y2={h / 2} stroke={stroke || "currentColor"} strokeWidth={strokeWidth} />}
    {shape === "arrow" && <polygon points={`${w},${h / 2} ${w - head},${h / 2 - head / 2} ${w - head},${h / 2 + head / 2}`} fill={stroke || "currentColor"} />}
  </svg>;
}
