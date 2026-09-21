# @yaks/kernel

The components most graphs of work need, as one JSON Schema document plus a
little code: the `entity` row every entity has, the marks recording who touched
a thing and when, a few things that attach to an entity, and the tags that give
an edge its meaning.

## Terms this README uses

These packages model data as entities and components rather than tables and
rows, so three terms come up constantly:

- an **entity** is a thing the graph knows about, identified by an `eid` (a
  UUID). It has no type column: an entity is whatever its components make it.
- a **component** is a named object stored on an entity — `doc: {title, body}`,
  `comment: {target}`. One entity can have many.
- a **bundle** is one entity's id together with some of its components. Writing
  is passing a list of bundles to `graph.apply()`, which commits all of them in
  one transaction or none.

A **vocabulary** is the set of component declarations a graph was loaded with
([@yaks/vocab](../vocab)). This package is one such declaration and nothing
else: `vocab.json` is plain JSON Schema, and anything that reads JSON can read
it.

## What it declares

- `entity{num, archetype}` — the row every entity has. `num` is the number this
  graph minted for it, counting up, and `archetype` points at the entity
  describing its particular set of components ([@yaks/archetype](../archetype)).
  No client writes either one: `num` is minted by storage, `archetype` is
  maintained by @yaks/archetype's plugin, and the component is declared
  `wire: false`.
- the marks recording what happened to something and who did it — `created`,
  `updated`, `opened`, `archived` — each with `at`, `by` and `via` columns that
  @yaks/graph stamps rather than a caller. `by` is the entity that wrote it and
  `via` is what it was written through (a session, a client).
- the marks recording what was decided about something — `proposed`, `decided`
  (with a verdict of `approved` or `declined`), `quarantined` (readable, but
  never handed out as guidance), and `redaction`, which records that one column
  of one entity was replaced, keeping a hash of what was there so a claim about
  it can still be checked.
- the things that attach to an entity — `comment{target}`, which points a remark
  at any entity at all (the text itself is the `doc{body}` on the same entity),
  `image{w, h}` and `favorite`.
- eight relation tags: `about`, `delegates`, `reads`, `references`,
  `supersedes`, `supervises`, `wants` and `worked`. A link between two entities
  is itself an entity, carrying `edge{from, to}` plus one of these tags to say
  what the link means; see [@yaks/edge](../edge), which reads the `relation`
  keyword each of them declares. Other packages declare their own — `contains`
  and `requires` are [@yaks/task](../task)'s, `satisfies` is
  [@yaks/goal](../goal)'s.

It also declares one tool, `comment_new`, implemented in `tools.ts`: it writes a
new entity carrying `doc{body}` and `comment{target}`.

## Who a write is signed as

`created.by` is not a username from a config file. When a write did not arrive
through an authenticated HTTP or MCP request, it is signed as the process that
made it: the `process` row that run wrote about itself on the way in
([@yaks/process](../process)'s `started()`). A program that runs twice is two
writers — two `yak` commands over one database file are two of them — so a name
in config could not tell them apart, and a process entity can.

## Human ids

People type `T-37580`, and that string is stored nowhere. What is stored is the
`entity.num` beside the entity; the letter is derived from the components the
entity has ([@yaks/id](../id)). So turning one into an `eid` is a read, and
`ids.ts` is the graph plugin that does it — it implements a plugin's `address`,
which `graph.address()` calls before a caller's ids are used, so the MCP server,
the HTTP `/query` endpoint and the command line all accept the ids people type.

A bare number (`37580`) resolves too, because the number is the identity. A
letter that disagrees with the entity's own is not resolved: the plugin leaves
it out of its answer, and the caller's string goes on to fail as the eid it is
not.

## The keywords

A vocabulary can be extended with custom JSON Schema keywords. This package adds
three that the core meta-model does not cover, registered by passing
`kernelKeywords` to `loadVocab(docs, [kernelKeywords])`:

| keyword    | declared on | meaning                                                                                                  |
| ---------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `governed` | a component | a project answers for entities carrying it — what a project's reach is computed over                     |
| `lazy`     | a component | its rows are not included in the snapshot a client loads at startup; a reader asks for them by partition |
| `well`     | a column    | the name of a list of suggested values, offered for completion beside the values already in the column   |

A transcript line needs no keyword of its own. Being reached only by its
qualified filter name (`.entry.session=`, never a bare `.session=`) is what
makes it one, and the core meta-model already has a keyword for that:
`bare: false`.

## Entry points

`deno.json` names four, and a program imports only the ones it needs:

- `@yaks/kernel` — everything below, re-exported.
- `@yaks/kernel/vocab` — the vocabulary documents and keywords, and nothing
  else. It reaches no storage, no SQL and no runtime API, so a browser tab can
  load it on its own.
- `@yaks/kernel/rules` — the graph plugins: here, just the human-id resolver.
- `@yaks/kernel/tools` — the implementation of `comment_new`.

## Compatibility

Deno and Node. A JSON document and a keyword registration; no runtime calls.
