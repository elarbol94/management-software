# Wiki document stability

The Wiki editor uses one content version for text and document layout. A save
includes that version and the tab's edit-lease session. Metadata changes such as
renaming a page do not invalidate a text save.

## Saving and recovery

- A successful response acknowledges only the submitted text and layout. Edits
  made during the request remain in the browser recovery journal and are saved
  next, including changes that only affect the layout.
- Retries take the current editor snapshot. If the server already committed the
  same snapshot but its response was lost, it acknowledges the existing version.
- Recovered drafts retain their original content version. If the server has
  changed, the draft becomes a recoverable conflict instead of overwriting it.
- “Load current” discards the browser draft. “Restore mine” submits the current
  local text, including edits made after the conflict appeared, with a version
  check. A newer server edit can therefore produce another conflict.
- Browser storage failures do not stop server saves. The editor displays a
  warning when local recovery cannot be written; keep the page open until the
  save succeeds.
- The document header and layout-panel exports wait for pending saves. A failed
  save or unresolved conflict prevents export of an older saved version.
- PDF headers and footers escape quoted font names correctly and align with the
  document's margins. Quoted font stacks previously broke their inline styles,
  leaving almost unreadable text and collapsing the three-column layout.

## Templates and Word import

Templates are prepared on the server and applied inside the editor. The normal
save path handles history, edit leases, versions, citations, backlinks and search
updates. Applying a template preserves existing text unless the author selects
“Replace text with template content”. Saving a template captures the current
editor content and layout, even before the autosave delay has elapsed.

The Word importer preserves spaces around formatting, nested bold/italic marks,
line breaks, nested lists, table paragraphs and unique heading targets. A failed
or malformed import returns an ordinary error. If text changes or the edit lease
is lost while an import runs, the result is rejected to preserve those edits.

## Validation

Run `npm run check` for TypeScript, lint and the unit suite. Focused regression
coverage is in `src/modules/wiki/actions.test.ts`, `lib/editor-draft.test.ts`,
`lib/document-template.test.ts`, and `lib/docx-import.test.ts`.

Stop the normal development server, then run:

```text
npm run e2e -- e2e/reliable-wiki-editor.spec.ts
```

This uses the throwaway database configured by Playwright. The browser cases
exercise delayed and lost save responses, stale recovery, layout-only recovery,
export after typing, competing editors, paper layout and SVG version recovery.
The document PDF rendering smoke test is `npx tsx scripts/verify-document-pdf.ts`.

## Remaining improvements

- Word interchange is not a lossless document-format conversion. Embedded images,
  complex pagination, advanced layout and all citation/footnote semantics need
  dedicated round-trip coverage and fuller import/export support. Use PDF for
  layout-sensitive delivery.
- Local recovery currently has one journal per page in each browser profile.
  Per-tab draft history with an explicit recovery chooser would better preserve
  independent offline drafts from multiple tabs.
- Version-history restoration is a separate workflow. It should eventually share
  the normal editor's lease, version checks and derived-index rebuilds.
- Very large documents and long offline sessions need extended performance and
  endurance testing; the regression suite does not establish an unlimited size
  or uptime guarantee.
