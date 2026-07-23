# View roles, rendering doors, and the UI split

The rendering system grows from "a registry of entity views" into a small,
layered vocabulary: three doors keyed by what the call site knows, view names
that resolve hierarchically, and a dumb/smart UI split. Nothing here is a
framework — every piece is a curated list plus a resolution rule.

## The three doors — epistemics at the boundary

What a call site KNOWS picks its door; no door ever guesses.

- `<Entity eid|ent view>` — an entity through a view (the front door, today's
  `<View>`). `ent` skips a cache lookup when the caller already holds one.
- `<Prop ent|eid prop="comp.column">` — one typed value. The dotted path is a
  static `comps` lookup, so the PropType `t` is GUARANTEED — matchers here
  never sniff. (`prop="entity.num"` arrives with T-3684, when num leaves the
  spine.)
- `<Val value>` — an untyped value: constructor checks (`Date`, `URL`),
  distinctive shapes (the id grammar). Never used where a type is knowable;
  never sniffs prose.

## Views: qualifiers + role, resolved by suffix walk

A view name is a dotted path — container qualifiers left, ROLE rightmost:
`Board.List.Tile`. Resolution strips the leftmost qualifier until some
renderer matches (`Board.List.Tile` → `List.Tile` → `Tile`), then component
scores break ties within the level, as today. Registering a short name serves
every longer ask; a long name specializes one surround. ~5 lines in
`resolve()`.

The roles, ordered by content completeness:

| role     | intent                              | shape        |
| -------- | ----------------------------------- | ------------ |
| `Inline` | identify it, in flowing content     | span/anchor  |
| `Tile`   | summarize it as a compact block     | block        |
| `Full`   | the whole entity (replaces `Show`)  | fills frame  |
| `Title`  | head only — the frame shows rest    | one line     |
| `Cell`   | one prop in a grid (mostly `Prop`)  | cell         |

Rules:

- Entity kinds NEVER appear in view names — matchers own shape
  (`Task.Row` dies; a board column asks `Board.List.Tile`).
- Format views (`Markdown`, `JSON`, `Debug`, `Schema`) stay explicit leaves
  with `file` forms — asked by name, never walk-resolved.
- Every other axis has an owner and stays OUT of the name: size → container
  queries; register → a `Debug.*` qualifier; platform → `extend()` overlays;
  serialization → `file` forms. The view string is one-dimensional forever.

## Concepts (the db already had them right)

- **card** = a viewing: `{target_eid, view}`. **pin** = a placement:
  `{canvas_eid, x..z}`. A canvas window is an entity with both; the URL root
  is a card WITHOUT a pin — pages and pins are the two hosts of a card.
- The card frame asks `Card.Full` → `Full`; the `Card?: Render` variant field
  and the `context='Card'` prop both dissolve into the walk.
- **Chip** = the dumb UI atom painting a `T-123` id. eid = uuid; id = the
  `T-123` string. "Id" stops being a view; `Inline` is the role, and a task's
  Inline is chip + dot + truncated title — meaningful in a sentence.

## The prop registry (editors.tsx grows a face)

The editor registry becomes the PROP registry — one entry per PropType kind,
owning both faces of knowing what a value is:

- `show?: (value, t) => face` — the display (the cafe_car `Presenter#show`).
  `'time'` renders relative words + full-stamp tooltip (absorbs `ago`/
  `Stamp`); `'url'` renders a link. New PropTypes: `time`, `url` in `comps` —
  declared once, they flow to grammar docs and editors for free.
- `Edit` stays, but `mode` dies: registration composes `inline(NumEdit)` /
  `popout(EnumEdit)` — exactly two layout idioms, owned by two audited
  wrappers (the anchor juggling moves inside `popout`).
- `Prop`'s ad-hoc text logic (`String(value)`, the eid→title special case,
  the `show` paint escape hatch) deletes into the registry.

## Ambient context: only level-skippers

The ONLY ambient mechanism is the `{href}` stack in `el()` — à la carte
preact context, no unified "context" object:

- `href` on any element: no ancestor href → render `<a>`, original tag joins
  the class list (`.div`) so styles still bind; provide `{href}`.
- Ancestor href equal → drop it (cell links entity, title would too).
- Ancestor href different → keep the tag, `role='link'` + `follow(href)` —
  a JS-demoted nested link (loses native new-tab forms; acceptable for
  nested controls).
- `Prop`'s `handle` ▾ is the same collision (edit-click inside a link) and
  dissolves into the stack.

## UI doctrine (M-6626)

- Dumb `el()` atoms: a few lines each, ALL in `components/ui.tsx`; they
  designate LOOK only, never touch app state — if it knows an eid, it's smart.
- Advanced-but-stateless interactions (popover, typeahead) in
  `components/ui/`; state belongs to the caller.
- Names are generic and visual-semantic: `danger` not red, `Card` not Task,
  `Dot-complete` not `Task_Dot-done`. Any look is borrowable without behavior.
- One CSS file per block ↔ one UI element family, same name.

## Migration notes

- `card.view` is LIVE DATA: rename ships with (1) a one-time apply sweep
  patching stored names and (2) a small alias map in `resolve()`
  (`Show → Full`, …) so old `?v=` URLs and frozen pages never fall to JSON.
- Rename order: mechanics first (walk), vocabulary second (roles + sweeps),
  cosmetics last (`View`→`Entity`, `Id.tsx`→Chip-in-ui.tsx).
- The TUI rides along: same registries, `extend()` overlays untouched.
