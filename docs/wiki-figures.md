# Images, diagrams and live file links

Use **Insert → Image or diagram** (German: **Einfügen → Bild oder Diagramm**)
to upload PNG, JPEG, WebP, SVG or SVGZ artwork, reuse a graphic, insert Mermaid,
or link a file. Pasting and dropping image files use the same upload path. A
placeholder keeps the insertion position while you continue typing; its Cancel
button removes the pending insertion. Uploads are limited to 50 MB, decoded
images to 40 million pixels and decompressed SVGs to 10 MB.

Write the caption immediately below the image. Figure numbers follow document
order, including diagrams and figures omitted from the index. Existing leading
labels such as “Abbildung 4:” or “Abbildung X:” are removed through normal
document history. Alternative text remains separate. Mark a decorative image
as unnumbered to exclude it from references and the figure list.

Select artwork to resize it with the corner handle or width field, align it,
wrap text on either side, or crop it. The handle supports arrow keys in 5% steps.
Choose **Done** (German: **Fertig**) or press Escape in the controls to return to writing.
Cropping keeps the original bytes and can be reset. Floating figures move with
their surrounding text; captions stay attached. Page and column widths limit
their size. Moving and replacing preserve figure identity; duplication creates
a separate target.

**Insert reference** searches captions and current numbers. References navigate
to their figures and renumber automatically. A missing target offers a replacement
picker. **Insert Abbildungsverzeichnis** places a live list at the cursor. The
list can span pages, with links and page numbers. Existing trailing lists are
loaded compatibly and are not appended a second time.

## Laptop folders

In the image picker, choose **Linked path → Connect folder**, then enter a path
relative to that folder, such as `plots/revenue.svg`. The browser remembers the
folder permission in local IndexedDB for that source. To paste an absolute
path, explicitly set its matching prefix, for example `C:\Research`; then
`C:\Research\plots\revenue.svg` resolves inside the connected folder. A prefix
does not grant access to another folder.

Folder access needs a secure browser context (HTTPS or localhost) and a browser
with `showDirectoryPicker`, such as a supporting desktop Chromium browser. See
the [File System Access API documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).
The picker detects support; other browsers offer uploads and server links.
Browser profiles and devices have separate permissions. Reconnect is an explicit
click and may require selecting the folder again after permission is revoked.

While the document is visible, linked laptop files are checked every two seconds,
and again on return, reconnection and export. Each check resolves the current
file by its path. Python can overwrite the file or atomically rename a replacement
onto it; an old file handle is not reused. The laptop browser must remain open
for laptop updates. Use a server source for unattended updates.

## Server folders

Configure named roots in `WIKI_FIGURE_ROOTS` before starting the application:

```dotenv
WIKI_FIGURE_ROOTS='{"research":"/mnt/research-figures"}'
```

For local Windows development, JSON backslashes must be escaped:

```dotenv
WIKI_FIGURE_ROOTS='{"research":"C:\\Research\\figures"}'
```

Only named roots are offered to users. Files must be inside the selected root,
whether entered relatively or as absolute server paths. Traversal and symlink
escapes are rejected. Root contents are readable by authenticated Wiki members;
configure directories intended for shared artwork only. The worker reads files
and never writes to those directories.

Docker Compose passes the variable through. Add the corresponding **read-only**
mount in a local deployment override, for example:

```yaml
services:
  app:
    volumes:
      - /srv/research/figures:/mnt/research-figures:ro
```

Container paths in the JSON must match the mount destinations. A background
worker checks registered links every five seconds even without open browsers.
Restart the app after changing root configuration. No homeserver configuration
is changed by local development; mounting and deployment are separate actions.

## Updates and recovery

An asset is identified by its source and relative path, so equal filenames in
different folders do not collide. All its document occurrences use its current
immutable revision. Content hashes skip unchanged files. Version checks prevent
concurrent updates from publishing over newer revisions. Partially written,
missing or invalid files retain the last valid artwork and are retried.

Select **Source** for the path, status, last successful update, retry, reconnect,
relink, pause/resume and revision history. Restoring a revision pauses its link.
Detach makes an independent copy. Editing an SVG in the artwork editor also
starts from a separate copy, preserving the live original and its history.

Updates do not edit document text or enter text undo history. Captions, comments,
crop, size and placement remain attached to the document figure. A same-stem JSON
[sidecar](graphics-sidecar.md) supplies the initial caption and literature source;
later source updates never replace caption edits in the document. Original SVG
text remains vector text; validated Python SVG styles are normalized for storage.

## Export and Word import

Exports wait for document saves and available source refreshes. If refresh fails,
the author can explicitly choose the last saved artwork or cancel. Each export
pins immutable asset revisions before rendering, so repeated occurrences cannot
mix versions if a source changes during export.

PDF rendering waits for images and fonts and resolves figure-list page numbers
from the final pagination. Internal reference and list destinations survive
assembly with the cover. Word exports embed raster images and SVG diagrams (with
a PNG fallback), preserve rectangular wrapping and reversible crop geometry,
and include caption, bookmark, reference and figure-list fields. Field refresh
is enabled: Word calculates its own final page numbers when fields are updated.

Word import retains embedded images and adjacent Caption/Beschriftung paragraphs.
Full lossless Word page-layout interchange is not supported. Direct export API
calls without a browser snapshot refresh server sources; unavailable or laptop
sources require the explicit `allowSaved=1` option to use cached images.

## Validation (6 September 2026)

- `npm run check`: 107 test files and 1,134 tests passed; no lint errors.
  The existing unused `ocrPageWords` warning in the municipality script remains.
- `npm run build`: production build passed.
- Playwright against the throwaway database: all 20 existing editor reliability
  scenarios and all 9 figure scenarios passed. Windows server teardown required
  stopping the test runner after its assertions had completed.
- Figure coverage includes typing during upload, cancellation, batch insertion,
  clipboard and drop, copy/move identities, undo/redo, captions, resizing, crop,
  wrapping at a page boundary, missing-reference repair, Mermaid, folder-handle
  persistence and recovery, live updates without document saves, Word media import
  and export, and multi-page figure lists with PDF destinations.
- Rendered PDF pages were inspected. Word media, crop and field XML were checked;
  visual inspection inside Microsoft Word remains a manual compatibility check.
  Browser tests use real persistent directory handles with a substituted native
  folder chooser; native OS permission prompts require a manual browser check.

The additive migration was generated, reviewed and applied locally. Deployment
requires configuring any desired server roots and read-only mounts; no homeserver
changes were made.
