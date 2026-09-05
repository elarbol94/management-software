# Presentation studio implementation

The canvas remains the primary workspace. Extend the existing indigo selection and
neutral application chrome instead of introducing a second design system. Use the
existing system font for controls, with explicit sans/serif/mono choices for authored
content. Palette: paper #ffffff, ink #172033, indigo #6366f1, teal #0d9488,
amber #f59e0b, rose #e11d48. Respect the existing dark-mode tokens for controls.

The right inspector uses labelled, expandable sections: Structure, Content,
Animation, Design and Sharing. Keep destructive and publishing actions explicit.
Labels remain left-aligned; the numbered path communicates actual playback order.
On small screens the inspector stays below the canvas. No ornamental motion;
authored transitions respect reduced-motion preferences.

Implementation sequence:

1. Add backwards-compatible hierarchy, content, animation and merge models.
2. Expose grouped transforms, locks, rich content and timeline authoring.
3. Add reusable themes/templates and searchable local assets/icons.
4. Enforce per-presentation permissions, opt-in co-editing and revocable public links.
5. Import editable PPTX content and export a self-contained offline player.
6. Add visual presenter previews, editable notes and timer controls.
7. Validate model invariants, access boundaries, migrations and browser workflows.

Co-editing uses bounded polling and three-way field merges. Conflicting edits to
the same property are surfaced for a deliberate resolution, never silently lost.
Public sharing is disabled by default. Media stays in the existing validated
attachment store. No external asset provider, hosted service or paid API is needed.
