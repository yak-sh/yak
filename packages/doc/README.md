# @yaks/doc

A shared `doc{title, body}` component for graph entities. Applications can use
the same text fields for editing, display, and search while keeping
domain-specific data in separate components.

## Install

```sh
deno add jsr:@yaks/doc
# or: npx jsr add @yaks/doc
```

## Example

```ts
const document = {
  entity: { eid: 'meeting-1' },
  doc: {
    title: 'Meeting notes',
    body: 'The next release is scheduled for Friday.',
  },
}
```

An entity is a record identified by `entity.eid`; each component is a named
object on it. The JSON object above is a bundle containing the `doc` component.
Compose `docDoc` (the exported JSON Schema document) with your domain vocabulary
to add shared text fields without repeating their definitions. The package
provides no storage: the graph's adapter persists the title and body.

## Two columns

| column  | what it is                          |
| ------- | ----------------------------------- |
| `title` | the one line the entity is known by |
| `body`  | the prose, as markdown              |

And deliberately nothing else. A slug can be stored by an addressing package, an
excerpt can be computed from the body, a renderer chooses its output format, and
graph provenance components record timestamps. None is a column of `doc`.

## Use

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { docDoc, docs } from '@yaks/doc'

import { ram } from '@yaks/ram'

const vocab = loadVocab([docDoc])
const g = graph({ storage: ram(vocab), vocab, plugins: [docs()] })

await g.apply([{
  entity: { eid: 'r1' },
  doc: { title: 'Lemon cake', body: '3 lemons, 200g sugar…' },
}])
```

Compose `docs()` once per graph. A vocabulary rejects a component declared
twice, so packages that need `doc` — [@yaks/mail](https://jsr.io/@yaks/mail) is
one — depend on this package and leave the composing to you, rather than
shipping a second copy of the component.

## Optional content-addressed body storage

`body` declares `store: "blob"` — a keyword this package **names** but does not
import. On its own it does nothing:

- Load without [@yaks/blob](https://jsr.io/@yaks/blob)'s `blobKeywords` and
  `body` is an ordinary text column.
- Load with them and compose `blobs(vocab, store)` to replace incoming text with
  its content address. Also configure read resolution (for example, the SQLite
  read override described in @yaks/blob) to return text instead of hashes.

Callers still write and read text; they do not handle the content hashes. This
can be enabled without changing the vocabulary declaration.

## Exports

The root import provides `docDoc`, `docs()`, the `DOC`, `TITLE`, and `BODY`
constants. `./vocab` exports the schema document and a `docs` array; `./rules`
exports the plugin factory expected by the CLI loader. `./views` exports
`views`, the portable [@yaks/render](../render) `Title` and `Body` of any entity
with a non-empty title or body, the body drawn from its Markdown by
[@yaks/markdown](../markdown). Note that root `docs()` is a function, unlike the
array in `./vocab`.

## Kind order

A **kind** is a component used to classify an entity for display. `doc` is a
kind, and it declares no `before`. A `before` may only name a kind the loaded
vocabulary declares, so a base package cannot order itself against components it
does not ship. Your own vocabulary decides which wins:

```ts
// recipe takes display-kind precedence over doc
const recipeSchema = {
  $defs: {
    recipe: {
      type: 'object',
      component: true,
      kind: true,
      before: ['doc'],
      properties: {},
    },
  },
}
```

## What is deliberately not here

Search (that is [@yaks/fts](https://jsr.io/@yaks/fts), over any text property,
not only this one), rendering, revisions, and access control
([@yaks/member](https://jsr.io/@yaks/member)). It imports no platform API, so
the same document loads on a server, in a worker, and in a browser tab.

## License

Apache-2.0
