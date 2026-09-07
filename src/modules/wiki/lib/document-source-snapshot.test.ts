import { describe, expect, it } from "vitest";
import { documentSourceSnapshots } from "./document-source-snapshot";
import type { TiptapNode } from "./tiptap";

const heading = (id: string, level = 1): TiptapNode => ({ type: "heading", attrs: { id, level }, content: [{ type: "text", text: id }] });
const paragraph = (text: string): TiptapNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: TiptapNode[]): TiptapNode => ({ type: "doc", content });

describe("document source snapshots", () => {
  it("reports outline parents across wrappers, skipped levels and empty headings", () => {
    const wrapped = doc(heading("root"), { type: "layoutSection", content: [heading("child", 4), { ...heading("empty", 1), content: [] }, heading("sibling", 2)] });
    const snapshot = documentSourceSnapshots(wrapped);
    expect(snapshot("child")?.headingStructure).toEqual({ level: 4, parentSectionId: "root" });
    expect(snapshot("sibling")?.headingStructure).toEqual({ level: 2, parentSectionId: "root" });
    expect(snapshot("sibling")?.headingParentTitle).toBe("root");
    expect(snapshot("empty")?.headingStructure).toBeUndefined();
  });
  it("includes subsection content but excludes sibling sections and outside changes", () => {
    const original = doc(heading("a"), paragraph("Details"), heading("child", 2), paragraph("Child details"), heading("b"), paragraph("Outside"));
    const snapshot = documentSourceSnapshots(original)("a")!;
    expect(snapshot.text).toBe("a\n\nDetails\n\nchild\n\nChild details");
    const unrelated = structuredClone(original); unrelated.content![5] = paragraph("Unrelated edit");
    expect(documentSourceSnapshots(unrelated)("a")).toEqual(snapshot);
    const related = structuredClone(original); related.content![3] = paragraph("New child details");
    expect(documentSourceSnapshots(related)("a")!.fingerprint).not.toBe(snapshot.fingerprint);
    expect(documentSourceSnapshots(original)("missing")).toBeNull();
  });
  it("preserves a section fingerprint after moving it, folding it, or normalizing attribute order", () => {
    const a = heading("a");
    const before = documentSourceSnapshots(doc(a, paragraph("Details"), heading("b")))("a");
    const moved = { ...a, attrs: { collapsed: true, level: 1, id: "a" } };
    expect(documentSourceSnapshots(doc(heading("b"), moved, paragraph("Details")))("a")).toEqual(before);
    expect(documentSourceSnapshots(doc({ ...a, content: [{ type: "text", text: "Renamed" }] }, paragraph("Details")))("a")!.fingerprint).not.toBe(before!.fingerprint);
  });
  it("detects edits beyond preview limits and media/formatting changes", () => {
    const original = doc(heading("a"), paragraph("x".repeat(2100)), { type: "commentableImage", attrs: { attachmentId: "image", alt: "Chart", nodeId: "node" } });
    const before = documentSourceSnapshots(original)("a")!;
    expect(before.text).toHaveLength(2000); expect(before.truncated).toBe(true); expect(before.imageCount).toBe(1);
    const after = structuredClone(original); after.content![1] = paragraph("x".repeat(2100) + "changed");
    const changed = documentSourceSnapshots(after)("a")!;
    expect(changed.text).toBe(before.text); expect(changed.fingerprint).not.toBe(before.fingerprint);
    after.content![1] = original.content![1]; after.content![2].attrs!.attachmentId = "replacement";
    expect(documentSourceSnapshots(after)("a")!.fingerprint).not.toBe(before.fingerprint);
    after.content![2] = original.content![2]; after.content![1] = paragraph("x".repeat(2100)); after.content![1].content![0].marks = [{ type: "bold" }];
    expect(documentSourceSnapshots(after)("a")!.fingerprint).not.toBe(before.fingerprint);
  });
  it("finds heading boundaries inside list/layout containers and supports whole documents", () => {
    const wrapped = doc(paragraph("Intro"), { type: "layoutSection", content: [heading("a"), paragraph("Inside"), heading("b"), paragraph("Other")] });
    expect(documentSourceSnapshots(wrapped)("a")!.text).toBe("a\n\nInside");
    expect(documentSourceSnapshots(wrapped)("")!.text).toContain("Intro");
    expect(documentSourceSnapshots(doc())("")!.text).toBe("");
  });
});
