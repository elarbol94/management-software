import { PresentationContent } from "@/modules/wiki/components/presentation-content";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import {
  PRESENTATION_PAGE_SIZE,
  presentationCameraBounds,
  fitBoundsToPage,
  stepTarget,
  presentationCameraStep,
  presentationHiddenIds,
  unionBounds,
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

function ElementView({ element }: { element: PresentationElement }) {
  return <div style={{ position: "absolute", left: element.x, top: element.y, width: element.width, height: element.height, transform: `rotate(${element.rotation}deg)`, background: element.background || undefined }}><PresentationContent element={element} interactive={false} /></div>;
}
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireUser();
  const { id } = await params;
  // The document title is what the browser offers as the PDF's file name.
  return { title: getPresentation(id, viewer)?.title ?? "" };
}

export default async function PresentationPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notes?: string }> }) {
  const [viewer, { id }, t, { notes }] = await Promise.all([requireUser(), params, getTranslations("wiki"), searchParams]);
  const includeNotes = notes === "1";
  const presentation = getPresentation(id, viewer);
  if (!presentation) notFound();

  // Frames print behind everything else, the same stacking the canvas uses.
  const ordered = [
    ...presentation.elements.filter((element) => element.type === "frame"),
    ...presentation.elements.filter((element) => element.type !== "frame"),
  ];

  return (
    <main className="bg-white text-black" data-testid="presentation-print">
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        @media print { html, body { background: #fff; } }
      `}</style>
      <PrintButton includeNotes={includeNotes} />

      {presentation.steps.length === 0 ? (
        <p className="p-10 text-sm">{t("presentations.noSteps")}</p>
      ) : (
        presentation.steps.map((step, index) => {
          const camera = presentationCameraStep(presentation.steps, index);
          const target = camera ? stepTarget(camera, presentation.elements) : null;
          const hidden = presentationHiddenIds(presentation.elements, presentation.steps, index);
          const bounds = target ? presentationCameraBounds(target) : unionBounds(presentation.elements.map(presentationCameraBounds));
          if (!bounds) return null;
          const { scale, offsetX, offsetY } = fitBoundsToPage(bounds);
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
                background: presentation.background || "#fff",
                printColorAdjust: "exact",
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
                {ordered.filter((element) => !hidden.has(element.id)).map((element) => (
                  <ElementView key={element.id} element={element} />
                ))}
              </div>
              {includeNotes && step.notes?.trim() && (
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
