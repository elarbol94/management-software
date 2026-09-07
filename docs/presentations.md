# Wiki presentations

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

Document backlinks include only presentations the current user can access. Public
players and reusable company templates exclude document source references.
Presenter view opens a linked source in a separate tab, leaving the audience's
presentation in place. Source previews, change notifications and adding individual
sections to an existing deck are future additions.

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

On phones and tablets, **Path and properties** opens the editor panel below the
canvas. It remains alongside the canvas on larger screens.

## Structure, animation and content

- Select a parent frame in **Structure**, or use **Attach contained objects** to
  connect existing objects inside a frame. Parent links are saved, acyclic and
  independent of visual overlap. Moving, resizing or rotating a parent carries
  its descendants. Existing decks keep their layout until explicitly connected.
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
backlinks and failed-save navigation). No database migration is needed for links.

Migration `0055_redundant_nebula.sql` adds access settings, membership, comments and
the design library. Existing canvases remain backwards-compatible. Deploy through
the normal manual homeserver workflow after local validation; do not deploy from
the laptop automatically.
