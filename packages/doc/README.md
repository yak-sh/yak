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

Compose `docDoc` with your domain vocabulary to add shared text fields without
repeating their definitions in each component.

## Two columns

| column  | what it is                          |
| ------- | ----------------------------------- |
| `title` | the one line the entity is known by |
| `body`  | the prose, as markdown              |

And deliberately nothing else. A `slug` is addressing, an `excerpt` is derived,
a `format` is a rendering decision, and the clock belongs to the graph. Each is
its own component on the same entity — which is the point of components.

## Use

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { docDoc, docs } from '@yaks/doc'

let vocab = loadVocab([docDoc, mine])
let g = graph({ storage, vocab, plugins: [docs()] })

g.apply([{
  entity: { eid: 'r1' },
  doc: { title: 'Lemon cake', body: '3 lemons, 200g sugar…' },
}])
```

Compose `docs()` once per graph. A vocabulary refuses a component declared
twice, so packages that need `doc` — [@yaks/mail](https://jsr.io/@yaks/mail) is
one — depend on this package and leave the composing to you, rather than
shipping a second copy of the word.

## The body may be content-addressed, and `doc` never knows

`body` declares `store: "blob"` — a keyword this package **names** and does not
import. It is inert on its own:

- Load without [@yaks/blob](https://jsr.io/@yaks/blob)'s `blobKeywords` and
  `body` is an ordinary text column.
- Load with them and compose `blobs(vocab, store)`, and the text is swapped for
  its address on the way into the row and back on the way out.

The same document, the same writes, the same reads. A graph grows into
content-addressed storage without touching its vocabulary, and `@yaks/doc`
depends on nothing to make that true.

## Kind order

`doc` is a kind, and it declares no `before`. A `before` may only name a kind
the loaded vocabulary declares, so a base package cannot order itself against
words it does not ship. Your own document says which wins:

```ts
// recipe takes display-kind precedence over doc
{ recipe: { type: 'object', kind: true, before: ['doc'], properties: { … } } }
```

## What is deliberately not here

Search (that is [@yaks/fts](https://jsr.io/@yaks/fts), over any text property,
not only this one), rendering, revisions, and access control
([@yaks/member](https://jsr.io/@yaks/member)). It imports no platform API, so
the same document loads on a server, in a worker, and in a browser tab.

## License

Apache-2.0
