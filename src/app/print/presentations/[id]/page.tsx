import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import {
  PRESENTATION_PAGE_SIZE,
  elementBounds,
  fitBoundsToPage,
  stepTarget,
  type PresentationElement,
} from "@/modules/wiki/lib/presentation";
import { getPresentation } from "@/modules/wiki/presentation-queries";
import { PrintButton } from "./print-button";

/**
 * The presentation as a PDF: one A4 landscape page per path step, each one the canvas
 * cropped to that step's camera. React Flow is deliberately absent — a print job has no
 * viewport to measure, so every element is placed from its own geometry and the whole
 * page is framed by a single transform.
 */

// The printed sheet is white regardless of the app theme, so element colours keep the
// contrast their author picked on a light canvas.
const FRAME_BORDER = "rgba(0,0,0,0.45)";

function ElementView({ element }: { element: PresentationElement }) {
  const box: CSSProperties = {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    // Rotation is around the element's own centre, matching what the canvas shows.
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    backgroundColor: element.background || undefined,
  };

  if (element.type === "text") {
    const { text, fontSize, bold, color, align } = element.content;
    return (
      <div
        style={{
          ...box,
          fontSize,
          fontWeight: bold ? 700 : 400,
          textAlign: align,
          color: color || undefined,
          lineHeight: 1.15,
          overflow: "hidden",
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
        }}
      >
        {text}
      </div>
    );
  }

  if (element.type === "image") {
    return (
      // Served by the existing attachment route, which enforces the session check.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/files/${element.content.attachmentId}`}
        alt={element.content.alt}
        style={{ ...box, objectFit: "contain" }}
      />
    );
  }

  if (element.type === "shape") {
    // Mirrors the canvas ShapeNode: same geometry, minus the editor chrome. Printed on
    // white, so an empty stroke falls back to black instead of the theme colour.
    const { shape, fill, stroke, strokeWidth, opacity } = element.content;
    const w = element.width;
    const h = element.height;
    const inset = strokeWidth / 2;
    const head = Math.min(Math.max(strokeWidth * 3, 10), w / 2);
    const mid = h / 2;
    return (
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ ...box, opacity, overflow: "visible" }}
        aria-hidden
      >
        {shape === "rect" && (
          <rect
            x={inset}
            y={inset}
            width={Math.max(w - strokeWidth, 0)}
            height={Math.max(h - strokeWidth, 0)}
            fill={fill || "none"}
            stroke={stroke || "#000"}
            strokeWidth={strokeWidth}
          />
        )}
        {shape === "ellipse" && (
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={Math.max(w - strokeWidth, 0) / 2}
            ry={Math.max(h - strokeWidth, 0) / 2}
            fill={fill || "none"}
            stroke={stroke || "#000"}
            strokeWidth={strokeWidth}
          />
        )}
        {shape === "line" && (
          <line x1={0} y1={mid} x2={w} y2={mid} stroke={stroke || "#000"} strokeWidth={strokeWidth} />
        )}
        {shape === "arrow" && (
          <>
            <line x1={0} y1={mid} x2={w - head} y2={mid} stroke={stroke || "#000"} strokeWidth={strokeWidth} />
            <polygon
              points={`${w},${mid} ${w - head},${mid - head / 2} ${w - head},${mid + head / 2}`}
              fill={stroke || "#000"}
            />
          </>
        )}
      </svg>
    );
  }

  const { label, shape, color } = element.content;
  // An invisible frame is a pure camera target: it exists to be zoomed at, not printed.
  if (shape === "none") return null;
  return (
    <div
      style={{
        ...box,
        border: `2px solid ${color || FRAME_BORDER}`,
        borderRadius: shape === "circle" ? "50%" : 12,
      }}
    >
      {label && (
        <span
          style={{ position: "absolute", left: 0, top: -26, fontSize: 18, fontWeight: 500, color: color || undefined }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The document title is what the browser offers as the PDF's file name.
  return { title: getPresentation(id)?.title ?? "" };
}

export default async function PresentationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }, t] = await Promise.all([requireUser(), params, getTranslations("wiki")]);
  const presentation = getPresentation(id);
  if (!presentation) notFound();

  // Frames print behind everything else, the same stacking the canvas uses.
  const ordered = [
    ...presentation.elements.filter((element) => element.type === "frame"),
    ...presentation.elements.filter((element) => element.type !== "frame"),
  ];

  return (
    <main className="bg-white text-black">
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        @media print { html, body { background: #fff; } }
      `}</style>
      <PrintButton />

      {presentation.steps.length === 0 ? (
        <p className="p-10 text-sm">{t("presentations.noSteps")}</p>
      ) : (
        presentation.steps.map((step, index) => {
          const target = stepTarget(step, presentation.elements);
          if (!target) return null;
          const { scale, offsetX, offsetY } = fitBoundsToPage(elementBounds(target));
          return (
            <section
              key={step.id}
              // break-before rather than break-after, so the last page is the last step
              // instead of an empty trailing sheet.
              className={index > 0 ? "break-before-page" : undefined}
              style={{
                position: "relative",
                width: PRESENTATION_PAGE_SIZE.width,
                height: PRESENTATION_PAGE_SIZE.height,
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
                  transformOrigin: "0 0",
                }}
              >
                {ordered.map((element) => (
                  <ElementView key={element.id} element={element} />
                ))}
              </div>
              {step.notes?.trim() && (
                // Speaker notes ride along at the foot of the page, over the canvas crop —
                // the sheet keeps its fixed A4 size, so pagination stays one page per step.
                <footer
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: "8px 24px 12px",
                    background: "rgba(255,255,255,0.92)",
                    borderTop: "1px solid rgba(0,0,0,0.2)",
                    fontSize: 12,
                    lineHeight: 1.4,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {step.notes.trim()}
                </footer>
              )}
            </section>
          );
        })
      )}
    </main>
  );
}
