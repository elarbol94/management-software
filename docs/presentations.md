# Wiki presentations

Presentations use an infinite canvas and an ordered path of stops. A stop points
to a text, image, frame or shape element. The editor, player and PDF export share
the stored geometry. Presentations and live followers require a signed-in user.

## Editing and recovery

- Title, elements, stops, backgrounds and playback settings save together after
  a 1.2-second pause. Save and Ctrl/Cmd+S also commit the field that has focus.
- Editor links, PDF export and Present wait for pending saves. Browser Back and
  other navigation without a link click use the fixed PATCH endpoint under
  `/api/wiki/presentations/[id]` for a final queued save. Closing/reloading a tab
  with pending work still displays the browser's unsaved-changes warning.
- Lease cleanup uses `/api/wiki/presentations/[id]/lease`, so it can finish after
  navigation without posting a server action to a different page.
- Each editor has a lease. All editing controls are disabled while checking
  access or when another session holds the lease. Reloading can reclaim the
  same user's lease. An optimistic `expectedUpdatedAt` check prevents an older
  tab from overwriting a newer version even after a lease expires.
- Failed saves remain visible and can be retried with Save. A version conflict
  keeps the local canvas visible and requires loading the newer version before
  editing can resume.
- Undo/redo includes the title, background and playback settings. History
  snapshots preserve previous saved states. Restore waits for pending edits,
  preserves the replaced state, and resets local undo history to the restored
  canvas. Revision dates use the selected UI language and Austrian time.
- At most 500 elements and 500 stops are supported. Geometry remains within the
  save schema's limits during group scaling.

On phones and tablets, **Path and properties** opens the editor panel below the
canvas. It remains alongside the canvas on larger screens.

## Presenting and exporting

- Arrow keys, Page Up/Down and Space navigate stops. Space on a focused control
  activates that control once. Home shows the overview. Escape leaves the player
  when browser fullscreen is inactive.
- Presenter notes windows have a channel specific to the player that opened
  them, so two players of the same presentation do not steer each other.
- Live followers start at the host's current stop. Their keyboard and camera
  gestures do not override the host, and speaker notes are not sent to them.
  Host updates and stop requests use the fixed `/api/wiki/presentations/[id]/live`
  endpoint so navigating away cannot send them to an unrelated route.
- Reduced-motion preferences disable camera flights and entrance fades.
- PDF export preserves the chosen canvas background and fits rotated targets.
  Speaker notes are excluded by default; **Include speaker notes** opts in for
  a presenter copy.

## Validation

`npm run check` runs TypeScript, lint and unit tests. Presentation storage tests
use an in-memory database and the actual presentation migrations. The browser
suite is `npm run e2e -- e2e/wiki-presentations.spec.ts`; it uses the disposable
database described in the README and covers editing, autosave, restore, mobile
layout, rotation, PDF notes, edit leases, live following and presenter notes.

No database migration is required for these behavior changes. Deploy through
the normal manual homeserver workflow after local validation.
