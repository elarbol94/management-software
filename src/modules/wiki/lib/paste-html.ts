// Pre-processes clipboard HTML before it reaches the editor schema's own
// DOMParser (see wiki-editor.tsx handlePaste). ProseMirror's schema-aware
// parser already keeps only the nodes/marks each extension's parseHTML()
// rule recognizes and drops everything else - so this module doesn't build a
// tag-by-tag HTML->Tiptap converter, it only removes content the schema
// parser would otherwise happily pass through unchanged (scripts, styles,
// event handlers) or that we've decided never belongs inline (images), and
// nudges plain <table> markup to match the wiki's markdownTable node.

export type SanitizedPaste = { html: string; hadImages: boolean };

// Elements whose content must never reach the document - either because it's
// executable/style noise (script, style) or because the schema has no node
// for it and ProseMirror would otherwise fall back to dumping their text
// content into the surrounding paragraph.
const STRIPPED_ELEMENTS = ["script", "style", "link", "meta", "iframe", "object", "embed", "noscript", "head", "title"];

/**
 * Sanitizes clipboard HTML for paste into the wiki editor: strips scripts,
 * styles, classes, and event handlers; drops <img> (see hadImages); and
 * marks plain <table> elements so they parse into the editor's table node.
 */
export function sanitizePastedHtml(html: string): SanitizedPaste {
  let output = html;

  for (const tag of STRIPPED_ELEMENTS) {
    output = output.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    output = output.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }

  // Word/Outlook wrap most of their markup in conditional comments and
  // clipboard fragment markers (<!--StartFragment-->); none of it is content.
  output = output.replace(/<!--[\s\S]*?-->/g, "");

  const hadImages = /<img\b/i.test(output);
  // ponytail: dropped rather than uploaded - an <img> in pasted HTML points
  // at the source page/machine, not a file we host. Upgrade path: fetch and
  // re-upload through uploadInlineAttachment if inline paste-images are wanted.
  output = output.replace(/<img\b[^>]*\/?>/gi, "");

  // Event handler attributes, any quoting style.
  output = output
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "");

  // Inline styling/classes - none of the schema's parseHTML rules read them
  // for structure, so they'd only smuggle presentation (or styled-span
  // "bold") through. Dropped for simplicity; real <strong>/<em>/<a> etc.
  // still convert normally.
  output = output
    .replace(/\s(?:style|class)\s*=\s*"[^"]*"/gi, "")
    .replace(/\s(?:style|class)\s*=\s*'[^']*'/gi, "");

  // The wiki's table node only recognizes <table data-markdown-table>, so an
  // ordinary pasted table (Word/Excel/Sheets/browser) needs the marker added.
  output = output.replace(/<table\b(?![^>]*\bdata-markdown-table\b)([^>]*)>/gi, '<table$1 data-markdown-table="">');

  return { html: output, hadImages };
}
