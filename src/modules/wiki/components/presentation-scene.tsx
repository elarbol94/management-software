import { PresentationContent } from "./presentation-content";
import { presentationCameraBounds, presentationCameraStep, presentationHiddenIds, stepTarget, unionBounds, type PresentationSnapshot } from "../lib/presentation";

export function PresentationScene({ presentation, index, mediaUrl, interactive = false }: {
  presentation: PresentationSnapshot; index: number; mediaUrl?: (id: string) => string; interactive?: boolean;
}) {
  const step = presentationCameraStep(presentation.steps, index);
  const target = step ? stepTarget(step, presentation.elements) : null;
  const b = target ? presentationCameraBounds(target) : unionBounds(presentation.elements.map(presentationCameraBounds)) ?? { x: 0, y: 0, width: 960, height: 540 };
  const hidden = presentationHiddenIds(presentation.elements, presentation.steps, index);
  const ordered = [...presentation.elements.filter((element) => element.type === "frame"), ...presentation.elements.filter((element) => element.type !== "frame")];
  return <svg viewBox={`${b.x - b.width * .12} ${b.y - b.height * .12} ${b.width * 1.24} ${b.height * 1.24}`} width="100%" height="100%" role="img" aria-label={presentation.title} style={{ background: presentation.background || "#fff", color: "#172033" }}>
    {ordered.filter((element) => !hidden.has(element.id)).map((element) => <foreignObject key={element.id} x={element.x} y={element.y} width={element.width} height={element.height} overflow="visible" transform={`rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`}>
      <div style={{ width: "100%", height: "100%", position: "relative", background: element.background || undefined }}><PresentationContent element={element} mediaUrl={mediaUrl} interactive={interactive} /></div>
    </foreignObject>)}
  </svg>;
}
