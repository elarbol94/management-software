import { describe, expect, it } from "vitest";
import { sanitizePastedHtml } from "./paste-html";

describe("sanitizePastedHtml", () => {
  it("leaves ordinary structural HTML untouched", () => {
    const { html, hadImages } = sanitizePastedHtml("<h2>Title</h2><p>Some <strong>bold</strong> and <a href=\"https://example.com\">a link</a>.</p>");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com">a link</a>');
    expect(hadImages).toBe(false);
  });

  it("strips scripts and their content", () => {
    const { html } = sanitizePastedHtml('<p>safe</p><script>alert("x")</script><p>also safe</p>');
    expect(html).not.toContain("script");
    expect(html).not.toContain("alert");
    expect(html).toContain("safe");
  });

  it("strips style blocks, style attributes, and classes", () => {
    const { html } = sanitizePastedHtml('<style>.c{color:red}</style><p class="c1" style="color:red">text</p>');
    expect(html).not.toContain("<style");
    expect(html).not.toContain("class=");
    expect(html).not.toContain("style=");
    expect(html).toContain("text");
  });

  it("strips event handler attributes regardless of quoting", () => {
    const { html } = sanitizePastedHtml("<p onclick=\"evil()\" onmouseover='evil2()'>text</p>");
    expect(html).not.toMatch(/on\w+\s*=/i);
    expect(html).toContain("text");
  });

  it("removes link, meta, iframe, and comment noise", () => {
    const { html } = sanitizePastedHtml('<meta charset="utf-8"><!--StartFragment--><link rel="stylesheet" href="x.css"><iframe src="https://evil.example"></iframe><p>content</p><!--EndFragment-->');
    expect(html).not.toContain("<meta");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<!--");
    expect(html).toContain("content");
  });

  it("drops images and reports they were present", () => {
    const { html, hadImages } = sanitizePastedHtml('<p>before</p><img src="https://example.com/a.png" alt="a"><p>after</p>');
    expect(html).not.toContain("<img");
    expect(hadImages).toBe(true);
  });

  it("marks a plain pasted table so it matches the wiki's table node", () => {
    const { html } = sanitizePastedHtml("<table><tr><th>A</th></tr><tr><td>1</td></tr></table>");
    expect(html).toContain('<table data-markdown-table="">');
  });

  it("does not double-mark a table that already carries the attribute", () => {
    const { html } = sanitizePastedHtml('<table data-markdown-table=""><tr><td>1</td></tr></table>');
    expect(html.match(/data-markdown-table/g)).toHaveLength(1);
  });
});
