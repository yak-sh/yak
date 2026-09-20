# archive/web — the fleet server's browser client, as it stood at the cutover

These are the bytes of the web canvas that `src/server.ts` served until the
fleet server was dismantled (T-37584, design D-37573). They are kept, not
deleted, because the web door is a first-class interface that will come back —
just not on this wire (T-37583). **Nothing here builds, typechecks or runs.**
The modules it imported — `src/types.ts`, `src/client.ts`, `src/query.ts`,
`src/db.ts` and the rest of the fleet server — were deleted in the same change,
so the imports here dangle by design. `deno.json` excludes this directory from
fmt, lint and typecheck; treat it as a museum piece, read it, port from it,
do not try to make it green in place.

## What it was

A Preact single-page canvas, served with no build step. `src/server.ts`
transpiled `.ts`/`.tsx` on the way out with sucrase (`host.ts`, `imports.ts` —
both archived here) and rewrote bare specifiers to the vendored plain ESM that
now lives at the repo root in `vendor/`. `index.html` carried the import map;
`main.tsx` mounted the root canvas.

- `components/` — the renderer registry (`registry.ts`), the `<Entity eid view/>`
  front door (`Entity.tsx`), the curated views under `views/`, the card and
  canvas chrome, `nav.tsx` (routing, the card menu, the `cursor` mirror), and
  the property editors.
- `live.ts`, `live_client.ts`, `live_archetypes.ts` — the client half of sync:
  the cache signal, the socket, `applyLocal`/`mutate`, `ent()`, and the
  archetype resolution the views read through.
- `md.ts`, `highlight.ts` — the one markdown door (an html token renders as
  escaped text; an href that could carry a scheme is refused by its shape).
- `idb.ts`, `schema/idb.ts` — the browser-side IndexedDB retention floor.
- `paste.ts` — clipboard and drop text to an entity spec.
- `keybindings.ts`, `navigation.ts`, `layout.ts` — keys, routes, canvas layout,
  shared with the TUI while the TUI existed.
- `host.ts`, `imports.ts` — the static-serving and sucrase step.
- `styles.css` — the hand-written `Block_Element-modifier` sheet, Everforest.
- `sw.js`, `manifest.webmanifest`, the icons — the installable-app shell.

## The wire it spoke

- **`/ws` subscriptions.** A tab opened a socket, handed the server the
  entities it was looking at, and received the union of its subscriptions as
  **bundles** — never the whole database. Patches for anything subscribed were
  broadcast to every other tab. Headless clients POSTed `/apply` and reached
  the same broadcast.
- **Bundles.** One entity as `{entity, <comp>: {...}, ...}`; a `Change` was
  `{eid, name, comp}` as a PATCH, `comp: null` deleting the component and
  `{name:'entity', comp:null}` the entity.
- **The `:` line.** The command palette spoke the one verb table
  (`src/commands.ts`), the same vocabulary the TUI, the CLI's colon commands
  and the MCP `command` tool spoke.
- **`/query`** for the filter grammar (boards, search, `.near` semantic
  neighbours), results carrying a query-only `rank` component.

## The ports to come

- **`@yaks/web`** — the web *door*: a plugin that serves a browser client over
  `@yaks/api` (the `/apply`, `/query`, `/ws` doors) and `@yaks/sync`
  (subscriptions and the relay). The door, not the pixels.
- **`@yaks/canvas`** — the canvas *implementation*. The package already holds
  the canvas vocabulary (cards, pins, cameras as entities); this is where the
  renderer registry, the views and the stylesheet land when they are ported.

Jeff, 2026-09-19, verbatim: "`@yaks/canvas` should contain the actual canvas
web implementation. `@yaks/web` is probably a good name for the web door. which
should still exist! for sure. the TUI is one interface, MCP another, and web,
too. and there will be more. but it's not a priority right now, since it's
pretty much a tar-pit. so leave it in some kind of archive and we'll port it
later. in the meantime, just ensure it's considered in the design of other
things"
