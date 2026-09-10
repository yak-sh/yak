# @yaks/vocab

Describe component vocabularies with JSON Schema 2020-12 and yaks extension
keywords. `loadVocab()` loads these documents into a runtime model used for
validation, query resolution, and storage schema generation. This package
defines the vocabulary format, not application components.

## The format

A vocab is a JSON Schema document. Each component is an object schema in
`$defs`; each column is a property. Native JSON Schema carries `type`, `format`,
`enum`, `const`, `default`, `description`, `examples`; the yaks keyword
vocabulary (declared via JSON Schema's own `$vocabulary` mechanism,
`meta/core.vocab.json`) adds what a component table needs:

| keyword    | on     | says                                                              |
| ---------- | ------ | ----------------------------------------------------------------- |
| `ref`      | column | the entity kind a string references (`"project"`, `"entity"`)     |
| `death`    | column | `cascade` \| `detach` \| `release` \| `keep` when the target dies |
| `persist`  | column | `false` = computed, never stored (a query-only rank)              |
| `stamped`  | column | `true` = server-owned: readable, never wire-writable              |
| `store`    | column | `"blob"` = a content-addressed markdown body                      |
| `aliases`  | column | input spellings that resolve to an enum member                    |
| `bare`     | both   | `false` = never claims its bare filter spelling; qualified only   |
| `unique`   | both   | column: no two rows share it. comp: `[["space","slug"]]`          |
| `index`    | both   | the same two spellings, without the uniqueness                    |
| `identity` | both   | the entity's id is DERIVED from this. comp: `["space","slug"]`    |
| `kind`     | comp   | this component names a display kind                               |
| `before`   | comp   | kinds this kind sorts before (feeds the derived kindOrder)        |
| `wire`     | comp   | `false` = readable-not-writable component (the spine)             |

Every stored `ref` column is indexed automatically, including stamped refs and
refs with `death: "keep"`. No `index: true` is needed, and `index: false` does
not opt out. A reference that already leads a declared index (including a
composite unique or identity index) needs no additional single-column index.

**`identity` is the one that names the entity.** A component whose column says
`"identity": true` has its entities' ids DERIVED from that value — the same
derivation an edge and a key already use — so a file, a row or a seed written
twice is one entity and there is no eid for anybody to have kept:

```json
{
  "guide": {
    "type": "object",
    "properties": {
      "slug": { "type": "string", "identity": true },
      "brief": { "type": "string" }
    }
  }
}
```

`{guide: {slug: 'store', brief: '…'}}` applied a second time patches the first
entity. This package DECLARES it and answers `identity(comp)`;
[@yaks/graph](https://jsr.io/@yaks/graph) is what derives the id and refuses a
bundle whose eid disagrees with it.

A text field's completions draw from native `examples` ∪ the column's own live
distinct values. Ordering is derived, never hand-ranked: component and stamped
order are alphabetical, and kindOrder is alphabetical refined topologically by
`before` (a cycle refuses).

**Reverse associations are derived too.** Every reference column is also a name
on the far side: `review.book` makes `.reviews` the reviews pointing at a book,
and a component with several references disambiguates with the column
(`loan.book` → `.loans_book`). A forward spelling always wins its name, so an
association never shadows a real column or component.

```json
{
  "$vocabulary": { "https://yaks.sh/vocab/core": true },
  "$defs": {
    "task": {
      "type": "object",
      "kind": true,
      "before": ["doc"],
      "properties": {
        "priority": { "type": "number", "format": "priority" },
        "project": { "type": "string", "ref": "project", "death": "detach" }
      }
    }
  }
}
```

`meta/vocab.schema.json` is the meta-schema a vocab file validates against.

A JSON column uses `{ "type": "string", "format": "json" }`. The runtime reports
scalar `json` with text affinity and accepts a string containing any valid JSON
value. Objects and arrays are encoded in that string; a column never holds a
nested object or array directly. A null clears the column, while the string
`"null"` stores the JSON null value.

## Extension keywords

The core keywords describe what a component _table_ needs. Anything past that —
an id prefix, a name column, a unit of measure — belongs to whoever cares about
it, and arrives through JSON Schema's own extension mechanism: a **keyword
vocabulary**, declared by its URI.

```ts
import { extendMeta, loadVocab } from '@yaks/vocab'

let shelf = {
  uri: 'https://example.com/vocab/shelf',
  comp: ['shelf'], // keywords this vocabulary adds to a component
  column: ['unit'], // …and to a column
  doc: { $defs: { shelf: { type: 'string' }, unit: { type: 'string' } } },
}

let v = loadVocab([catalog], [shelf])
v.comp('book').keywords.shelf // 'fiction'
v.column('book', 'weight').keywords.unit // 'gram'
extendMeta([shelf]) // the meta-schema, now admitting those keywords
```

The loader **carries** a registered keyword and never interprets one — what it
_means_ belongs to the package that declared it.
[@yaks/id](https://jsr.io/@yaks/id) owns `prefix` this way, and
[@yaks/names](https://jsr.io/@yaks/names) owns `by_name`. A keyword nobody
registered is invisible.

## The runtime

```ts
import { loadVocab } from '@yaks/vocab'

let v = loadVocab([kernel, work]) // one or many docs, merged; a name has one home

v.comps // wire-writable component names, alphabetical
v.kinds // kindOrder: alphabetical + topological over `before`
v.column('task', 'project')
// { category: 'ref', ref: 'project', death: 'detach',
//   affinity: 'integer', fk: true, stamped: false, persist: true, … }
v.route('title') // { comp: 'doc', prop: 'title' }   bare prop → its home
v.route('eid') // { comp: 'entity', prop: 'eid' }  the spine's own identity
v.aim('comment.target.doc.title') // [{comment,target}, {doc,title}]  path → hops
v.aim('project', true) // [{project,''}]  the bare-bang form: `.project!` is the
// component's facet even where task.project claims the bare spelling

v.assoc('reviews') // { comp: 'review', prop: 'book' }  a plural → its reverse
v.kindOf({ task: 1, doc: 1 }) // 'task' — most specific kind wins
v.deaths('cascade') // the reaper's worklist: [comp, col] pairs
v.check('task', { priority: 1 }) // [] — instance well-formedness
```

`validate.ts` holds the document checks: the **storable profile** (an object of
scalar/ref/enum columns — no nesting, arrays, or recursive `$ref` a table can't
lower), **reserved** names a base vocabulary already owns, and **grow** — the
additive-forever rule: a column never drops or retypes, because its rows were
written under the old word.

See `vocab_test.ts` and `validate_test.ts` for vocabulary loading and validation
examples.

## Compatibility

Pure TypeScript with no runtime dependency — a vocabulary is plain JSON Schema.
Runs on **Deno** and **Node** (via JSR / npm).
