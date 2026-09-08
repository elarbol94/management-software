# Wiki presentations

## Workspace tools

The editor separates the document header from its creation toolbar. **Path / Weg** opens a collapsible playback-order panel, including timing and speaker notes. Selecting an object opens Properties; **Tools / Werkzeuge** opens Properties, Document sources, Design, Assets or Comments in one right panel. Narrower screens use dismissible drawers. Sharing, history and playback settings open in dialogs; export and explicit Save are in the header actions menu. Save failures and pending source reviews remain visible with panels closed. The presentation library uses noninteractive first-stop previews and a single New menu for templates, document conversion and PowerPoint import.

Presentations use an infinite canvas and an ordered path of camera stops and
object animations. Content includes text, images, frames, shapes, icons, charts,
uploaded video and audio. The editor, player, previews and PDF export share the
stored content model. Internal editing and live following require sign-in;
owners can explicitly publish a separate read-only link or website embed.

## Links to document sections

New presentations created from a wiki page retain a source link on every heading
frame. Objects inside a linked frame inherit its source unless they have their
own link or explicitly remove it. Documents without headings link to the whole
page. Headings inside lists and layout sections are included in the outline.

Select an element and use **Document source → Open document section** to open the
current document at its heading. Navigation waits for pending presentation edits,
expands collapsed sections without editing the document and briefly highlights
the target. **Back to
presentation** restores the selected objects, camera position and active stop.
Heading badges and **Linked presentations** in the document open the corresponding
presentation element. **Back to document** restores the document selection and
scroll position. Return positions are kept in bounded, per-tab browser storage;
if storage is unavailable, ordinary section/element navigation still works.

Use **Link to document section** or **Change link** for existing decks, imported
presentations and individual elements. Choose a document and section (or the whole
document). **Remove link** also stops inheritance; **Use parent link** restores it.
These changes use the same save, undo, history and conflict checks as other canvas
edits. Competing changes to a source reference are treated as a single conflict.

Section identities survive heading renames and moves. Legacy headings get IDs
when loaded/saved; newly inserted or pasted headings receive distinct identities.
Deleted sections are reported as missing and can be relinked. Existing decks are
not matched retrospectively by heading text; use the manual link picker.

Frames linked directly to a document section follow its current heading by default,
including links created before heading synchronization was added. Heading changes
refresh when opening/returning to a presentation and during source checks. The editor
saves updated labels through its normal lease and version checks. The authenticated
player and presenter view also resolve current headings without requiring an editor
save first. Public/offline copies retain saved titles and never fetch document sources.

Editing a frame label manually keeps it as a custom title. Turn **Use document heading
as frame title** back on to follow the source again. Child elements with inherited
source links keep their own labels. Missing sections retain the last label. Automatic
heading updates do not add canvas undo steps; undoing a manual title edit restores
following the latest heading. Body content and review status remain independent.

Document backlinks include only presentations the current user can access. Public
players and reusable company templates exclude document source references.
Presenter view opens a linked source in a separate tab, leaving the audience's
presentation in place. Presenter view also shows a read-only source preview.

### Source previews and review

**Document source** shows a plain-text preview of the selected section (including
its subsections), with image counts and a link to read the full document. Previews
are limited to 2,000 characters; change detection compares the full section,
including formatting and media references. Moving an unchanged section or
collapsing a heading does not trigger a change. Edits outside the linked section
do not affect its status. Checks refresh every 30 seconds while the tab is visible,
on returning to the tab, and with **Refresh document sources**.

The source panel lists links needing attention across the presentation; select one
to focus its element. New generated presentations remember the source at creation.
Older and manually assigned links show **Not reviewed yet** until you compare the
preview with the presentation and choose **Mark source as reviewed**. Reviews of
an inherited link apply to its parent frame and inheriting children; explicit links
on other elements keep their own review status. Missing sections cannot be marked
as reviewed. Failed checks remain visible and can be retried.

Reviewing saves a content fingerprint through the normal canvas save, undo, history,
lease and conflict handling. Reviewing never overwrites slide content or stores a
document text copy in the canvas; automatic heading synchronization is separate. Fingerprints and source references are stripped from public
players and reusable templates. Source previews are authenticated, uncached reads;
wiki pages currently share workspace access. No database migration is required.
Manually inserting arbitrary document sections into an existing deck remains a future addition.

### Automatically adding subsections

New presentations generated from documents enable **Automatically include new
subsections** on their linked frames. After a document save, additions are checked
when opening/returning to the editor and during the existing visible-tab source
checks. New heading frames appear inside the linked parent's current canvas
position, including any newly added nested headings. They use a sibling's frame
style (or the parent's when there is no sibling). Document prose and images are
not copied by these incremental updates. The playback path, notes and timing are
preserved; use the existing path controls to add a separate stop when desired.

Existing decks opt in through the selected frame's **Document source** panel.
Changing the switch also applies to its currently linked, unlocked descendant
frames. Enabling starts with the current outline, preserving sections already
omitted from the presentation. Moving a frame on the canvas never breaks its link.

Updates wait until pending edits have saved and typing, gestures and dialogs have
finished. The editor searches for space within the parent and expands only the
necessary containers. Existing content keeps its position. If expansion would
collide with another section, a visible **Review new subsections** action opens
current/proposed previews. Approval can move the affected section with its contents
into free space; unrelated sections stay put. Approval rechecks both the document
and the canvas and asks for a fresh review if either proposal changed. Locked,
rotated, oversized or ambiguously linked containers remain pending with an
explanation. Existing heading moves must be reviewed first.

Successful additions show **Show** and **Undo**, without moving the camera or
selection. Undo remains available in the notification until another canvas edit;
the regular undo history also includes the addition as one separate edit. Section
identities are remembered through undo, deletion and saved reloads, preventing
removed frames from reappearing on the next source check. Ordinary source reviews
do not approve pending additions. Disabling the switch pauses future additions;
missing document sections retain their presentation content.

Only editable presentation workspaces add frames, through the usual autosave,
lease, optimistic version, conflict and history handling. Active players and
exports never insert frames. Optional tracking data lives in the existing canvas
JSON and is stripped from public copies and templates with other source metadata;
no database migration is needed.

### Approving heading structure changes

Changing a document heading level (for example `##` to `#`) adds **Review structure
change** in **Document source**. The review shows the old and new heading levels,
parent frames, and affected objects. Dependent changes are approved together: a
promoted heading can become the parent of sections that follow it. **Not now** keeps
the proposal pending. **Mark source as reviewed** only acknowledges source content;
it never approves structural changes.

**Apply change** checks the current document and canvas again. If either structure
or canvas changed during review, inspect the refreshed proposal and approve again.
Approval moves existing frames with their contents, uses 60-unit spacing, and refits
affected containers. Expanded containers that would collide with neighbours move
with their contents into free space. Unrelated objects, playback order, notes,
animations, object sizes, styling and custom titles are preserved. No frames are
created or deleted. The change is one undo/redo step and uses normal save, history,
lease and conflict handling. Open or reload playback after saving to see the approved
layout; an already running presentation does not rearrange itself.

New generated presentations record their approved heading structure. Older or
manually linked frames offer an initial review with the previous level shown as
**Not recorded**. No layout is silently accepted or changed. A missing or ambiguous
parent link must be corrected before applying; locked objects must be unlocked.
Rotated containers that need refitting and layouts outside size limits require
manual adjustment. Missing source sections retain their current layout.

Structure metadata is optional canvas JSON; no database migration is required.
Public players and templates strip it together with the other source metadata.

## Editing and recovery

- Title, elements, stops, backgrounds and playback settings save together after
  a 1.2-second pause. Save and Ctrl/Cmd+S also commit the field that has focus.
- Editor links, PDF export and Present wait for pending saves. Browser Back and
  other navigation without a link click use the fixed PATCH endpoint under
  `/api/wiki/presentations/[id]` for a final queued save. Closing/reloading a tab
  with pending work still displays the browser's unsaved-changes warning.
- All lease operations use `/api/wiki/presentations/[id]/lease`, so editor
  re-entry and cleanup do not post server actions to a different page.
- By default each editor has a lease. Editing controls are disabled while checking
  access or when another session holds the lease. Reloading can reclaim the
  same user's lease. An optimistic `expectedUpdatedAt` check prevents an older
  tab from overwriting a newer version even after a lease expires.
- Owners can enable **Simultaneous editing** under Sharing. Editors synchronize
  about every two seconds; independent field changes merge automatically, including
  separate changes to the same object. This is not character-level collaborative
  text editing: competing changes to one field or rich-text block cause an explicit
  conflict. Download the local draft before reloading to retain both versions.
  Incoming remote edits reset local undo history to avoid undoing someone else's work.
- Failed saves remain visible and can be retried with Save. A version conflict
  keeps the local canvas visible and offers a downloadable local draft before
  loading the newer version.
- Undo/redo includes the title, background and playback settings. History
  snapshots preserve previous saved states. Restore waits for pending edits,
  preserves the replaced state, and resets local undo history to the restored
  canvas. Revision dates use the selected UI language and Austrian time.
- At most 500 elements and 500 stops are supported. Geometry remains within the
  save schema's limits during group scaling.

On phones and tablets, the path and tools open as drawers over the canvas.
On desktop, the path and the active utility panel dock beside the canvas.

## Structure, animation and content

- Select a parent frame in **Structure**, or use **Attach contained objects** to
  connect existing objects inside a frame. Parent links are saved, acyclic and
  independent of visual overlap. Moving or rotating a parent carries its descendants.
  Resizing a section changes only its border, leaving descendant positions and sizes
  unchanged, including when resizing from the top or left. Explicit groups still
  scale their contents. Existing decks keep their layout until explicitly connected.
- Select or drag sections by their outline; empty interiors let clicks and canvas
  panning through. Subsections and other objects remain selectable when their parent
  is selected. Resize using the handles; dragging the selected outline moves it.
- Alignment guides follow the gesture and clear on release, cancellation or leaving
  the window. Resizing snaps only the edges being moved. Each drag, resize or rotation
  is one undo step, even when paused, and consecutive gestures remain separate.
- Shift-click objects, then **Group selection** for a persistent group. Clicking
  a member selects the outer group. Use the object selector to edit an individual
  member's content. Ungroup retains child positions and the surrounding frame.
- Locking an object prevents direct editing and manipulation. A locked parent
  locks its descendants; a locked child still travels with its parent. Locks are
  an editing aid, not a substitute for presentation access permissions.
- **Animation** inserts reveal/hide actions into the same ordered path as camera
  stops. Choose an action and duration for a path item. Reveals start hidden;
  backwards navigation deterministically restores visibility. Animating a frame
  or group includes its children. Object actions keep the preceding camera view.
- **Content** provides per-span bold/italic/underline/links, font choices, lists,
  image fit/crop/zoom and masks, searchable icons, and editable bar/line/pie charts.
  Charts expose individual values and an expandable data table during playback.
- Upload MP4/WebM video or MP3/M4A/OGG/WAV audio, up to 50 MB per file. Playback
  uses native browser controls and supported codecs; media never auto-plays with
  sound. Hidden media is paused. Files use the existing validated attachment store.
  The plain-text field and canvas double-click are plain-text edits and clear
  span-level formatting when their text changes.

## Color selection

Color controls share an Office-style palette with ten base-color columns and
five shades per column, a standard-color row, and custom hex/native color input.
The same picker is used for presentation text, frames, shapes, backgrounds,
charts, icons and company themes, as well as wiki typography, projects, calendars
and categories. Reset/automatic options retain the existing theme or transparent
behavior. Use arrow keys to move between swatches and Enter or Space to select.
Personal annotation identity colors keep their reserved, per-user choices.

## Company designs and assets

- Ten built-in starters cover timeline, hub, pitch, mind map, roadmap, workshop,
  report, demo, portfolio and lesson layouts.
- Save named company themes (background, foreground, accent and font) and reusable
  templates from the inspector. Applying a template replaces the current canvas
  after confirmation and remains undoable. Template copies exclude speaker notes.
- Company designs are intentionally workspace-wide, even when their source deck
  is restricted. Referenced assets are copied into the library, and copied again
  when reused, so deleting the source deck or template does not break those copies.
- Search the accessible local image library and bundled icon catalog. This does
  not include a third-party stock image subscription or remote search provider.

## Access, comments and public sharing

- A deck is workspace-editable by default. Owners can restrict it to selected
  members with View, Comment or Edit roles. Its creator and administrators retain
  owner access. Owners alone manage membership, public links and deletion.
- Viewers/commenters do not receive speaker notes or revision history. Commenters
  can select an object and leave a contextual comment, then resolve/reopen it.
- Public links are disabled by default. Creating one exposes the canvas and its
  referenced media to anyone holding the link, without an application account.
  The generated embed uses that same read-only player. Notes and editing controls
  are not included. Only a hash of the random token is stored; replacing or revoking
  the link immediately invalidates the old URL and its media endpoints.
- Public media endpoints serve only assets referenced by that deck. Direct file
  APIs continue to require authentication and presentation access.
- A surrounding reverse proxy or Cloudflare Access policy still applies. An
  application public link does not bypass that outer access gate. No deployment
  configuration is changed automatically.
- Revocation cannot erase downloaded offline files or copies already made by a
  recipient. Only publish content that is appropriate for that audience.

## PowerPoint import

Use **Import PowerPoint** on the presentation list. PPTX import creates editable
slide frames, text with basic formatting, shapes, supported images, groups and
speaker notes. Review the per-slide warnings before opening the result.

Import is deliberately not pixel-perfect: slide masters/themes, some typography,
rotated group transforms, advanced shapes, charts/SmartArt, embedded media and
PowerPoint animations may be simplified or omitted. External relationships are
never fetched. Limits: 50 MB compressed file, 100 slides, 500 objects, 100 MB total
expanded archive, 25 MB per archive entry, and bounded XML parsing/decompression.

## Presenting and exporting

- Arrow keys, Page Up/Down and Space navigate stops. Space on a focused control
  activates that control once. Home shows the overview. Escape leaves the player
  when browser fullscreen is inactive.
- Presenter notes windows have a channel specific to the player that opened
  them, so two players of the same presentation do not steer each other.
- Presenter view includes visual current/next previews, per-step editable notes
  with conflict checks and revision recovery, and pause/resume/reset timer controls.
- Live followers start at the host's current stop. Their keyboard and camera
  gestures do not override the host, and speaker notes are not sent to them.
  Host updates and stop requests use the fixed `/api/wiki/presentations/[id]/live`
  endpoint so navigating away cannot send them to an unrelated route.
- Reduced-motion preferences disable camera flights and entrance fades.
- PDF export preserves the chosen canvas background and fits rotated targets.
  Speaker notes are excluded by default; **Include speaker notes** opts in for
  a presenter copy.
- **Download offline presentation** produces one self-contained HTML file with
  interactive camera navigation, reveal/hide playback, charts, images and media.
  Open it directly in a modern browser without reaching this server. No external
  fonts, application JavaScript or CDN are required. It contains no speaker notes.
  Referenced media must be available and total at most 100 MB; larger decks should
  reduce media first. Native browser codec/fullscreen restrictions still apply.

## Validation

`npm run check` runs TypeScript, lint and unit tests. Presentation storage tests
use an in-memory database and the actual presentation migrations. The browser
suite is `npm run e2e -- e2e/wiki-presentations.spec.ts e2e/presentation-studio.spec.ts`; it uses the disposable
database described in the README and covers editing, autosave, restore, mobile
layout, rotation, PDF notes, edit leases, live following, hierarchy, rich content,
animations, simultaneous editors, roles, comments, company designs, public links,
offline media and presenter previews/notes/timers.

Document linking is covered by `npm run e2e -- e2e/document-presentation-links.spec.ts`
(generation, heading rename, section expansion, canvas restoration, manual linking,
backlinks, source previews, change detection, review persistence and failed-save navigation). No database migration is needed for links.

Migration `0055_redundant_nebula.sql` adds access settings, membership, comments and
the design library. Existing canvases remain backwards-compatible. Deploy through
the normal manual homeserver workflow after local validation; do not deploy from
the laptop automatically.
