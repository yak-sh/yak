# @yaks/alias

A name for an entity, worth as much as its id — the `alias` kind of
[@yaks/key](https://jsr.io/@yaks/key) for a
[@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/alias
# or: npx jsr add @yaks/alias
```

## The idea

`@yaks/graph` already has an alias: a `$cake` in a batch, which the graph mints
an id for and forgets the moment it answers. That is the right thing for a batch
— the alias is a pronoun. This is the other one, the name that outlives it:

```ts
// written twice, a week apart, and there is ONE lemon cake
g.apply([{
  entity: { eid: '$r' },
  alias: { name: 'recipe:lemon-cakes' },
  doc: { title: 'Lemon cakes', body: '3 lemons…' },
}])
```

The second write finds the name, resolves `$r` to the entity already wearing it,
and patches that. So a seed, a chunked import, and a page that saves the same
row every time it opens are idempotent — with no lookup table, and no eid to
have kept.

## A name is a key

`alias` is a **kind tag** on `@yaks/key`'s `key{of, value}` carrier, and that is
where everything structural lives: the key is its own entity, so one thing has
as many names as you write; its id is derived from the kind and the value, so a
name is unique by construction and reading one back is a `get`; and `of` dies by
release, so a deleted thing frees its names.

What this package adds is the two things particular to a name.

**The spelling.** `alias{name}` on the entity itself is what anyone writes; the
`normalize` phase lifts it into the key row it means. `name` is not a column —
the tag declares none — it is a word consumed before the vocabulary is ever
asked about it.

**The ladder.** A name goes wherever an eid goes:

```ts
g.apply([{ entity: { eid: '$c' }, comment: { target: 'recipe:lemon-cakes' } }])
g.apply([{ entity: { eid: 'recipe:lemon-cakes' }, recipe: { serves: 12 } }])
await g.address(['recipe:lemon-cakes']) // → Map { name → eid }
```

An id that **is** an entity always wins over a name that spells it. An id shaped
like a uuid or a content hash is never looked up at all, so a batch of ordinary
references costs nothing; anything else is one `get` for the whole batch.

## No sigil

`recipe:lemon-cakes` is a name with a colon in it, not a namespace the
vocabulary knows about. The fleet's own store has resolved bare names beside
eids for as long as it has had them, and a caller who wants their names
namespaced writes the prefix they like. A `$` would say the opposite of what
this word means.

## Composing it

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { aliasDoc, aliases } from '@yaks/alias'

let vocab = loadVocab([keyDoc, aliasDoc, mine], [keyKeywords])
let g = graph({ storage, vocab, plugins: [keys(vocab), aliases(vocab)] })
```

The carrier goes first: the name rides it.
