# @yaks/vocab

The vocabulary **meta-model**: a way to _describe_ a component vocabulary as
JSON Schema (2020-12) plus a small custom keyword vocabulary, and the runtime
that loads and **interrogates** any such description. It ships **zero**
components — the fleet's ~90 comps are an instance it loads, and a customer app
is a smaller instance in the same format. One format for both; an app just
composes fewer vocabularies.

## The format

A vocab is a JSON Schema document. Each component is an object schema in
`$defs`; each column is a property. Native JSON Schema carries `type`, `format`,
`enum`, `const`, `default`, `description`, `examples`; the yaks keyword
vocabulary (declared via JSON Schema's own `$vocabulary` mechanism,
`meta/core.vocab.json`) adds what a component table needs:

| keyword   | on     | says                                                              |
| --------- | ------ | ----------------------------------------------------------------- |
| `ref`     | column | the entity kind a string references (`"project"`, `"entity"`)     |
| `death`   | column | `cascade` \| `detach` \| `release` \| `keep` when the target dies |
| `persist` | column | `false` = computed, never stored (a query-only rank)              |
| `stamped` | column | `true` = server-owned: readable, never wire-writable              |
| `store`   | column | `"blob"` = a content-addressed markdown body                      |
| `aliases` | column | input spellings that resolve to an enum member                    |
| `bare`    | both   | `false` = never claims its bare filter spelling; qualified only   |
| `kind`    | comp   | this component names a display kind                               |
| `before`  | comp   | kinds this kind sorts before (feeds the derived kindOrder)        |
| `wire`    | comp   | `false` = readable-not-writable component (the spine)             |

A **fleet layer** (`meta/fleet.vocab.json`) declares `prefix` and `by_name` —
carried and interrogable, their behavior (id-minting, name resolution) deferred
to a later package. There is no `well` keyword: a text field's completions draw
from native `examples` ∪ the column's own live distinct values. There is no rank
of any kind: component and stamped order are alphabetical, and kindOrder is
alphabetical refined topologically by `before` (a cycle refuses).

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
v.aim('comment.target.doc.title') // [{comment,target}, {doc,title}]  path → hops
v.kindOf({ task: 1, doc: 1 }) // 'task' — most specific kind wins
v.deaths('cascade') // the reaper's worklist: [comp, col] pairs
v.check('task', { priority: 1 }) // [] — instance well-formedness
```

`validate.ts` holds the document checks: the **storable profile** (an object of
scalar/ref/enum columns — no nesting, arrays, or recursive `$ref` a table can't
lower), **reserved** names a base vocabulary already owns, and **grow** — the
additive-forever rule: a column never drops or retypes, because its rows were
written under the old word.

`fleet/slice.schema.json` (not published) is a hand-authored slice of the
fleet's vocabulary in this format; the parity test converts the full fleet
manifests and holds the runtime's answers equal to the fleet's generated
`types.ts`.
