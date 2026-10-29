# CRT homepage mockup

A standalone, scripted homepage concept—not a replacement interface for the
apps.

Run `python3 -m http.server 4173` from the repository root, then visit
`http://localhost:4173/homepage-concepts/crt/`.

- Recipe box is selected initially. Scroll through three enhancements.
- The pinned conversation, CRT app, and crossed-out disk versions update
  together.
- Click another CSS-3D floppy to change all three scenes. A decorative disk copy
  animates into the drive; the selector remains available on the desk.
- Numbered controls offer an alternative to scrolling; normal keyboard button
  activation works. Motion is suppressed with `prefers-reduced-motion`.
- The recipe filter and shopping checkboxes can be used. All assistant messages
  and data changes are scripted; no model requests, storage, or paid APIs.
- Layout adapts to mobile, moving the conversation above the monitor.

Google Fonts provides optional display/handwriting fonts; local font fallbacks
keep the page usable offline. Illustrations are CSS and emoji (appearance varies
by platform), not production photography. No build step or dependencies.

## Checks

`deno test --allow-read homepage-concepts/crt` from the repository root runs the
shipped script on a linkedom document. It checks version controls and scroll
inputs, crossed-out versions, recipe filters, and app switching. No browser or
server runs. Spacing, mobile layout, and disk animation are reviewed on the
page.
