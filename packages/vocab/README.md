# @yaks/vocab

Loads and checks component vocabularies expressed as JSON Schema, and reads
their property types, references, display ordering, tool declarations, rules and
effects. Use it to share declarations between a graph, its storage and its
consumers. It creates no tables and stores no entity data.

## Vocabulary

A **vocabulary document** is a JSON Schema 2020-12 document whose `$defs`
entries declare [components](../graph/README.md#data-model) (`component: true`),
[tools](../graph/README.md#tools) (`tool: true`),
[rules](../graph/README.md#rules) (`rule: true`) or
[effects](../effects/README.md) (`effect: true`).

A **vocabulary** is the in-memory `Vocab` loaded from one or more vocabulary
documents. It answers which components and
[properties](../graph/README.md#data-model) are declared, what their values can
hold, and how to resolve a [query](../query/README.md).

A **reference** is a string property that names an
[entity](../graph/README.md#data-model), declared with `ref` and `death`, such
as `{ type: 'string', ref: 'book', death: 'detach' }`. `ref: 'entity'` accepts
any entity; another component name requires that component on the target.

A **kind** is a component marked `kind: true` that names an entity for display.
A **mark** is a component with stamped `at` and at least one of stamped `by` or
`via`; it records what happened to an entity. The
[graph](../graph/README.md#stamps-and-actors) fills these properties.

## Use

```ts
import { loadVocab, storable } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const catalog = {
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string', search: true },
        price: { type: 'number' },
      },
    },
  },
}
equal(storable(catalog), [])
const vocab = loadVocab(catalog)
equal(vocab.aim('book.price'), [{ comp: 'book', prop: 'price' }])
equal(vocab.prop('book', 'price')?.scalar, 'number')
equal(vocab.check('book', { price: 12 }), [])
equal(vocab.check('book', { price: 'twelve' }).length, 1)
```

`loadVocab` accepts one vocabulary document or an array. It checks component
markers, duplicate names, property types, status and component search lists.
Call `storable` separately for the checks a storage adapter needs.

## Exports

| Export                    | Provides                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/vocab`             | `loadVocab`, `Vocab`, declaration and loaded metadata types; `storable`, `reserved`; routing errors and messages; `kindOrder`, `pick`, `cast`, `typesOf`, `jsonb`, `composite`; `syncOf`, `durableOf`, `paceOf`, `saveOf`, `expireOf`, `ms`, `lives`, `said`, `kept`, `paced`, `saved`, `SYNC`; `rulesIn`, `effectsIn`; `same`, `changed`; `CORE_URI`, `coreVocabulary`, `metaSchema`, `extendMeta`, `Keywords`, `JsonSchema`; `metaDoc`, `toBundles`, `fromBundles`, `Ids`, `Bundle` |
| `@yaks/vocab/vocab`       | `docs`, containing `metaDoc`, and the package `description`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@yaks/vocab/tools`       | `ToolDefinition`, `Role`, `toolDefinition`, `toolDefinitionSchema`, `toolsSaid`, `toolsIn`, `validateToolInput`, `validateToolOutput`, `toolCheck`, `Check`, `errorsText`, `publicToolSchema`, `legacyOptions`                                                                                                                                                                                                                                                            |
| `@yaks/vocab/constraints` | `Factor`, `Term`, `Score`, `NumericConstraint`, `numberOf`, `constraintErrors`                                                                                                                                                                                                                                                                                                                                                                                            |

## The format

Each `$defs` entry declares what it is. `component: true` marks an object schema
whose `properties` declare the component's properties. `loadVocab` skips tool,
rule and effect entries and unmarked scalar schemas. An unmarked entry with
`type: 'object'` or `properties` throws: it looks like a component whose marker
was omitted.

Every property declares `type`. A reference or enum declares `type: 'string'`.
An authored component name starts with a lowercase letter and contains letters,
digits or underscores, up to 40 characters. Property names follow the same rule
and cannot be `entity` or `eid`. CamelCase component names are accepted only
with `sync: 'none'`, for [@yaks/ux](../ux/README.md) state. Names starting with
`_` belong to the [meta vocabulary](#a-vocabulary-as-entities), and `storable`
refuses them in authored vocabulary documents.

The native JSON Schema keywords include `type`, `format`, `enum`, `const`,
`default`, `description` and `examples`. `coreVocabulary` declares the yaks
keywords under `CORE_URI`, `https://yak.sh/vocab/core`. A **meta-schema** is a
JSON Schema for vocabulary documents; `metaSchema` is the bundled meta-schema.
Use a JSON Schema validator with it for full document validation.

| Keyword                               | On                    | Meaning                                                                                                        |
| ------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `component`, `tool`, `rule`, `effect` | entry                 | The entry's declaration marker                                                                                 |
| `extends`                             | component             | Adds properties, required properties or status rungs to another document's component                           |
| `ref`, `death`                        | property              | Reference target and deletion behavior                                                                         |
| `computed`                            | component or property | Derived and never stored; a computed component uses another package's backing                                  |
| `reads`                               | computed property     | Components on other entities it reads; `[]` means its own entity; `comp.ref` identifies a reference back to it |
| `stamped`                             | property              | Server-owned: clients read it and cannot write it                                                              |
| `status`                              | component             | Ordered components and the statuses they give, with a default                                                  |
| `kind`, `before`                      | component             | Display kind and the kinds it sorts before                                                                     |
| `search`                              | property or component | Stored text to index, or another component's text property names                                               |
| `embed`                               | component             | `false` excludes entities carrying it from embedding                                                           |
| `aliases`                             | enum property         | Input forms mapped to enum members                                                                             |
| `unique`, `index`                     | property or component | An individual property flag or composite index declarations                                                    |
| `required`                            | component             | Properties every stored component must hold                                                                    |
| `default`                             | property              | A scalar fallback, or `{ now: true }` on a `date-time` property                                                |
| `identity`                            | property or component | Properties from which an eid is derived                                                                        |
| `wire`                                | component             | `false` allows clients to read but not write it                                                                |
| `sync`, `durable`, `pace`             | component             | Who receives writes, how long values live, how often a writer's values are taken                               |
| `expire`                              | component             | The query selecting rows of this component to remove in a generic daily sweep                                 |
| `save`                                | component             | The query allowing the server to store a permanent peer-relayed value                                          |
| `validate`, `tree`                    | property              | Full JSON Schema checking and flat-tree checking by a schema plugin                                            |
| `constraints`                         | component             | Numeric bounds over the complete component                                                                     |

The vocabulary reports declarations; the consuming packages implement storage,
search, embedding, synchronization and write behavior.

### Property types and checks

A **scalar** is a loaded property's type name reconstructed from `type` and
`format`: `text`, `number`, `priority`, `bool`, `query`, `time`, `url`, `json`
or `jsonb`. `Prop.category` distinguishes `scalar`, `enum` and `ref`.

`jsonb` holds a JSON value: an object, array or type union. `json` holds JSON
text in a string. A null clears a property; the string `'null'` is JSON text
holding JSON null. `check` checks declared properties and their types, not
nested structures, numeric bounds or required properties. `cast` converts
non-null values of string properties to text, including JSON text for objects
and arrays, and leaves references alone.

```ts
import { cast, loadVocab, reserved, storable } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const doc = {
  $defs: {
    note: {
      component: true,
      properties: {
        text: { type: 'string' },
        settings: { type: ['string', 'object'] },
        raw: { type: 'string', format: 'json' },
      },
    },
  },
}
const v = loadVocab(doc)
equal(storable(doc), [])
equal(v.prop('note', 'settings')?.scalar, 'jsonb')
equal(v.prop('note', 'settings')?.affinity, 'blob')
equal(v.check('note', { settings: { color: 'blue' }, raw: 'null' }), [])
equal(v.check('note', { settings: 5 }).length, 1)
equal(cast(v, 'note', { text: 12, raw: { ready: true } }), {
  text: '12',
  raw: '{"ready":true}',
})
equal(reserved(doc, ['note']).length, 1)
```

`storable` returns errors for missing types, property `$ref`, invalid indexes,
defaults, identities, search declarations, constraints and state lifetimes. It
also checks that a component carrying all of `at`, `by` and `via` stamps all
three. `reserved(doc, names)` reports `$defs` names the caller already owns.
Neither function writes storage or migrates data.

A property with `validate: true` asks a schema plugin to check its full JSON
Schema. An array may declare `tree: { key: 'name', parent: 'parent' }`: unique
string keys and parents appearing earlier in the array. `admitSchema` from
[@yaks/graph/schema](../graph/README.md#admission-and-schema-checks) implements
these checks. SQLite binary JSON storage and filtering limits belong to
[@yaks/sql](../sql/README.md).

```ts
import { graph } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, throws } from '@yaks/testing'

const v = loadVocab({
  $defs: {
    drawing: {
      component: true,
      properties: {
        nodes: {
          type: 'array',
          validate: true,
          tree: { key: 'name', parent: 'parent' },
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              parent: { type: 'string' },
            },
          },
        },
      },
    },
  },
})
const g = graph({ vocab: v, storage: ram(v) })
g.use(admitSchema(v))
await g.apply([{
  entity: { eid: 'd1' },
  drawing: {
    nodes: [{ name: 'root' }, { name: 'leaf', parent: 'root' }],
  },
}])
await throws(() =>
  g.apply([{
    entity: { eid: 'd1' },
    drawing: {
      nodes: [{ name: 'leaf', parent: 'missing' }],
    },
  }]), 'parents must precede')
equal((await g.get(['d1']))[0].drawing, {
  nodes: [{ name: 'root' }, { name: 'leaf', parent: 'root' }],
})
```

## Routing and references

A **hop** is a component/property pair returned by `aim`, such as
`{ comp: 'review', prop: 'book' }`. `aim` resolves a
[path](../query/README.md#query-model) into hops; a component at the end has an
empty property name. `entity.eid` is built in, even when no vocabulary document
declares `entity`.

A **reverse association** is a reference seen from its target, represented by
`Assoc` as `{ comp, prop }`. `review.book` gives the name `reviews`; multiple
references on one component use the property name, as in `loans_book`. Forward
component names win. Plurals are derived mechanically: `y` becomes `ies`, a
final `s` stays, and every other name gains `s`.

```ts
import { loadVocab, Unknown } from '@yaks/vocab'
import { equal, throws } from '@yaks/testing'

const v = loadVocab({
  $defs: {
    book: { component: true, properties: { title: { type: 'string' } } },
    review: {
      component: true,
      properties: { book: { type: 'string', ref: 'book', death: 'detach' } },
    },
  },
})
equal(v.aim('review.book.book.title'), [
  { comp: 'review', prop: 'book' },
  { comp: 'book', prop: 'title' },
])
equal(v.aim('book'), [{ comp: 'book', prop: '' }])
equal(v.aim('entity.eid'), [{ comp: 'entity', prop: 'eid' }])
equal(v.assoc('reviews'), { comp: 'review', prop: 'book' })
equal(v.refProps(), [['review', 'book']])
equal(v.deaths('detach'), [['review', 'book']])
equal((await throws(() => v.aim('title'))) instanceof Unknown, true)
```

A property must be named with its component. `Unknown` identifies a failed
lookup; `unqualified`, `unknownProps`, `unknownComps` and `shapeOf` provide the
messages shared by readers and writers.

`death` says what the graph does when a reference target is deleted: `cascade`
deletes the referencing entity, `detach` clears the property, `release` removes
the referencing component and `keep` retains the reference without a foreign-key
constraint. `deaths` includes only client-writable references. `refProps`
includes stamped references too, but excludes computed components, whose
references cannot be found by reading stored components.

## Kinds and status

`all` lists every loaded component alphabetically; `comps` excludes components
that are computed or `wire: false`. `props` follows property declaration order;
`comp` separates writable and stamped properties. `kinds` is alphabetical,
constrained by `before`. A cycle throws. A `before` naming an unloaded kind has
no effect. A mark follows every kind it does not sort before, so a marked
comment is still displayed as a comment. `kindOf` chooses the first kind
present, or `entity` when none is present.

```ts
import { kindOrder, loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const v = loadVocab({
  $defs: {
    doc: { component: true, kind: true },
    task: { component: true, kind: true, before: ['doc'] },
    completed: { component: true, wire: false },
  },
})
equal(v.all, ['completed', 'doc', 'task'])
equal(v.comps, ['doc', 'task'])
equal(v.kinds, ['task', 'doc'])
equal(v.kindOf({ task: 1, doc: 1 }), 'task')
equal(
  kindOrder(
    ['doc', 'memory', 'task'],
    (k) => k == 'memory' ? ['doc'] : [],
    (k) => k == 'memory',
  ),
  ['task', 'memory', 'doc'],
)
```

A **ladder** is a component's computed status declaration, returned as
`{ rungs, default }`. A **rung** is `{ comp, status }`: an entity carrying that
component reads as that status. The first matching rung wins; no matching rung
gives the default; an entity without the ladder's component has no status.

```ts
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const v = loadVocab({
  $defs: {
    task: {
      component: true,
      status: { cancelled: 'cancelled', completed: 'done', default: 'open' },
    },
    cancelled: { component: true },
    completed: { component: true },
  },
})
equal(v.comp('task')?.ladder, {
  rungs: [
    { comp: 'cancelled', status: 'cancelled' },
    { comp: 'completed', status: 'done' },
  ],
  default: 'open',
})
equal(v.prop('task', 'status')?.values, ['cancelled', 'done', 'open'])
equal(v.comp('task')?.writable, [])
```

The `status` keyword supplies a computed, read-only enum property. A rung whose
component is not loaded is omitted; a rung naming a computed component throws.
[@yaks/sql](../sql/README.md) and [@yaks/match](../match/README.md) evaluate the
same ladder.

## Composition

A component has one declaring vocabulary document. `pick(doc, names)` selects
its declarations without copying them into another package. Duplicate component
declarations throw.

An **extension** is a component entry marked `extends: true` that adds
properties, required properties or status rungs to another vocabulary document's
component. Existing properties and rungs cannot be overridden. Other metadata
belongs to the declaring vocabulary document. Property extensions are applied
after all declarations; status rungs append in load order and cannot change the
default. A status-only extension of an unloaded component is skipped; other
extensions of unloaded components throw.

```ts
import { loadVocab, pick } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const base = {
  $defs: {
    task: { component: true, status: { default: 'open' } },
    unused: { component: true },
  },
}
const more = {
  $defs: {
    task: {
      component: true,
      extends: true,
      properties: { priority: { type: 'number' } },
      required: ['priority'],
      status: { claimed: 'wip' },
    },
    claimed: { component: true },
  },
}
const v = loadVocab([more, pick(base, ['task'])])
equal(v.all, ['claimed', 'task'])
equal(v.prop('task', 'priority')?.required, true)
equal(v.comp('task')?.ladder, {
  rungs: [{ comp: 'claimed', status: 'wip' }],
  default: 'open',
})
```

## Identity and indexes

An **identity** is an ordered property list from which the graph derives an
entity's eid. Declare `identity: true` on a property or
`identity: ['space',
'slug']` on a component. Repeated values identify the same
entity. Use [@yaks/key](../key/README.md) when values find an entity whose eid
should stay independent of those values.

An **index** is `{ props, unique, present? }`, describing the ordered properties
of a component's storage index. A **composite** is its declaration form: a
property list or `{ props, present? }`. `present` makes an index partial, so
only components holding those properties participate.

```ts
import { composite, loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const v = loadVocab({
  $defs: {
    guide: {
      component: true,
      unique: [{ props: ['key'], present: ['key'] }],
      properties: {
        slug: { type: 'string', identity: true },
        key: { type: 'string' },
        owner: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
  },
})
equal(v.identity('guide'), ['slug'])
equal(v.indexes('guide'), [
  { props: ['key'], unique: true, present: ['key'] },
  { props: ['slug'], unique: true },
  { props: ['owner'], unique: false },
])
equal(composite(['slug']), { props: ['slug'] })
```

Stored references are indexed automatically, including stamped references and
`death: 'keep'`. `index: false` does not opt out. A reference already leading an
index needs no extra index. Computed properties have no storage index.
`required` and `default` are reported to storage adapters; `integer` uses
integer affinity, while `number` uses real affinity.

## Search declarations

`search: true` selects stored text properties for [@yaks/fts](../fts/README.md).
`storable` rejects it on numbers, references, enums, computed properties and
strings formatted as `date-time`, `uri`, `query` or `json`.
[@yaks/match](../match/README.md) searches text directly and does not consult
this declaration.

On a component, `search: ['content.body']` selects another component's text. All
names must belong to that one component and hold stored text. It cannot coexist
with searched properties of its own. Unloaded components in the list are
omitted.

```ts
import { loadVocab, storable } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const doc = {
  $defs: {
    content: {
      component: true,
      properties: { body: { type: 'string', search: true } },
    },
    entry: { component: true, search: ['content.body'] },
  },
}
equal(storable(doc), [])
const v = loadVocab(doc)
equal(v.prop('content', 'body')?.search, true)
equal(v.comp('entry')?.search, ['content.body'])
```

## State lifetimes

**sync** says who receives a write: `none`, `server` (default) or `peers`.
**durable** says how long a value lives: `forever` (default), `connection` or a
duration such as `5s`. **pace** says how often a writer's value is taken, as a
positive duration. **save** is the query a stored entity must match before the
server stores a permanent peer-relayed value, such as
`!position | .updated.at<="30s ago"`. It reads the stored entity before the
incoming write; the query can select the first value or a value old enough to
replace. See [Time literals](../query/README.md#time-literals) for relative
times.

```ts
import {
  durableOf,
  lives,
  loadVocab,
  ms,
  paceOf,
  saved,
  saveOf,
  storable,
  syncOf,
} from '@yaks/vocab'
import { equal } from '@yaks/testing'

const v = loadVocab({
  $defs: {
    cursor: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      pace: '100ms',
    },
    draft: { component: true, sync: 'none', durable: 'forever' },
    position: {
      component: true,
      sync: 'peers',
      durable: 'forever',
      pace: '100ms',
      save: '!position | .updated.at<="30s ago"',
    },
  },
})
equal(syncOf(v, 'cursor'), 'peers')
equal(durableOf(v, 'cursor'), 'connection')
equal(paceOf(v, 'cursor'), 100)
equal(syncOf(v, 'undeclared'), 'server')
equal(durableOf(v, 'undeclared'), 'forever')
equal(paceOf(v, 'draft'), null)
equal(saveOf(v, 'position'), '!position | .updated.at<="30s ago"')
equal(saveOf(v, 'undeclared'), null)
equal(saved('.position.x>5'), '.position.x>5')
equal(saved('30s'), null)
equal(storable(v.docs[0]), [])
equal(ms('5s'), 5000)
equal(ms('connection'), null)
equal(lives('2m'), true)
```

`said`, `kept`, `paced` and `saved` normalize the declarations. `ms` converts
`ms`, `s`, `m`, `h` and `d` durations; `forever` and `connection` return null.
An **event** is a component with `durable: '0s'`: rules and the applied bundles
see it, but it is not stored. A `sync: 'none'` component cannot declare pace,
and `sync: 'peers', durable: 'forever'` without `save` is refused by `storable`.
`save` is refused with any other sync or lifetime. `saved` refuses blank strings
and durations; the graph evaluating the query checks its grammar. `saveOf`
returns the query, or `null` when none is declared or the component is unknown.

[@yaks/sync](../sync/README.md) relays the latest value at most once per pace,
including the final value, and clears immediately. For stored components,
[@yaks/member](../member/README.md) refuses writes beyond the per-writer pace. A
component with `sync: 'peers'` and `durable: 'forever'` declares `save`, a
query. The peers still hear the latest value at its pace;
[@yaks/api](../api/README.md) stores a relayed value when its stored entity
matches that query. A pending last value remains eligible after the writer's
connection ends; disconnect never overrides the query. That stored write goes
through admission as the writer, with their `via`; the page sends nothing extra.
A relay without `save` only hands values on.

### Expiration

**expire** is a component's query selecting its rows to remove. A component
that declares none expires nothing. The [effects worker](../effects/README.md)
sweeps every declaration in the composed vocabulary on startup and daily,
removing matching components in batches through `apply()`. Other components on
the entity remain; the graph deletes an entity left with only `created` and
`updated` provenance stamps.

```ts
import { expireOf, loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let v = loadVocab({ $defs: {
  cache: {
    component: true,
    expire: '.cache.at<="7d ago"',
    properties: { at: { type: 'string', format: 'date-time' } },
  },
} })
equal(expireOf(v, 'cache'), '.cache.at<="7d ago"')
equal(expireOf(v, 'undeclared'), null)
```

`expire` is a nonempty filter query, not a duration or an aggregate. The sweep
checks its grammar and restricts matches to entities carrying the declaring
component, including when the query has alternatives. Computed components have
no rows to expire.

This package does not store, expire, relay, pace or save values.

## Extension keywords

A **keyword vocabulary** is a `Keywords` registration: a URI, component and
property keyword names, and optional schemas describing those keywords.
`loadVocab(docs, keywords)` copies registered keywords into loaded metadata;
unregistered extension keywords are dropped. `extendMeta` adds them to the
meta-schema. Their owning packages implement their behavior.

```ts
import { extendMeta, loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const shelf = {
  uri: 'https://example.com/vocab/shelf',
  comp: ['shelf'],
  prop: ['unit'],
  doc: { $defs: { shelf: { type: 'string' }, unit: { type: 'string' } } },
}
const v = loadVocab({
  $defs: {
    book: {
      component: true,
      shelf: 'fiction',
      properties: { weight: { type: 'number', unit: 'gram' } },
    },
  },
}, [shelf])
equal(v.comp('book')?.keywords.shelf, 'fiction')
equal(v.prop('book', 'weight')?.keywords.unit, 'gram')
equal(
  (extendMeta([shelf]).$vocabulary as Record<string, boolean>)[shelf.uri],
  true,
)
```

Examples include [@yaks/id](../id/README.md)'s `prefix`,
[@yaks/names](../names/README.md)'s `by_name`, [@yaks/blob](../blob/README.md)'s
`store`, [@yaks/edge](../edge/README.md)'s `edge` and
[@yaks/key](../key/README.md)'s `key`.

## Tools

Import tool helpers from `@yaks/vocab/tools`. `toolsIn` reads `$defs` entries
marked `tool: true`, converts their `input` maps to object schemas, and checks
metadata, schemas, positional arguments and short flags. `toolsSaid` performs
the same read without those checks; both refuse duplicate tool names. The entry
name identifies its implementation, joined by
[@yaks/graph/tools](../graph/README.md#tools).

```ts
import {
  toolsIn,
  validateToolInput,
  validateToolOutput,
} from '@yaks/vocab/tools'
import { equal, throws } from '@yaks/testing'

const [tool] = toolsIn({
  $defs: {
    book_list: {
      tool: true,
      noun: 'book',
      verb: 'list',
      description: 'List books',
      input: {
        limit: { type: 'integer', minimum: 1, default: 20, short: 'n' },
      },
      outputSchema: { type: 'array', items: { type: 'string' } },
      readOnly: true,
      surfaces: ['cli', 'mcp'],
    },
  },
})
const args = {}
equal(tool.name, 'book_list')
equal(validateToolInput(tool, args), { limit: 20 })
equal(args, {})
validateToolOutput(tool, ['Dune'])
await throws(() => validateToolInput(tool, { limit: 0 }))
await throws(() => validateToolOutput(tool, [12]))
```

`surfaces` selects `cli`, `mcp`, both when omitted, or neither with `[]`.
`roles` declares process roles: `graph`, `web` or `effects`. These are metadata
for consumers; this package does not run tools or expose a command line.

`noun` and `verb` are lowercase words with digits and hyphens allowed. Either
may stand alone or both may be supplied. `positional` orders input property
names; only its last entry may end in `...` for remaining words. `short` is one
letter on an input property. `forward` names an array-of-strings input for
unmatched words. `toolDefinition` validates the same metadata authored in code.

```ts
import {
  legacyOptions,
  publicToolSchema,
  toolDefinition,
} from '@yaks/vocab/tools'
import { equal } from '@yaks/testing'

const tool = toolDefinition({
  noun: 'find',
  description: 'Find named books',
  positional: ['names...'],
  inputSchema: {
    type: 'object',
    properties: {
      names: { type: 'array', items: { type: 'string' } },
      limit: { type: 'integer', short: 'n' },
    },
  },
})
equal(legacyOptions(tool), {
  positional: [],
  rest: 'names',
  short: { n: 'limit' },
})
equal(
  (publicToolSchema(tool.inputSchema!).properties as Record<string, unknown>)
    .limit,
  { type: 'integer' },
)
```

`toolDefinitionSchema` describes the metadata. `validateToolInput` clones
arguments and supplies defaults before checking them. `validateToolOutput`
checks without applying defaults. `toolCheck(schema)` returns a reusable check
whose empty error list means valid; `errorsText` formats its errors. Validators
are cached by schema object, so registered schemas must remain immutable.

Schemas use 2020-12 by default; `$schema` can select draft-07, 2019-09 or
2020-12. Other dialects are refused. Local references work; remote references
are not fetched. A code declaration's `inputSchema` cannot be combined with
`input`. Vocabulary documents declare argument schemas through `input`.

## Rules and effects

`rulesIn` and `effectsIn` read declarations separately from `loadVocab` and
refuse duplicate names. Rules require a nonempty `match` in the
[query grammar](../query/README.md). `before` orders rules; `optimistic: true`
asks [@yaks/client](../client/README.md#rules) to run one before its server
answers.

```ts
import { effectsIn, loadVocab, rulesIn } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const doc = {
  $defs: {
    mail: { component: true },
    settle: {
      rule: true,
      match: '.mail, +!queued',
      before: ['sweep'],
      optimistic: true,
    },
    send_mail: {
      effect: true,
      created: ['mail'],
      sweep: '.mail !sent',
      tries: 3,
    },
  },
}
equal(loadVocab(doc).all, ['mail'])
equal(rulesIn(doc), [{
  name: 'settle',
  match: '.mail, +!queued',
  before: ['sweep'],
  optimistic: true,
}])
equal(effectsIn(doc), [{
  name: 'send_mail',
  created: ['mail'],
  sweep: '.mail !sent',
  tries: 3,
}])
```

Effect declarations carry `created` and `removed` component lists, `changed`
component or property lists, `match`, `start`, `active`, `sweep`, `tries` and
`idempotent`. At least one of `created`, `changed`, `removed`, `match` or
`start` must owe work. [@yaks/effects](../effects/README.md) defines their
execution; [@yaks/graph](../graph/README.md#rules) executes rules. These loaders
read declarations without parsing queries or running either kind of work.

## A vocabulary as entities

The **meta vocabulary** is `metaDoc`, the components that describe a vocabulary
as [bundles](../graph/README.md#data-model) in a graph. Its `./vocab` export
lets a host compose it alongside [@yaks/doc](../doc/README.md) and
[@yaks/edge](../edge/README.md).

| Component  | Describes                                                     |
| ---------- | ------------------------------------------------------------- |
| `_package` | A vocabulary document's package                               |
| `_comp`    | A declared component and its package                          |
| `_extends` | A component extension, its package and its added status rungs |
| `_prop`    | A property, its component, declaration order and package      |
| `_before`  | An edge from a kind to a kind it sorts before                 |
| `_vocab`   | A graph's vocabulary hash                                     |

These components are `wire: false`. `_package`, `_comp`, `_extends` and `_prop`
carry `doc` for their name and description. Keywords without their own meta
vocabulary property are retained verbatim in `keywords`, including extension
keywords and native JSON Schema keywords. Type unions remain lists.

`toBundles(doc, id)` projects component declarations; tools, rules and effects
are omitted. Its `id` callback derives the declared identities using the graph's
`identities`. `fromBundles` reconstructs one vocabulary document per package,
including extensions. A `_before` edge naming an absent component is omitted.
`_vocab` is not produced by `toBundles`.

```ts
import { identities } from '@yaks/graph'
import { docs } from '@yaks/vocab/vocab'
import { fromBundles, loadVocab, metaDoc, toBundles } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const derive = identities(loadVocab(metaDoc))
const id = (
  comp: '_package' | '_comp' | '_extends' | '_prop',
  values: Record<string, unknown>,
) => derive[comp](values, { entity: { eid: '' } })
const doc = {
  package: '@example/catalog',
  $defs: {
    book: {
      component: true,
      kind: true,
      properties: { title: { type: 'string', minLength: 1 } },
    },
  },
}
const rows = toBundles(doc, id)
const [restored] = fromBundles(rows)
equal(docs, [metaDoc])
equal(restored.package, '@example/catalog')
equal(restored.$defs?.book.properties?.title.minLength, 1)
equal(loadVocab(restored).all, ['book'])
```

## Comparing declarations

`same` compares type unions as sets and compares formats, ignoring description
and other keywords. `changed` compares `$defs`, including tool entries, and
reports `dropped`, `added` and `retyped` names. A property is named
`definition.property`; a retyped name is also added.

```ts
import { changed, same } from '@yaks/vocab'
import { equal } from '@yaks/testing'

equal(same({ type: ['string', 'array'] }, { type: ['array', 'string'] }), true)
const was = {
  $defs: {
    book: {
      component: true,
      properties: {
        price: { type: 'number' },
        title: { type: 'string' },
      },
    },
  },
}
const next = {
  $defs: {
    book: {
      component: true,
      properties: {
        price: { type: 'string' },
        pages: { type: 'integer' },
      },
    },
  },
}
equal(changed(was, next), {
  dropped: ['book.title'],
  added: ['book.price', 'book.pages'],
  retyped: ['book.price'],
})
```

These helpers read no stored data. The store decides which populated
declarations can change and how to migrate them.

## Numeric constraints

A **score** is a finite weighted sum declared as `{ sum: [...] }`. Each **term**
selects the complete component or bounded array members with `each`, filters
exact fields with `where`, and multiplies its `product` of **factors**. A factor
is a number or `{ field, default?, inverse? }`; an inverse divides by a positive
field value. A **numeric constraint** declares
`{ name, value, maximum, message }`, with a score as `value`.

```ts
import { constraintErrors, numberOf } from '@yaks/vocab/constraints'
import { equal } from '@yaks/testing'

const value = {
  sum: [{
    each: 'effects',
    where: { kind: 'damage' },
    product: [{ field: 'scale' }, { field: 'hits', default: 1 }],
  }],
}
equal(
  numberOf(value, {
    effects: [
      { kind: 'damage', scale: 2, hits: 3 },
      { kind: 'damage', scale: 4 },
      { kind: 'healing', scale: 20 },
    ],
  }),
  10,
)
equal(
  constraintErrors([
    { name: 'damage', value, maximum: 12, message: 'Damage exceeds 12' },
  ]),
  [],
)
```

`numberOf` bounds scores to 100 terms, products to 16 factors and selected
arrays to 100 objects. It refuses non-finite factors, invalid reciprocals and
negative scores. `constraintErrors` checks declaration shape; a schema plugin
checks the maximum on the complete patched component.

## Limits

The root export has no platform-specific storage or external runtime dependency.
`@yaks/vocab/tools` uses `@cfworker/json-schema` without generating code,
including in Cloudflare Workers. Both can run in Deno and Node through JSR.

This package declares and reads metadata. Storage belongs to
[@yaks/ram](../ram/README.md), [@yaks/sqlite](../sqlite/README.md) and other
adapters; writes and rule execution belong to [@yaks/graph](../graph/README.md);
full instance checking belongs to `admitSchema` from
[@yaks/graph/schema](../graph/README.md#admission-and-schema-checks). References
do not grant access or restrict who may read an entity.
