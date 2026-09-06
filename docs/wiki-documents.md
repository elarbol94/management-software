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

## Spelling and grammar

The **Rechtschreibung / Proofreading** menu selects German, Austrian German or
English directly, shows the check status and opens the next suggestion. Click
an underline, press **Alt+Enter** at an issue, or use **Alt+F7** to move to the
next one. Language changes show a saving state until acknowledged and keep
their request alive during navigation. The first correction receives keyboard
focus; Enter applies it and Escape returns to writing. Additional actions include ignoring a hint, adding
a spelling to the shared dictionary, replacing matching marked occurrences,
and disabling a rule.

Checks start after a 250 ms typing pause. One request runs at a time, with the
current paragraph first. Typing does not cancel an in-flight request. Results
are cached by exact text and applied against the current document, so changing
or moving text cannot apply stale offsets. Unchanged blocks and repeated text
reuse results. Edited paragraphs lose their old underlines immediately; code,
links, inline atoms and deleted suggestions are excluded. Hard breaks and
inline references retain their document offsets.

Suggestions are inserted as plain text, including empty replacements for
deletion. “Replace all” only changes identically marked text with the same rule;
it does not alter unmarked substrings or assume a grammar rule applies in every
context. Shared dictionary filtering happens in the browser, so dictionaries
larger than 500 words do not exceed the checking API's request limit.

LanguageTool runs privately in the Docker Compose `languagetool` service. Local
development needs a reachable `LANGUAGETOOL_URL`; the default Docker hostname
does not resolve outside that network. Text is sent to the configured service.
On failure, the editor enables browser spellchecking with the selected language
(availability depends on installed browser dictionaries), retains its normal
save behavior, and retries after 5, 10, 20, then at most 30 seconds. The menu also
offers an immediate retry. Actual checking latency depends on LanguageTool;
the 250 ms debounce is not a service-response guarantee.

## Validation

Run `npm run check` for TypeScript, lint and the unit suite. Focused regression
coverage is in `src/modules/wiki/actions.test.ts`, `lib/editor-draft.test.ts`,
`lib/document-template.test.ts`, `lib/docx-import.test.ts`,
`lib/spellcheck.test.ts`, `lib/spellcheck-controller.test.ts`, and the spellcheck
API route tests.

Stop the normal development server, then run:

```text
npm run e2e -- e2e/reliable-wiki-editor.spec.ts
```

This uses the throwaway database configured by Playwright. The browser cases
exercise delayed and lost save responses, stale recovery, layout-only recovery,
export after typing, competing editors, paper layout and SVG version recovery.
The SVG case delays preview loading to verify that an early label selection
opens its editor once the preview arrives.
Proofing cases use controlled service responses to exercise delayed checks,
correction/undo, keyboard and small-screen interactions, safe replacement,
deletion suggestions, dictionary limits, language persistence and outage recovery.
Run only these with `npm run e2e -- e2e/reliable-wiki-editor.spec.ts --grep proofing`.
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
