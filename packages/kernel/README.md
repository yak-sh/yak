# @yaks/kernel

Shared identity, marks and relationship components for graphs of work, with
vocabulary documents, a completion plugin, citation helpers and a comment tool.

The graph fills in a [mark](../vocab/README.md#vocabulary)'s stamped properties.
Callers supply the mark, not `at`, `by` or `via`.

This package uses
[entities, components, bundles, patches, actors and
plugins](../graph/README.md#data-model),
[vocabulary](../vocab/README.md#vocabulary) and [links](../edge/README.md).

## Marks

For marks with `at`, `by` and `via`, the graph stamps when the write happened,
who wrote it and the instrument it came through. The calling application
supplies the actor. In the CLI composition,
[@yaks/process](../process/README.md) supplies the process entity for writes
that did not arrive through an authenticated HTTP or MCP request.

| Mark              | Meaning                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **`created`**     | Who made the entity, when and through what.                                                                                               |
| **`updated`**     | Who last changed the entity, when and through what.                                                                                       |
| **`opened`**      | Somebody looked at the entity.                                                                                                            |
| **`archived`**    | Hidden from ordinary listings, without deleting history or stopping execution.                                                            |
| **`completed`**   | The work was finished; removing the mark reopens it.                                                                                      |
| **`failed`**      | The work was tried and given up on; `reason` records why. Removing it permits another attempt.                                            |
| **`broken`**      | Something outside the graph stopped honoring the entity; `code` records the other side's answer. Removing it says the entity holds again. |
| **`interrupted`** | A request or call was cut off before finishing; `code` records why. Removing it allows a deliberate retry.                                |
| **`resolved`**    | The problem stopped happening; removing it says the problem is back. A problem can stop without work being completed.                     |
| **`verified`**    | Somebody checked the entity against its claims and found they hold. Only checking writes this mark.                                       |
| **`proposed`**    | Put forward for a decision.                                                                                                               |
| **`decided`**     | A verdict or chosen answer; `verdict` is `approved` or `declined`, and `choice` is a chosen label or custom answer.                       |
| **`quarantined`** | Readable but set aside as harmful to act on; applications exclude it from guidance.                                                       |
| **`pending`**     | Awaiting the first successful answer or confirmation.                                                                                     |
| **`admitted`**    | A child holds a place under a concurrency bound; removing it gives up the place.                                                          |
| **`waiting`**     | A child stepped aside while waiting for its own children; removing it queues the child again.                                             |

These declarations record marks; applications implement listing filters,
concurrency bounds and other behavior associated with them. A status can be
computed from marks: [@yaks/task](../task/README.md) reads `completed` as done.

A **`favorite`** records that somebody marked the entity as a favorite. It
declares stamped `at` but has no `by` or `via`, so the graph does not stamp it
as a mark.

## Use

```ts
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab([kernelDoc], [kernelKeywords])
let g = graph({ vocab, storage: ram(vocab), plugins: [kernel()] })
await g.apply([{ entity: { eid: 'work' }, completed: {}, favorite: {} }])
let [work] = await g.read('.completed&*')
equal(work.entity.eid, 'work')
equal(typeof work.completed?.at, 'string')
equal(work.favorite, {})
```

## Exports

| Import               | Exports                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/kernel`       | `kernelDoc`, `spineDoc`, `marksDoc`, `kernelKeywords`, `KERNEL_URI`, `kernel()`, `CITES`, `content()`, `status()`, `verify()`, `Status` |
| `@yaks/kernel/vocab` | The vocabulary documents, `kernelKeywords`, `docs`, `keywords`, `description`                                                           |
| `@yaks/kernel/graph` | `plugins()`, returning `[kernel()]`                                                                                                     |
| `@yaks/kernel/tools` | `runs()`, returning the `comment_new` implementation                                                                                    |

## Vocabulary documents

`kernelDoc` declares all this package's components and its comment tool.
`spineDoc` selects `entity`, `created` and `updated`; `marksDoc` selects
`opened` and `archived`. Load the subsets when the other declarations are
unnecessary. `docs` contains `kernelDoc`, `keywords` contains `kernelKeywords`,
and `description` is the manifest's summary. The `./vocab` entry point imports
no storage or runtime API.

```ts
import { marksDoc, spineDoc } from '@yaks/kernel/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab([spineDoc, marksDoc])
let g = graph({ vocab, storage: ram(vocab) })
await g.apply([{ entity: { eid: 'note' }, opened: {}, archived: {} }])
let [note] = await g.read('.archived&*')
equal(note.entity.eid, 'note')
equal(typeof note.opened?.at, 'string')
equal(typeof note.created?.at, 'string')
```

The `entity` declaration adds `archetype` to the identity component.
[@yaks/archetype](../archetype/README.md) maintains it; callers do not write it.
The component has `wire: false`, excluding it from ordinary component input.
[@yaks/id](../id/README.md) adds `num`, allocates numbers, formats human ids and
resolves them.

### Completion

`kernel()` preserves `completed.by` across later writes of `completed`. Its
precondition hook runs before stamping. On the first completion it uses the
incoming `by`, if supplied by trusted server code, or the batch's actor; on
later writes it keeps the stored `by`. Removing `completed` permits a subsequent
completion to name another writer. `plugins()` installs the same plugin.

```ts
import { kernelDoc } from '@yaks/kernel'
import { plugins } from '@yaks/kernel/graph'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab([kernelDoc])
let g = graph({ vocab, storage: ram(vocab), plugins: plugins() })
await g.apply([
  { entity: { eid: 'alice' }, favorite: {} },
  { entity: { eid: 'bob' }, favorite: {} },
  { entity: { eid: 'work' }, completed: {}, $actor: { by: 'alice' } },
])
await g.apply([
  { entity: { eid: 'work' }, completed: {}, $actor: { by: 'bob' } },
])
let [work] = await g.read('.completed&*')
equal(work.completed?.by, 'alice')
```

### Other components and relations

A **`comment`** attaches text to an entity through `target`, with optional
`reply_to` naming the comment it answers. [@yaks/doc](../doc/README.md) owns the
`doc` component holding the text. A **`image`** records pixel dimensions as `w`
and `h`. A **`redaction`** records a replaced `title` or `body` property with
`target`, `prop` and a hash of the replaced content; its properties are stamped
and must be supplied by trusted server code.

The package declares [relations](../edge/README.md) with these component names:
**`about`** says the source is about the target; **`delegates`** says the source
handed work to the target; **`reads`** says the source reads the target;
**`references`** says the source refers to the target; **`supersedes`** says the
source replaces the target; **`supervises`** says the source oversees the
target; **`wants`** says the source wants the target; **`worked`** says the
source worked on the target. The query name is the component name except for
`references`, whose query name is `referenced`.

Add [@yaks/edge](../edge/README.md) for the `edge` component and link behavior.
Other packages own relations such as [@yaks/task](../task/README.md)'s
`contains` and `requires` and [@yaks/goal](../goal/README.md)'s `satisfies`.

```ts
import { kernelDoc } from '@yaks/kernel'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab([kernelDoc, edgeDoc], [edgeKeywords])
let g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: 'picture' }, image: { w: 640, h: 480 } },
  { entity: { eid: 'subject' }, favorite: {} },
  {
    entity: { eid: 'relation' },
    edge: { from: 'picture', to: 'subject' },
    about: {},
  },
])
let [relation] = await g.read('.about&*')
equal(relation.edge?.to, 'subject')
await g.apply([{
  entity: { eid: 'replacement' },
  redaction: {
    target: 'picture',
    prop: 'body',
    hash: 'digest-of-replaced-text',
  },
}], { trusted: true })
let [replacement] = await g.read('.redaction&*')
equal(replacement.redaction?.prop, 'body')
```

## Citations

A **citation** is a link carrying `cites`, whose `hash` records the cited
entity's content when verified. `CITES` is the component name, `'cites'`.
`content(vocab)` hashes client-written properties in a fixed order, excluding
server stamps. `verify(cite, target, vocab)` returns a patch containing the hash
and `verified` mark; it refuses a deleted target. Apply that patch to store it.

`status(cite, target, vocab)` returns `current` when the hash matches, `moved`
when the content changed or the target was deleted, `unverified` without a
`verified` mark, or `unknown` when a verified citation has no hash.

```ts
import { content, kernelDoc, status, verify } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab([kernelDoc, docDoc, edgeDoc], [edgeKeywords])
let target = { entity: { eid: 'note' }, doc: { body: 'oak' } }
let cite = {
  entity: { eid: 'citation' },
  edge: { from: 'claim', to: 'note' },
  cites: {},
}
equal(status(cite, target, vocab), { state: 'unverified' })
let checked = verify(cite, target, vocab)
equal(status(checked, target, vocab), { state: 'current' })
equal(
  content(vocab)({ ...target, updated: { at: '2026-01-01T00:00:00Z' } }),
  content(vocab)(target),
)
equal(status(checked, { ...target, doc: { body: 'ash' } }, vocab), {
  state: 'moved',
})
equal(status({ ...cite, verified: {} }, target, vocab).state, 'unknown')
```

[@yaks/git](../git/README.md) answers file and symbol citations from the commit
and place they name.

## Comment tool

`runs()` implements `comment_new`, returning a patch with `doc.body` and
`comment.target`, plus `comment.reply_to` when supplied. The tool runner applies
the patch as the caller; the implementation itself writes nothing. Load the
kernel and doc vocabulary documents before applying its result.

```ts
import { kernelDoc } from '@yaks/kernel'
import { runs } from '@yaks/kernel/tools'
import { docDoc } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab([kernelDoc, docDoc])
let g = graph({ vocab, storage: ram(vocab) })
await g.apply([{ entity: { eid: 'work' }, favorite: {} }])
let [tool] = loadTools(kernelDoc, runs())
let patches = await tool.run({
  entity: { eid: 'call' },
  call: { args: { target: 'work', body: 'Looks good.' } },
}, g)
await g.apply(patches)
let [comment] = await g.read('.comment&*')
equal(comment.comment?.target, 'work')
equal(comment.doc?.body, 'Looks good.')
```

## Kernel keywords

The package registers three custom
[JSON Schema keywords](../vocab/README.md#extension-keywords): **`governed`**
says a project answers for entities carrying the component; **`lazy`** excludes
a component from the client's startup snapshot, so readers request it by
partition; **`well`** names a list of suggested values for a property. This
package retains these declarations; consumers implement their behavior.

Register `kernelKeywords` when loading documents that use these keywords, and
use `KERNEL_URI` in their `$vocabulary` declaration.

```ts
import { KERNEL_URI, kernelKeywords } from '@yaks/kernel'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab([{
  $vocabulary: { 'https://yak.sh/vocab/core': true, [KERNEL_URI]: true },
  $defs: {
    note: {
      component: true,
      type: 'object',
      governed: true,
      lazy: true,
      properties: { state: { type: 'string', well: 'states' } },
    },
  },
}], [kernelKeywords])
equal(vocab.comp('note')?.keywords.governed, true)
equal(vocab.comp('note')?.keywords.lazy, true)
equal(vocab.prop('note', 'state')?.keywords.well, 'states')
```

## Limits

The declarations and pure helpers use no platform APIs and work in Deno, Node
and browsers. This package provides no persistence; choose a
[storage adapter](../graph/README.md#data-model), such as
[@yaks/ram](../ram/README.md) for memory. Human ids belong to @yaks/id,
archetype maintenance to @yaks/archetype, and text to @yaks/doc.

## Comment views

`./views` contributes `Thread.Note` renderers for comments and commits.
`./Comments` supplies `Comments`, `Branches`, `Composer` and `Reply`; every
branch asks the registry to draw its note. The composer uses the kit's `Say`,
`Field`, `Button` and `Choices`, and keeps words through
[drafts](../draft/README.md).

An interface binds `configureComments` from `./comment-host` before mounting
these components. Its **comment host** supplies subscriptions, the page graph,
registry rendering, navigation and markdown; the domain imports no application.

The thread grouping function works on bundles without a host:

```ts
import { branches } from '@yaks/kernel/comments'
import { equal } from '@yaks/testing'
let roots = branches([
  {
    entity: { eid: 'reply', num: 2 },
    comment: { target: 'task', reply_to: 'ask' },
  },
  { entity: { eid: 'ask', num: 1 }, comment: { target: 'task' } },
])
equal(roots[0].children[0].row.entity.eid, 'reply')
```
