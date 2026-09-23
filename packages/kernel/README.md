# @yaks/kernel

Shared identity and metadata components for a graph: the entity row, creation
and update provenance, decisions, comments, images, favorites and relationship
types. They are exported as JSON Schema documents, with a tool for creating
comments.

## Terms this README uses

The public API uses entities and components. SQL adapters store them in tables
and rows internally. Three terms are used below:

- an **entity** is a thing the graph knows about, identified by an `eid` (a
  string, commonly a UUID). It has no type property: an entity is whatever its
  components make it.
- a **component** is a named object stored on an entity — `doc: {title, body}`,
  `comment: {target}`. One entity can have many.
- a **bundle** is one entity's components as a JSON object, including its id.
  Writing is passing a list of bundles to `graph.apply()`, which commits all of
  them in one transaction or none.

A **vocabulary** is the set of component declarations a graph was loaded with
([@yaks/vocab](../vocab)). Its `vocab.json` is one such declaration, readable as
ordinary JSON. The package also implements a comment-creation tool.

## What it declares

- `entity{archetype}` — the row every entity has. `archetype` points at the
  entity describing its particular set of components
  ([@yaks/archetype](../archetype)), which maintains it; no client writes it,
  and the component is declared `wire: false` (excluded from the ordinary
  component input schema). A graph that wants human-readable ids adds
  [@yaks/id](../id), whose document adds `num` to this same row.
- the marks recording what happened to something and who did it — `created`,
  `updated`, `opened`, `archived`, `verified` — each with `at`, `by` and `via`
  properties that @yaks/graph stamps rather than a caller. `by` is the entity
  that wrote it and `via` is what it was written through (a session, a client).
  `verified` says somebody checked the entity against what it claims and found
  it holds; it is generic, so anything checkable carries it — a citation
  ([@yaks/git](../git)) is one thing that does — and only the act of checking
  writes it, never an edit to the entity.
- the marks recording what was decided about something — `proposed`, `decided`
  (with a verdict of `approved` or `declined`), `quarantined` (an annotation for
  applications to exclude a readable record from guidance), and `redaction`,
  which records that one property of one entity was replaced, keeping a hash of
  what was there so a claim about it can still be checked.
- the things that attach to an entity — `comment{target}`, which points a remark
  at any entity at all (the text itself is the `doc{body}` on the same entity),
  `image{w, h}` and `favorite`.
- eight relation tags: `about`, `delegates`, `reads`, `references`,
  `supersedes`, `supervises`, `wants` and `worked`. A link between two entities
  is itself an entity, carrying `edge{from, to}` plus one of these tags to say
  what the link means; see [@yaks/edge](../edge), which reads the `edge` keyword
  each of them declares. Other packages declare their own — `contains` and
  `requires` are [@yaks/task](../task)'s, `satisfies` is
  [@yaks/goal](../goal)'s.

It also declares one tool, `comment_new`, implemented in `tools.ts`: it writes a
new entity carrying `doc{body}` and `comment{target}`.

## Who a write is signed as

`created.by` identifies the writer supplied by the application. In the full CLI
composition, a write that did not arrive through an authenticated HTTP or MCP
request is signed as the process that made it: the `process` row that run wrote
about itself on the way in ([@yaks/process](../process)'s `started()`). A
program that runs twice is two writers — two `yak` commands over one database
file are two of them — so a name in config could not tell them apart, and a
process entity can.

## Human ids are not here

People type `T-37580`, and nothing about that is this package's: the number, the
letter, the allocator and the resolver are all [@yaks/id](../id)'s, and a graph
that never loads it has no numbers to show. This package declares the row they
are kept in and nothing more.

## The keywords

A vocabulary can be extended with custom JSON Schema keywords. This package adds
three that the core meta-model does not cover, registered by passing
`kernelKeywords` to `loadVocab(docs, [kernelKeywords])`:

| keyword    | declared on | meaning                                                                                                     |
| ---------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `governed` | a component | a project answers for entities carrying it — what a project's reach is computed over                        |
| `lazy`     | a component | its rows are not included in the snapshot a client loads at startup; a reader asks for them by partition    |
| `well`     | a property  | the name of a list of suggested values, offered for completion beside the values the property already holds |

A transcript line needs no keyword of its own. Being reached only by its
qualified filter name (`.entry.session=`, never a bare `.session=`) is what
makes it one, and the core meta-model already has a keyword for that:
`bare: false`.

## Entry points

`deno.json` names three, and a program imports only the ones it needs:

- `@yaks/kernel` — `kernelDoc`, the `spineDoc` and `marksDoc` subsets,
  `kernelKeywords` and `KERNEL_URI`. It does not re-export the tool factory.
- `@yaks/kernel/vocab` — the vocabulary documents and keywords, and nothing
  else. It reaches no storage, no SQL and no runtime API, so a browser tab can
  load it on its own.
- `@yaks/kernel/tools` — the implementation of `comment_new`.

## Example

```ts
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'

const vocab = loadVocab([kernelDoc], [kernelKeywords])
const g = graph({ vocab, storage: ram(vocab) })
await g.apply([{ entity: { eid: 'example' }, favorite: {} }])
console.log(await g.read('.favorite'))
```

Add [@yaks/id](../id) when entities should have numbers and `B-7` ids. Load
[@yaks/doc](../doc) and the `./tools` factory as well to use `comment_new`. This
package does not provide persistence: the example stores records in RAM.

## Compatibility

Deno, Node and browsers. The declarations and helpers use no platform APIs.
