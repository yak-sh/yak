# @yaks/doc

A shared `doc` component for an entity's title and Markdown body, with portable
views for displaying both. Applications use the same text for editing, display,
and search while keeping domain-specific data in separate components.

A **doc** is the [component](../graph/README.md#data-model) carrying the text a
person reads: `doc: { title: 'Meeting notes', body: 'Ana chaired…' }`. Its
**title** is the one line an [entity](../graph/README.md#data-model) is known by
(`doc.title`); its **body** is the prose as Markdown (`doc.body`). Neither
property is required.

## Use

Load `docDoc` beside your own [vocabulary](../vocab/README.md#vocabulary) and
compose `docs()` once per [graph](../graph/README.md#data-model). The
[storage](../graph/README.md#data-model) you supply holds the title and body.

```ts
import { docDoc, docs } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab([docDoc])
const g = graph({ storage: ram(vocab), vocab, plugins: [docs()] })
await g.install()
await g.apply([{
  entity: { eid: 'meeting-1' },
  doc: { title: 'Meeting notes', body: 'The release is scheduled for Friday.' },
}])
equal(await g.read('.doc'), [{
  entity: { eid: 'meeting-1' },
  doc: { title: 'Meeting notes', body: 'The release is scheduled for Friday.' },
}])
```

Packages that need `doc`, such as [@yaks/mail](../mail/README.md), depend on
this package rather than declare a second copy. Compose its vocabulary once:
loading a component declaration twice is refused.

## Install

```sh
deno add jsr:@yaks/doc
# Node projects can use: npx jsr add @yaks/doc
```

## Exports

| Import            | Exports                                  | Purpose                                                            |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `@yaks/doc`       | `docDoc`, `docs`, `DOC`, `TITLE`, `BODY` | Vocabulary document, plugin factory, and component/property names. |
| `@yaks/doc/vocab` | `docDoc`, `docs`, `description`          | Vocabulary documents and package description for a loader.         |
| `@yaks/doc/rules` | `rules`                                  | Plugin array factory for a loader.                                 |
| `@yaks/doc/views` | `views`                                  | Portable `Title` and `Body` views.                                 |

Root `docs()` returns a [plugin](../graph/README.md#data-model) with the
vocabulary and no hooks. In `./vocab`, `docs` is an array of vocabulary
documents. `rules()` returns the root plugin in an array; it contributes no
write-time rules.

```ts
import { BODY, DOC, docs as plugin, TITLE } from '@yaks/doc'
import { docs } from '@yaks/doc/vocab'
import { rules } from '@yaks/doc/rules'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab(docs)
equal(vocab.props(DOC), [TITLE, BODY])
equal(rules()[0], plugin())
```

## Views

`views` is a [registry](../render/README.md) containing a `Title` view for a
non-null title and a `Body` view for a non-null body. The body is parsed by
[@yaks/markdown](../markdown/README.md). A rendering backend supplies the
output: [@yaks/text](../text/README.md) produces Markdown or plain text, and
[@yaks/preact](../preact/README.md) produces browser nodes. A missing title
leaves selection to other registered views, such as a fallback title using the
eid. An empty string still selects the corresponding view and renders empty
text.

```ts
import { docDoc } from '@yaks/doc'
import { views } from '@yaks/doc/views'
import { resolve } from '@yaks/render'
import { equal } from '@yaks/testing'
import { render } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab([docDoc])
const bundle = {
  entity: { eid: 'meeting-1' },
  doc: { title: 'Meeting notes', body: 'Read **carefully**' },
}
equal(render(views, bundle, 'Title', vocab), 'Meeting notes')
equal(render(views, bundle, 'Body', vocab), 'Read **carefully**')
equal(
  render(
    views,
    { entity: { eid: 'empty' }, doc: { title: '' } },
    'Title',
    vocab,
  ),
  '',
)
equal(
  resolve(
    views,
    { entity: { eid: 'empty' }, doc: { body: 'No title' } },
    'Title',
    vocab,
  ),
  undefined,
)
```

## Optional body storage

The body declares `store: 'blob'`, a
[keyword](../vocab/README.md#extension-keywords) owned by
[@yaks/blob](../blob/README.md). Without `blobKeywords`, it remains an ordinary
text property. Registering the keyword makes the declaration available to the
blob plugin; it does not configure storage by itself.

```ts
import { blobKeywords } from '@yaks/blob'
import { docDoc } from '@yaks/doc'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const plain = loadVocab([docDoc])
const addressed = loadVocab([docDoc], [blobKeywords])
equal(plain.prop('doc', 'body')!.keywords.store, undefined)
equal(addressed.prop('doc', 'body')!.keywords.store, 'blob')
equal(addressed.prop('doc', 'body')!.scalar, 'text')
```

Compose the blob plugin and configure read resolution as shown in
[@yaks/blob's storage example](../blob/README.md#store-a-body) to keep callers
writing and reading text while storage holds content addresses. Both title and
body also declare `search: true`; composing [@yaks/fts](../fts/README.md)
provides search.

## Kind order

`doc` is a [kind](../vocab/README.md#vocabulary) and declares no `before`. Your
vocabulary can put a more specific kind before it for display:

```ts
import { docDoc } from '@yaks/doc'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab([docDoc, {
  $defs: {
    recipe: {
      type: 'object',
      component: true,
      kind: true,
      before: ['doc'],
      properties: {},
    },
  },
}])
equal(vocab.kindOf({ recipe: {}, doc: { title: 'Lemon cake' } }), 'recipe')
```

## Limits

This package provides no storage, search index, revisions, or access control.
[@yaks/blob](../blob/README.md) owns body storage, [@yaks/fts](../fts/README.md)
owns search, and [@yaks/member](../member/README.md) owns access control. A
slug, an excerpt, and timestamps belong in other components, rather than in
`doc`.

## License

Apache-2.0
