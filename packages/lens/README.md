# @yaks/lens

Pure, compiled changes between JSON document versions. `document(ops)` gives
`put` (old to current) and `get` (current to old). Bundles add patch and
read-view semantics through `compile(rows, speaks)`, plus `ask` for old query
ASTs and `find` for stored rows still carrying old properties. This package owns
the private `_lens{package, step, ops}` declarations and the graph plugin.

| Export    | What it offers                                                                     |
| --------- | ---------------------------------------------------------------------------------- |
| `.`       | `document`, `compile`, `lensesIn`, `described`, `versions`, `packageEid`, `lenses` |
| `./vocab` | Private `_lens{package, step, ops}` declarations                                   |
| `./rules` | The graph's write normalization and read translations                              |

JSON paths use dots, or arrays of keys for names containing dots and array
indexes. A compiled operation list snapshots its declarations and copies only
changed document ancestors; inputs and defaults are never mutated. A missing
path stays missing, and JSON null stays data.

| Operation                            | Forward                                                                            | Inverse                   |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------- |
| `rename: {from, to}`                 | Move a value                                                                       | Move it back              |
| `hoist: {from, to}`                  | Move to a shallower path                                                           | Plunge                    |
| `plunge: {from, to}`                 | Move to a deeper path                                                              | Hoist                     |
| `add: {path, default}`               | Fill a missing value                                                               | Remove that default       |
| `remove: {path, default}`            | Remove that default                                                                | Fill it back              |
| `concat: {from, to, separator?}`     | Join string paths and `{value}` literals                                           | Split                     |
| `scatter: {from, to, keyword, key?}` | Spread a map into each destination entry's keyword                                 | Gather                    |
| `in: {path, ops}`                    | Apply operations within existing children, with `*` matching keys or array indexes | Reverse within each child |

```ts
import { document } from '@yaks/lens'
import { equal } from '@yaks/testing'

let lens = document([
  { rename: { from: 'options.positional', to: 'positional' } },
  {
    scatter: {
      from: 'options.short',
      to: 'input',
      keyword: 'short',
      key: 'value',
    },
  },
  {
    concat: {
      from: ['options.rest', { value: '...' }],
      to: 'positional',
      append: true,
    },
  },
  { remove: { path: 'options', default: {} } },
])
let old = {
  options: { positional: ['app'], rest: 'files', short: { n: 'limit' } },
  input: { limit: { type: 'number' } },
}
let current = lens.put(old)
equal(current, {
  positional: ['app', 'files...'],
  input: { limit: { type: 'number', short: 'n' } },
})
equal(lens.get(current), old)
```

`tools.fixture.json` contains declarations copied from `@yaks/graph`,
`@yaks/builders` and `@yaks/spawn`: ordinary positional arguments, rest alone,
and positional/rest/short together. The test applies this change within a whole
declaration document's `$defs` map and runs it both ways. The declaration format
change can therefore be expressed by lenses; no platform reader needs that
change yet.

Inverse domains are explicit. Add/remove cannot reconstruct arbitrary removed
data: removing a value different from its declared default refuses. Concat
requires strings and a separator between multiple variable parts, and refuses
values containing that separator; literals allow reversible prefixes/suffixes.
`append: true` consumes the last matching array entry on inverse, so an ordinary
positional without a rest suffix remains unchanged. Scatter requires existing
destination objects and unique gathered keys; `key: 'value'` turns
`{n: 'limit'}` into `input.limit.short: 'n'`. Conflicting destinations refuse.
Empty containers survive moves. Inverses canonicalize omitted defaults and empty
maps/lists rather than inventing metadata to distinguish equivalent empty
declarations. Hoist/plunge destinations must be strictly shallower/deeper; paths
cannot contain their own source. Array index moves address the resulting array
after source consumption; `in` is useful for transforming array entries.

For file formats, version steps are ordinary lists. Compile the suffix once for
the version a caller holds; the inverse runs that suffix in reverse.

```ts
import { document, type Op } from '@yaks/lens'
import { equal } from '@yaks/testing'

let steps: Op[][] = [
  [{ rename: { from: 'title', to: 'name' } }],
  [{ rename: { from: 'name', to: 'heading' } }],
]
let callerVersion = 1
let lens = document(steps.slice(callerVersion).flat())
equal(lens.put({ name: 'Cake' }), { heading: 'Cake' })
equal(lens.get({ heading: 'Cake' }), { name: 'Cake' })
```

The pilot stores graph steps as `_lens` rows and authors them with `lensesIn`.
That registration currently accepts graph renames only. Declaration documents
use the programmatic JSON operation lists above and require no graph rows. This
split is a pilot format choice: document translation and its step-count versions
work independently of a store, while query rewriting beyond graph renames
remains future work.

The graph pilot uses comp.prop renames. A declaring vocabulary carries its
package name and an ordinary `$defs` entry:

```ts
import { compile, lensesIn, versions } from '@yaks/lens'

let docs = [{
  package: 'kitchen',
  $defs: {
    title: {
      lens: true,
      step: 0,
      ops: [
        { rename: { from: 'recipe.title', to: 'doc.title' } },
      ],
    },
  },
}]
let lens = compile(lensesIn(docs))
lens.put({ entity: { eid: 'cake' }, recipe: { title: 'Cake' } })
// { entity: { eid: 'cake' }, recipe: {}, doc: { title: 'Cake' } }
Object.values(versions(docs)) // [1]
```

`lensesIn` reads entries ignored by `loadVocab`, derives the ordinary package
and step identities, and validates each package's contiguous steps. `described`
produces missing rows. Steps are append-only: changing operations at an existing
step refuses instead of reinterpreting an old caller. `compile(rows, speaks)`
composes the remaining steps and caches against their content and the package
version map. Without `speaks` it starts at zero, for the mover. With current
versions it returns identity functions.

The plugin declares `$speaks`, a package-eid to step-count map on writes. Reads
carry the same map in `ReadOpts.speaks`. No map means current: normalization
returns the exact inputs, reads no rows, and asks parse nothing. A door can omit
a current map to take that path.

The graph adapter supports rename in this pilot. Omission is preserved, null
clears a property, and moving a property retains `recipe{}`. Removing the source
aspect clears its moved property without deleting the target's unrelated
properties. Conflicting writes to both names refuse before storing anything;
`$was` preconditions translate by the same mapping. Old reads copy `doc.title`
back only onto entities carrying `recipe{}`; `doc.title` remains readable
because it existed in the old vocabulary too. Raw subscription patches carry
`ReadOpts.patch`: the adapter reads stored source membership, without copying
other stored properties, and translates target removals into alias clears. A
within-component rename removes its replacement from the old view. For a
subscription patch, `get(patch, held)` uses the held row only to learn whether
an omitted source component exists; it never copies held properties. Explicit
source component removal stays a removal, and destination component removal
clears the old aliased property.

The mover uses `find` and `put`, explicitly clearing the old stored property
through its expanded vocabulary. A patch translation alone cannot clear a column
the new vocabulary no longer admits. The pilot retains translated columns even
after migration completes so kept code can roll back; automatic contraction is
not built. This package owns neither storage movement nor kept app versions,
reload policy, rollback decisions, envelopes or tool arguments.

An op list expresses direction and patch consumption. Declared graph rules can
copy a value after admission, but do not clear or consume it, and do not invert.
Relations could give both directions one definition; they would still need
omission/null semantics, a compiled mode for speed, and query rewriting. The
pilot ships no dependency on `@yaks/logic`. Grammar routing such as bare `.eid=`
stays at its door. Query rewriting for the document operations beyond rename is
outside this pilot: their inverses transform documents, while the graph adapter
explicitly accepts only comp.prop renames.
