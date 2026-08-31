import type {
  PresentationElement,
  PresentationFrameElement,
  PresentationStep,
  PresentationTextElement,
} from "./presentation";

/**
 * Built-in starting points offered on presentation creation. Each is plain data — the
 * same element/step shapes the editor already reads and writes — so a template is just
 * a canvas someone else arranged first. No separate rendering path needed.
 */

export const presentationTemplateIds = ["timeline", "hub", "pitch", "mindmap"] as const;
export type PresentationTemplateId = (typeof presentationTemplateIds)[number];

export type PresentationTemplate = {
  id: PresentationTemplateId;
  elements: PresentationElement[];
  steps: PresentationStep[];
};

function text(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  value: string,
  fontSize: number,
  bold: boolean,
): PresentationTextElement {
  return { id, type: "text", x, y, width, height, rotation: 0, content: { text: value, fontSize, bold, color: "", align: "center" } };
}

function frame(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  shape: "rect" | "circle" = "rect",
  color = "",
): PresentationFrameElement {
  return { id, type: "frame", x, y, width, height, rotation: 0, content: { label, shape, color } };
}

function step(id: string, elementId: string): PresentationStep {
  return { id, elementId };
}

// Horizontal frames along a line: a title, a connecting bar, and four chapters in a row.
const timeline: PresentationTemplate = (() => {
  const title = text("timeline-title", 0, -220, 900, 100, "Presentation Title", 56, true);
  const bar = frame("timeline-bar", 0, 98, 3460, 24, "", "rect", "#6366f1");
  const frames = [0, 1, 2, 3].map((i) => frame(`timeline-frame-${i + 1}`, i * 900, -20, 760, 260, `Chapter ${i + 1}`));
  return {
    id: "timeline",
    elements: [title, bar, ...frames],
    steps: [step("s0", title.id), ...frames.map((f, i) => step(`s${i + 1}`, f.id))],
  };
})();

// A center topic with four frames arranged around it, hub-and-spoke style.
const hub: PresentationTemplate = (() => {
  const center = frame("hub-center", -200, -200, 400, 400, "Topic", "circle", "#6366f1");
  const satellites = [
    frame("hub-frame-1", -160, -910, 320, 320, "Frame 1"),
    frame("hub-frame-2", 590, -160, 320, 320, "Frame 2"),
    frame("hub-frame-3", -160, 590, 320, 320, "Frame 3"),
    frame("hub-frame-4", -910, -160, 320, 320, "Frame 4"),
  ];
  return {
    id: "hub",
    elements: [center, ...satellites],
    steps: [step("s0", center.id), ...satellites.map((f, i) => step(`s${i + 1}`, f.id))],
  };
})();

// Title, then problem, solution, ask — the classic four-stop pitch.
const pitch: PresentationTemplate = (() => {
  const title = text("pitch-title", 0, -220, 900, 120, "Your Pitch", 56, true);
  const problem = frame("pitch-problem", 0, 0, 900, 280, "Problem");
  const solution = frame("pitch-solution", 0, 380, 900, 280, "Solution", "rect", "#0ea5e9");
  const ask = frame("pitch-ask", 0, 760, 900, 280, "Ask", "rect", "#0d9488");
  return {
    id: "pitch",
    elements: [title, problem, solution, ask],
    steps: [step("s0", title.id), step("s1", problem.id), step("s2", solution.id), step("s3", ask.id)],
  };
})();

// Center idea with radial branches at uneven radius/angle, plus one nested sub-branch —
// asymmetric on purpose, so it reads as a mindmap rather than another hub.
const mindmap: PresentationTemplate = (() => {
  const center = frame("mindmap-center", -180, -180, 360, 360, "Idea", "circle", "#e11d48");
  const branch1 = frame("mindmap-branch-1", 650, -450, 280, 180, "Branch 1");
  const branch2 = frame("mindmap-branch-2", 750, 150, 280, 180, "Branch 2");
  const detail = frame("mindmap-detail", 1150, 100, 220, 140, "Detail");
  const branch3 = frame("mindmap-branch-3", 200, 650, 280, 180, "Branch 3");
  const branch4 = frame("mindmap-branch-4", -750, 250, 280, 180, "Branch 4");
  const branch5 = frame("mindmap-branch-5", -650, -500, 280, 180, "Branch 5");
  const branches = [branch1, branch2, detail, branch3, branch4, branch5];
  return {
    id: "mindmap",
    elements: [center, ...branches],
    steps: [step("s0", center.id), ...branches.map((f, i) => step(`s${i + 1}`, f.id))],
  };
})();

export const presentationTemplates: Record<PresentationTemplateId, PresentationTemplate> = {
  timeline,
  hub,
  pitch,
  mindmap,
};
