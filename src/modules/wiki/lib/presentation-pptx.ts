import { unzipSync, strFromU8 } from "fflate";
import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import { defaultPresentationSettings, presentationSnapshotSchema, type PresentationElement, type PresentationSnapshot, type PresentationTextElement } from "./presentation";

const nodes = (element: XmlElement, local: string) => Array.from(element.getElementsByTagNameNS("*", local));
const direct = (element: XmlElement, local: string) => Array.from(element.childNodes).filter((node): node is XmlElement => node.nodeType === 1 && (node as XmlElement).localName === local);
const attr = (element: XmlElement | undefined, key: string, fallback = 0) => Number(element?.getAttribute(key) ?? fallback) || fallback;
const hex = (element?: XmlElement) => { const value = element && nodes(element, "srgbClr")[0]?.getAttribute("val"); return value && /^[a-f\d]{6}$/i.test(value) ? `#${value}` : ""; };
const resolve = (base: string, target: string) => {
  if (/^[a-z]+:/i.test(target) || target.includes("\\") || target.includes("\0")) throw new Error("External relationship");
  const parts = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") { if (!parts.length) throw new Error("Invalid relationship"); parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
};
export type PptxImportWarning = { slide: number; code: "unsupported" | "formatting" | "externalMedia" | "missingMedia" | "animations" };
export type PptxImport = { snapshot: PresentationSnapshot; media: Array<{ key: string; name: string; mime: string; bytes: Uint8Array }>; warnings: PptxImportWarning[] };

/** Bounded OOXML import. Never follows external relationships or executes embedded objects. */
export function importPresentationPptx(bytes: Uint8Array, title: string): PptxImport {
  if (bytes.length > 50 * 1024 * 1024) throw new Error("PPTX exceeds 50 MB");
  let total = 0, count = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, { filter: (file) => {
    if (++count > 4000 || seen.has(file.name) || /(^|\/)\.\.(\/|$)/.test(file.name) || file.name.includes("\\")) throw new Error("Invalid PPTX archive");
    seen.add(file.name); total += file.originalSize;
    if (file.originalSize > 25 * 1024 * 1024 || total > 100 * 1024 * 1024 || file.originalSize > Math.max(1024 * 1024, file.size * 200)) throw new Error("PPTX decompression limit");
    return /^(ppt\/|\[Content_Types\]\.xml)/.test(file.name);
  } });
  const readXml = (name: string) => {
    if (!files[name] || files[name].length > 5 * 1024 * 1024) throw new Error("Missing or oversized presentation XML");
    const xml = strFromU8(files[name]);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML entities are not supported");
    const root = new DOMParser({ onError: (level) => { if (level !== "warning") throw new Error("Malformed XML"); } }).parseFromString(xml, "application/xml").documentElement;
    if (!root) throw new Error("Empty XML document");
    return root;
  };
  const relations = (name: string) => {
    const parts = name.split("/"), leaf = parts.pop()!;
    const path = `${parts.join("/")}/_rels/${leaf}.rels`;
    return files[path] ? new Map(nodes(readXml(path), "Relationship").map((rel) => [rel.getAttribute("Id")!, { target: rel.getAttribute("Target")!, external: rel.getAttribute("TargetMode") === "External", type: rel.getAttribute("Type") ?? "" }])) : new Map<string, { target: string; external: boolean; type: string }>();
  };
  const root = readXml("ppt/presentation.xml"), rels = relations("ppt/presentation.xml");
  const slides = nodes(root, "sldId");
  if (!slides.length || slides.length > 100) throw new Error("Use 1–100 slides");
  const size = nodes(root, "sldSz")[0];
  const factor = 960 / attr(size, "cx", 9144000), width = 960, height = attr(size, "cy", 5143500) * factor;
  if (height < 100 || height > 2000) throw new Error("Unsupported slide size");
  const elements: PresentationElement[] = [], steps: PresentationSnapshot["steps"] = [], media: PptxImport["media"] = [], warnings: PptxImportWarning[] = [];
  let serial = 0; const id = () => `pptx-${++serial}`;
  slides.forEach((slideRef, slideIndex) => {
    const slideNumber = slideIndex + 1;
    const warn = (code: PptxImportWarning["code"]) => { if (!warnings.some((warning) => warning.slide === slideNumber && warning.code === code)) warnings.push({ slide: slideNumber, code }); };
    const ref = slideRef.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? slideRef.getAttribute("r:id");
    const relation = rels.get(ref ?? "");
    if (!relation || relation.external) throw new Error("Missing slide relationship");
    const path = resolve("ppt/presentation.xml", relation.target), slide = readXml(path), slideRels = relations(path);
    const frameId = id(), x = (slideIndex % 3) * (width + 150), y = Math.floor(slideIndex / 3) * (height + 150);
    elements.push({ id: frameId, type: "frame", x, y, width, height, rotation: 0, background: hex(nodes(slide, "bgPr")[0]) || "#ffffff", content: { label: String(slideNumber), shape: "rect", color: "#6366f1" } });
    const step = { id: id(), elementId: frameId, notes: "" }; steps.push(step);
    if (nodes(slide, "timing").length || nodes(slide, "transition").length) warn("animations");
    // Masters and theme inheritance are not rendered as hidden, uneditable slide images.
    if ([...slideRels.values()].some((rel) => /slideLayout$/.test(rel.type))) warn("formatting");
    const visit = (tree: XmlElement, parentId: string, transform: { x: number; y: number; sx: number; sy: number }) => {
      for (const node of Array.from(tree.childNodes).filter((child): child is XmlElement => child.nodeType === 1)) {
        if (!["sp", "pic", "grpSp", "graphicFrame", "cxnSp"].includes(node.localName ?? "")) continue;
        if (node.localName === "graphicFrame") { warn("unsupported"); continue; }
        const properties = direct(node, node.localName === "grpSp" ? "grpSpPr" : "spPr")[0];
        const xf = properties && nodes(properties, "xfrm")[0];
        const off = xf && nodes(xf, "off")[0], ext = xf && nodes(xf, "ext")[0];
        const box = { x: transform.x + attr(off, "x") * transform.sx, y: transform.y + attr(off, "y") * transform.sy,
          width: Math.max(20, Math.min(20000, attr(ext, "cx", 300 / factor) * transform.sx)), height: Math.max(20, Math.min(20000, attr(ext, "cy", 80 / factor) * transform.sy)), rotation: Math.round(attr(xf, "rot") / 60000) % 360 };
        if (!xf) warn("formatting");
        const elementId = id();
        if (node.localName === "grpSp") {
          elements.push({ id: elementId, parentId, type: "frame", ...box, content: { label: "", shape: "none", color: "", isGroup: true } });
          const childOff = xf && nodes(xf, "chOff")[0], childExt = xf && nodes(xf, "chExt")[0];
          const sx = box.width / attr(childExt, "cx", box.width / transform.sx), sy = box.height / attr(childExt, "cy", box.height / transform.sy);
          if (box.rotation) warn("formatting");
          visit(node, elementId, { x: box.x - attr(childOff, "x") * sx, y: box.y - attr(childOff, "y") * sy, sx, sy }); continue;
        }
        if (node.localName === "pic") {
          const blip = nodes(node, "blip")[0], ref = blip?.getAttribute("r:embed") ?? blip?.getAttribute("r:link"), rel = ref ? slideRels.get(ref) : undefined;
          if (!rel || rel.external) { warn(rel?.external ? "externalMedia" : "missingMedia"); continue; }
          const imagePath = resolve(path, rel.target), image = files[imagePath], extension = imagePath.split(".").pop()?.toLowerCase();
          const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" } as Record<string, string>)[extension ?? ""];
          if (!image || !mime) { warn("missingMedia"); continue; }
          let item = media.find((entry) => entry.name === imagePath);
          if (!item) { item = { key: id(), name: imagePath, mime, bytes: image }; media.push(item); }
          if (nodes(node, "srcRect").length) warn("formatting");
          elements.push({ id: elementId, parentId, type: "image", ...box, content: { attachmentId: item.key, alt: nodes(node, "cNvPr")[0]?.getAttribute("descr")?.slice(0, 500) || "" } }); continue;
        }
        const paragraphs = nodes(node, "txBody")[0];
        if (paragraphs && nodes(paragraphs, "t").length) {
          if (properties && (direct(properties, "solidFill").length || direct(properties, "ln").length || nodes(properties, "custGeom").length)) warn("formatting");
          const runs: NonNullable<PresentationTextElement["content"]["runs"]> = [];
          nodes(paragraphs, "p").forEach((paragraph, index) => {
            if (index) runs.push({ text: "\n" });
            for (const text of nodes(paragraph, "t")) {
              const props = text.parentNode?.nodeType === 1 ? nodes(text.parentNode as XmlElement, "rPr")[0] : undefined;
              runs.push({ text: text.textContent ?? "", bold: props?.getAttribute("b") === "1", italic: props?.getAttribute("i") === "1", underline: props?.getAttribute("u") === "sng", color: hex(props) || undefined });
            }
          });
          const text = runs.map((run) => run.text).join("");
          if (text.length > 5000 || runs.length > 200) throw new Error("Text exceeds presentation limits");
          const firstProps = nodes(paragraphs, "rPr")[0], pProps = nodes(paragraphs, "pPr")[0];
          const align = pProps?.getAttribute("algn");
          elements.push({ id: elementId, parentId, type: "text", ...box, content: { text, runs, fontSize: Math.round(Math.max(8, Math.min(400, attr(firstProps, "sz", 2400) / 100 * 4 / 3))), bold: false, color: hex(firstProps) || "#172033", align: align === "ctr" ? "center" : align === "r" ? "right" : "left", font: "sans" } });
        } else {
          const preset = properties && nodes(properties, "prstGeom")[0]?.getAttribute("prst");
          if (preset && !["rect", "roundRect", "ellipse", "line", "rightArrow"].includes(preset)) warn("unsupported");
          const line = properties && direct(properties, "ln")[0];
          elements.push({ id: elementId, parentId, type: "shape", ...box, content: { shape: preset === "ellipse" ? "ellipse" : preset === "rightArrow" ? "arrow" : node.localName === "cxnSp" || preset === "line" ? "line" : "rect", fill: hex(properties && direct(properties, "solidFill")[0]), stroke: hex(line), strokeWidth: Math.min(200, attr(line, "w", 19050) * factor), opacity: 1 } });
        }
      }
    };
    const tree = nodes(slide, "spTree")[0];
    if (tree) visit(tree, frameId, { x, y, sx: factor, sy: factor });
    for (const rel of slideRels.values()) if (rel.type.endsWith("/notesSlide") && !rel.external) {
      const notes = readXml(resolve(path, rel.target));
      step.notes = nodes(notes, "sp").filter((shape) => nodes(shape, "ph")[0]?.getAttribute("type") === "body").flatMap((shape) => nodes(shape, "t").map((text) => text.textContent ?? "")).join("\n").slice(0, 5000);
    }
    if (elements.length > 500) throw new Error("Presentation exceeds 500 objects");
  });
  return { snapshot: presentationSnapshotSchema.parse({ title: title.trim().slice(0, 200) || "PowerPoint", elements, steps, background: "#ffffff", settings: defaultPresentationSettings }), media, warnings };
}
