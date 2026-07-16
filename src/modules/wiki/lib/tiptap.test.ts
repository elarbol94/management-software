import { describe, expect, it } from "vitest";
import {
  buildFtsQuery,
  extractInternalSlugs,
  extractText,
  slugify,
  type TiptapNode,
} from "./tiptap";

const doc: TiptapNode = {
  type: "doc",
  content: [
    {
      type: "heading",
      content: [{ type: "text", text: "Onboarding" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Siehe " },
        {
          type: "text",
          text: "IT-Setup",
          marks: [{ type: "link", attrs: { href: "/wiki/it-setup" } }],
        },
        { type: "text", text: " und " },
        {
          type: "text",
          text: "extern",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Laptop bestellen" }],
            },
          ],
        },
      ],
    },
  ],
};

describe("extractText", () => {
  it("joins block text with newlines", () => {
    const text = extractText(doc);
    expect(text).toContain("Onboarding");
    expect(text).toContain("Siehe IT-Setup und extern");
    expect(text).toContain("Laptop bestellen");
  });

  it("handles empty documents", () => {
    expect(extractText(null)).toBe("");
    expect(extractText({ type: "doc", content: [] })).toBe("");
  });
});

describe("extractInternalSlugs", () => {
  it("finds internal wiki links only", () => {
    expect(extractInternalSlugs(doc)).toEqual(["it-setup"]);
  });

  it("ignores non-wiki and nested paths", () => {
    const external: TiptapNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "link", attrs: { href: "/accounting" } }],
            },
          ],
        },
      ],
    };
    expect(extractInternalSlugs(external)).toEqual([]);
  });
});

describe("slugify", () => {
  it("transliterates umlauts and strips symbols", () => {
    expect(slugify("Büro & Ausstattung")).toBe("buero-ausstattung");
    expect(slugify("Straße 12")).toBe("strasse-12");
  });

  it("falls back for empty titles", () => {
    expect(slugify("!!!")).toBe("seite");
  });
});

describe("buildFtsQuery", () => {
  it("builds prefix queries per token", () => {
    expect(buildFtsQuery("hallo welt")).toBe('"hallo"* "welt"*');
  });

  it("strips FTS syntax characters", () => {
    expect(buildFtsQuery('foo" OR "bar')).toBe('"foo"* "OR"* "bar"*');
  });

  it("returns null for empty input", () => {
    expect(buildFtsQuery("   ")).toBeNull();
  });
});
