import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { applyGeometryChanges, defaultPresentationSettings, duplicatePresentationTree, groupPresentationElements, isPresentationElementLocked, presentationElementsSchema, presentationHiddenIds, presentationCameraStep, presentationSnapshotSchema, rotateElements, ungroupPresentationElements, type PresentationElement, type PresentationSnapshot } from "./presentation";
import { mergePresentation } from "./presentation-merge";
import { importPresentationPptx } from "./presentation-pptx";

const frame: PresentationElement = { id: "frame", type: "frame", x: 0, y: 0, width: 500, height: 400, rotation: 0, content: { label: "Frame", shape: "rect", color: "" } };
const text: PresentationElement = { id: "text", type: "text", x: 50, y: 60, width: 100, height: 50, rotation: 0, parentId: "frame", content: { text: "Hello", fontSize: 24, bold: false, align: "left", color: "" } };
const snapshot = (): PresentationSnapshot => ({ title: "Test", elements: [structuredClone(frame), structuredClone(text)], steps: [{ id: "stop", elementId: "frame" }], background: "", settings: defaultPresentationSettings });

describe("nested presentation objects", () => {
  it("moves descendants once even when the renderer reports both parent and child", () => {
    const result = applyGeometryChanges([frame, text], [{ id: "frame", x: 100, y: 200 }, { id: "text", x: 150, y: 260 }], 0);
    expect(result.elements[1]).toMatchObject({ x: 150, y: 260 });
  });
  it("scales children and refuses gestures that would invalidate child dimensions", () => {
    expect(applyGeometryChanges([frame, text], [{ id: "frame", width: 1000, height: 800 }], 0).elements[1]).toMatchObject({ x: 100, y: 120, width: 200, height: 100 });
    expect(applyGeometryChanges([frame, text], [{ id: "frame", width: 20 }], 0).elements).toEqual([frame, text]);
  });
  it("locks a subtree and preserves it through rejected geometry updates", () => {
    const elements = [{ ...frame, locked: true }, text];
    expect(isPresentationElementLocked(elements, "text")).toBe(true);
    expect(applyGeometryChanges(elements, [{ id: "text", x: 600 }], 0).elements).toEqual(elements);
  });
  it("rotates nested children around the shared pivot", () => {
    const result = rotateElements([frame, text], new Set(["frame"]), 90, { x: 250, y: 200 });
    expect(result[1].rotation).toBe(90);
    expect(result[1].x).not.toBe(text.x);
  });
  it("groups and ungroups without losing parent relationships", () => {
    const second = { ...text, id: "second", x: 200 };
    const grouped = groupPresentationElements([frame, text, second], new Set(["text", "second"]), "group");
    expect(grouped.find((element) => element.id === "group")?.parentId).toBe("frame");
    expect(grouped.find((element) => element.id === "text")?.parentId).toBe("group");
    expect(ungroupPresentationElements(grouped, "group")).toEqual([frame, text, second]);
  });
  it("duplicates a subtree with independent IDs and parents", () => {
    const result = duplicatePresentationTree([frame, text], new Set(["frame"]), new Map([["frame", "copy-frame"], ["text", "copy-text"]]));
    expect(result[3]).toMatchObject({ id: "copy-text", parentId: "copy-frame", x: 74 });
    expect(presentationElementsSchema.safeParse(result).success).toBe(true);
  });
  it("rejects cycles, missing parents, duplicate IDs and unsafe rich-text links", () => {
    expect(presentationElementsSchema.safeParse([{ ...frame, parentId: "frame" }]).success).toBe(false);
    expect(presentationElementsSchema.safeParse([text]).success).toBe(false);
    expect(presentationElementsSchema.safeParse([frame, frame]).success).toBe(false);
    expect(presentationElementsSchema.safeParse([frame, { ...text, content: { ...text.content, runs: [{ text: "Hello", href: "javascript:alert(1)" }] } }]).success).toBe(false);
  });
});

describe("animation sequence", () => {
  const steps = [{ id: "a", elementId: "frame" }, { id: "b", elementId: "text", action: "fadeIn" as const }, { id: "c", elementId: "text", action: "fadeOut" as const }];
  it("starts reveal targets hidden and restores visibility when navigating backwards", () => {
    expect(presentationHiddenIds([frame, text], steps, 0).has("text")).toBe(true);
    expect(presentationHiddenIds([frame, text], steps, 1).has("text")).toBe(false);
    expect(presentationHiddenIds([frame, text], steps, 2).has("text")).toBe(true);
    expect(presentationCameraStep(steps, 2)).toEqual(steps[0]);
  });
  it("reveals and hides complete groups", () => {
    const steps = [{ id: "a", elementId: "frame", action: "fadeIn" as const }];
    expect([...presentationHiddenIds([frame, text], steps, -1)]).toEqual(["frame", "text"]);
    expect(presentationHiddenIds([frame, text], steps, 0).size).toBe(0);
  });
});

describe("co-editing merge", () => {
  it("merges independent fields of the same object", () => {
    const base = snapshot(), local = structuredClone(base), remote = structuredClone(base);
    local.elements[1].x = 70; remote.elements[1].y = 80;
    const result = mergePresentation(base, local, remote);
    expect(result.conflicts).toEqual([]); expect(result.snapshot.elements[1]).toMatchObject({ x: 70, y: 80 });
  });
  it("reports competing changes and deletion-versus-edit instead of silently losing data", () => {
    const base = snapshot(), local = structuredClone(base), remote = structuredClone(base);
    local.elements[1].x = 70; remote.elements[1].x = 80;
    expect(mergePresentation(base, local, remote).conflicts).toEqual(["elements.text.x"]);
    remote.elements.pop(); expect(mergePresentation(base, local, remote).conflicts).toContain("elements.text");
  });
  it("keeps concurrent additions and path insertions", () => {
    const base = snapshot(), local = structuredClone(base), remote = structuredClone(base);
    local.elements.push({ ...text, id: "new-local" }); remote.elements.push({ ...text, id: "new-remote" });
    local.steps.push({ id: "local", elementId: "new-local" }); remote.steps.push({ id: "remote", elementId: "new-remote" });
    const result = mergePresentation(base, local, remote);
    expect(result.conflicts).toEqual([]); expect(result.snapshot.elements).toHaveLength(4); expect(result.snapshot.steps).toHaveLength(3);
    expect(presentationSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
  });
});

const xml = (content: string) => strToU8(content);
export function pptxFixture(extra = "") {
  return zipSync({
    "ppt/presentation.xml": xml('<p:presentation xmlns:p="urn:p" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>'),
    "ppt/_rels/presentation.xml.rels": xml('<Relationships xmlns="urn:r"><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>'),
    "ppt/slides/slide1.xml": xml(`<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr b="1" sz="2800"/><a:t>Hello PowerPoint</a:t></a:r></a:p></p:txBody></p:sp>${extra}</p:spTree></p:cSld></p:sld>`),
  });
}
describe("PowerPoint import", () => {
  it("imports editable text, geometry, bold spans and frame hierarchy", () => {
    const result = importPresentationPptx(pptxFixture(), "Deck");
    expect(result.snapshot.steps).toHaveLength(1);
    expect(result.snapshot.elements[1]).toMatchObject({ type: "text", x: 96, y: 96, content: { text: "Hello PowerPoint", runs: [{ text: "Hello PowerPoint", bold: true }] } });
    expect(result.snapshot.elements[1].parentId).toBe(result.snapshot.elements[0].id);
  });
  it("reports unsupported objects", () => {
    expect(importPresentationPptx(pptxFixture("<p:graphicFrame/>"), "Deck").warnings).toContainEqual({ slide: 1, code: "unsupported" });
  });
  it("rejects malformed archives and XML entities", () => {
    expect(() => importPresentationPptx(new Uint8Array([1, 2, 3]), "Deck")).toThrow();
    expect(() => importPresentationPptx(zipSync({ "ppt/presentation.xml": xml('<!DOCTYPE doc [<!ENTITY x "bad">]><doc/>') }), "Deck")).toThrow(/entities/);
  });
  it("rejects decompression bombs before extracting", () => {
    expect(() => importPresentationPptx(zipSync({ "ppt/bomb.xml": new Uint8Array(26 * 1024 * 1024) }), "Deck")).toThrow(/limit/);
  });
});
