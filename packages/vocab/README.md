# @yaks/vocab

A **vocabulary document** is a JSON Schema 2020-12 document whose `$defs`
entries are marked `component: true` or `tool: true`. This package defines that
format and loads it: `loadVocab()` reads one or more such documents into a
runtime model used for validation, query resolution, and storage schema
generation. This package declares no components of its own — the components you
declare are an instance of the format it defines.

## The format

Each entry in `$defs` declares what it is. `"component": true` marks a
component: an object schema whose properties are the component's columns.
`"tool": true` marks a tool declaration. An entry with neither marker is an
ordinary reusable subschema that this format ignores — `$defs` is JSON Schema's
own reuse slot and stays usable as one.

Native JSON Schema carries `type`, `format`, `enum`, `const`, `default`,
`description` and `examples`. The yaks keywords — declared through JSON Schema's
own `$vocabulary` mechanism, in `meta/core.vocab.json` — add what a component
table needs on top:

| keyword     | on     | means                                                               |
| ----------- | ------ | ------------------------------------------------------------------- |
| `component` | entry  | `true` = this entry is a component. Required; there is no default   |
| `tool`      | entry  | `true` = this entry is a tool declaration, not a table              |
| `noun`      | tool   | the resource word a CLI answers to (`session list`, `list session`) |
| `verb`      | tool   | the operation word; either word alone is the whole command          |
| `input`     | tool   | one schema per named argument, as a component declares columns      |
| `ref`       | column | the entity kind a string references (`"project"`, `"entity"`)       |
| `death`     | column | `cascade` \| `detach` \| `release` \| `keep` when the target dies   |
| `computed`  | column | `true` = derived, never stored (a query-only rank)                  |
| `stamped`   | column | `true` = the server owns it: clients read it, never write it        |
| `search`    | column | `true` = this text column is full-text indexed                      |
| `store`     | column | `"blob"` = a content-addressed markdown body                        |
| `aliases`   | column | input forms that resolve to an enum member                          |
| `bare`      | both   | `false` = never claims its bare filter name; qualified only         |
| `unique`    | both   | column: no two rows share it. comp: `[["space","slug"]]`            |
| `index`     | both   | the same two forms, without the uniqueness                          |
| `required`  | comp   | native: the columns every row holds (NOT NULL)                      |
| `default`   | column | native: the row's fallback; `{"now": true}` is the clock            |
| `identity`  | both   | the entity's id is DERIVED from this. comp: `["space","slug"]`      |
| `kind`      | comp   | this component names a display kind                                 |
| `before`    | comp   | kinds this kind sorts before (feeds the derived kindOrder)          |
| `wire`      | comp   | `false` = a component clients read but cannot write                 |
| `sync`      | comp   | who is told about a write: `none` \| `server` (default) \| `peers`  |
| `durable`   | comp   | how long a value lives: `forever` (default) \| `connection` \| `5s` |

Native keywords reach the table as written: `type: integer` stores with integer
affinity where a plain `number` stores real, `enum` becomes a CHECK on the
column, `required` becomes NOT NULL, and `default` fills the row that omits the
column. A composite `unique` or `index` entry may be partial: an entry of
`{"cols": ["key"], "present": ["key"]}` covers only the rows that hold a key, so
keyless rows may be many and keyed ones must be one.

Every stored `ref` column is indexed automatically, including stamped refs and
refs with `death: "keep"`. No `index: true` is needed, and `index: false` does
not opt out. A reference that already leads a declared index (including a
composite unique or identity index) needs no additional single-column index.

**`search` is what makes a column searchable.** A column marked `"search": true`
is full-text indexed, and a bare word in a query matches it; a text column
nobody marked is stored and readable but never searched, so a repo path or a
provider name is not something a search has to wade through. The keyword is for
stored prose — a number, a stamp, a reference, a closed set and a computed
column hold no prose, and `validate.ts` rejects the keyword there. This package
DECLARES it; [@yaks/fts](https://jsr.io/@yaks/fts) builds the index, one per
component, from the columns that declared it.

```json
{
  "recipe": {
    "type": "object",
    "properties": {
      "note": { "type": "string", "search": true },
      "serves": { "type": "number" }
    }
  }
}
```

**`identity` is what names the entity.** A component whose column is marked
`"identity": true` has its entities' ids DERIVED from that value — the same
derivation an edge and a key already use — so a file, a row or a seed written
twice is one entity, and there is no eid for anybody to have kept:

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
entity. This package DECLARES the keyword and reports it through
`identity(comp)`; [@yaks/graph](https://jsr.io/@yaks/graph) derives the id and
rejects a bundle whose eid disagrees with it.

A text field's completions draw from native `examples` plus the column's own
live distinct values. Ordering is derived, never hand-ranked: component and
stamped order are alphabetical, and kindOrder is alphabetical refined
topologically by `before` (a cycle is an error).

**Reverse associations are derived too.** Every reference column is also a name
on the far side: `review.book` makes `.reviews` mean the reviews pointing at a
book, and a component with several references disambiguates with the column name
(`loan.book` → `.loans_book`). A forward name always wins, so an association
never shadows a column or a component.

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

`meta/vocab.schema.json` is the meta-schema a vocabulary document validates
against.

A JSON column is `{ "type": "string", "format": "json" }`. The runtime reports
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

The loader **carries** a registered keyword through to the loaded model and
never interprets one — what a keyword MEANS belongs to the package that declared
it. [@yaks/id](https://jsr.io/@yaks/id) owns `prefix` this way, and
[@yaks/names](https://jsr.io/@yaks/names) owns `by_name`. A keyword nobody
registered is dropped.

## The runtime

```ts
import { loadVocab } from '@yaks/vocab'

let v = loadVocab([kernel, work]) // one or many docs, merged; one home per name

v.comps // client-writable component names, alphabetical
v.kinds // kindOrder: alphabetical + topological over `before`
v.column('task', 'project')
// { category: 'ref', ref: 'project', death: 'detach',
//   affinity: 'integer', fk: true, stamped: false, computed: false, … }
v.route('title') // { comp: 'doc', prop: 'title' }   bare prop → its component
v.route('eid') // { comp: 'entity', prop: 'eid' }  the entity identity
v.aim('comment.target.doc.title') // [{comment,target}, {doc,title}]  path → hops
v.aim('project', true) // [{project,''}]  the presence form: `.project!` asks
// whether the entity has the `project` component, even where `task.project`
// claims the bare name

v.assoc('reviews') // { comp: 'review', prop: 'book' }  a plural → its reverse
v.kindOf({ task: 1, doc: 1 }) // 'task' — most specific kind wins
v.deaths('cascade') // the delete worklist: [comp, col] pairs
v.check('task', { priority: 1 }) // [] — instance well-formedness
```

`validate.ts` holds the document checks: the **storable profile** (an object of
scalar/ref/enum columns — no nesting, arrays, or recursive `$ref` a table can't
lower), **reserved** names a base vocabulary already owns, and **grow** — the
additive-forever rule: a column never drops or retypes, because its rows were
written under the old type.

See `vocab_test.ts` and `validate_test.ts` for vocabulary loading and validation
examples.

## Compatibility

Pure TypeScript with no runtime dependency — a vocabulary is plain JSON Schema.
Runs on **Deno** and **Node** (via JSR / npm).

## Tools

A tool is declared where the components are, in `$defs`, marked `tool: true`:

```json
{
  "$defs": {
    "session": { "component": true, "type": "object", "properties": {} },
    "session_list": {
      "tool": true,
      "noun": "session",
      "verb": "list",
      "description": "List sessions in the connected graph.",
      "input": { "scope": { "type": "string" } },
      "required": ["scope"],
      "readOnly": true
    }
  }
}
```

`toolsIn(docs)` returns those declarations, each with its `input` map converted
to the single object schema everything downstream reads — the CLI's argument
parser, an MCP `tools/list`, a shell completion. `loadVocab` skips tool entries,
so a document is read once for its components and once for its tools and neither
reading knows about the other. The entry's NAME is the tool's name, which is how
an implementation is found: `loadTools` in `@yaks/graph/tools` joins a
declaration to the handler the module supplies, and a declaration nobody
implements is a load error rather than a tool that lists and then fails.

`@yaks/vocab/tools` also validates a declaration written in code, independently
of any document.

```ts
import { toolDefinition } from '@yaks/vocab/tools'
import type { Tool } from '@yaks/graph'

const definition = toolDefinition({
  noun: 'session',
  verb: 'list',
  description: 'List sessions',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { limit: { type: 'integer', minimum: 1, default: 20 } },
  },
  options: { short: { n: 'limit' } },
})
const tool: Tool = { ...definition, run: (args) => args }
```

`toolDefinitionSchema` is the JSON Schema for the declaration itself.
`validateToolInput(tool, args)` validates a copy of the argument object and
applies schema defaults. Schemas default to JSON Schema 2020-12; an explicit
`$schema` selects draft-07, 2019-09, or 2020-12. Unsupported dialects are
rejected. Local references work; remote references are not fetched.
`toolOutputValidator(schema)` compiles the same dialects without applying
defaults, for adapters that need a reusable validator. Validators are cached per
schema object. Treat registered schemas as immutable.

Nouns and verbs are single lowercase words (hyphens and digits allowed). A tool
may declare both, or either one alone. Two words are a command line accepted in
either order (`session list`, `list session`) and sent to the server as
`session_list`; one word alone is the whole command and the whole transport
name, so `"noun": "history"` is `yak history T-5` on the command line and
`history` over `/mcp`. The entry's own name is the tool's name either way, so a
tool that already has a name (`land`) may declare neither. `options.positional`
orders input property names; `options.short` maps single letter flags to
property names. Long options derive from property names. Handlers remain code
and receive the existing graph Tool context. The older opaque/Zod argument bag
remains supported by existing adapters, but cannot be combined with
`inputSchema` on the same tool. JSON output declarations and a uniform migration
of legacy tools are not part of this first input pilot.

## Rules

A `$defs` entry marked `rule: true` is a RULE: a query the graph runs over every
batch of changes, and there is nothing else to it.

```json
{
  "$defs": {
    "settle": {
      "rule": true,
      "description": "every call gets a result",
      "match": "$c .call, results=; +result.call=$c",
      "before": ["sweep"]
    }
  }
}
```

`match` is one or more ordinary query patterns separated by `;`, one per entity,
joined by the variables they share. The sigils carry the rest: `+comp` ensures
the component, `+!comp` gates so the rule fires once, `*comp` is its write set,
`$name` names an entity, and a `$name` in a value refers to that same variable.
`before` names the rules this one runs before, so order is declared rather than
incidental.

`rulesIn(docs)` reads rule entries, the way `toolsIn` reads tool declarations,
and `loadVocab` skips both. The difference is that there is nothing to join a
rule to: a tool declaration names the tool and a module implements it, while a
rule's `match` IS the implementation. `@yaks/graph` reads a plugin's own
documents for rules, so an app that ships one in its manifest needs no wiring at
all.
