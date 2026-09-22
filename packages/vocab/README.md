# @yaks/vocab

A **vocabulary document** is a JSON Schema 2020-12 document whose `$defs`
entries describe components (`component: true`), tools (`tool: true`), or rules
(`rule: true`). This package defines that format and loads it: `loadVocab()`
reads one or more such documents into a runtime model used for validation, query
resolution, and storage schema generation. This package declares no components
of its own — the components you declare use the format it defines. The loaded
model lives in memory; this package creates no tables and stores no entity data.

## Use

```ts
import { loadVocab, storable } from '@yaks/vocab'

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
const errors = storable(catalog)
if (errors.length) throw new Error(errors.join('; '))
const vocab = loadVocab(catalog)
vocab.route('price') // { comp: 'book', prop: 'price' }
vocab.column('book', 'price')?.scalar // 'number'
vocab.check('book', { price: 12 }) // []
```

`loadVocab` accepts one document or an array. It checks component declarations
and duplicate names while loading; call `storable()` separately for the storage
profile checks. Use `metaSchema` with a JSON Schema validator when you also need
full document validation.

## The format

Each entry in `$defs` declares what it is. `"component": true` marks a
component: an object schema whose properties are the component's columns.
`"tool": true` marks a tool declaration, and `"rule": true` marks a rule.
Unmarked scalar subschemas are ignored. An unmarked entry with `type: "object"`
or `properties` throws, because the loader treats it as a component missing its
marker. Tool and rule declarations are read by separate functions below.

Standard JSON Schema keywords include `type`, `format`, `enum`, `const`,
`default`, `description` and `examples`. The yaks keywords — declared through
JSON Schema's `$vocabulary` mechanism, in `meta/core.vocab.json` — add what a
component table needs on top:

| keyword     | on     | means                                                                   |
| ----------- | ------ | ----------------------------------------------------------------------- |
| `component` | entry  | `true` = this entry is a component. Required; there is no default       |
| `extends`   | comp   | `true` = add these columns to a component another document declares     |
| `rule`      | entry  | `true` = a declarative rule, read by `rulesIn`                          |
| `tool`      | entry  | `true` = this entry is a tool declaration, not a table                  |
| `noun`      | tool   | the resource word a CLI answers to (`session list`, `list session`)     |
| `verb`      | tool   | the operation word; either word alone is the whole command              |
| `input`     | tool   | one schema per named argument, as a component declares columns          |
| `ref`       | column | the entity kind a string references (`"project"`, `"entity"`)           |
| `death`     | column | `cascade` \| `detach` \| `release` \| `keep` when the target is deleted |
| `computed`  | column | `true` = derived, never stored (a query-only rank)                      |
| `stamped`   | column | `true` = the server owns it: clients read it, never write it            |
| `search`    | column | `true` = this text column is full-text indexed                          |
| `aliases`   | column | input forms that resolve to an enum member                              |
| `bare`      | both   | `false` = only the qualified component/column name is accepted          |
| `unique`    | both   | column: no two rows share it. comp: `[["space","slug"]]`                |
| `index`     | both   | the same two forms, without the uniqueness                              |
| `required`  | comp   | native: the columns every row holds (NOT NULL)                          |
| `default`   | column | native: the row's fallback; `{"now": true}` is the clock                |
| `identity`  | both   | derive the entity's id from this. comp: `["space","slug"]`              |
| `kind`      | comp   | this component names a display kind                                     |
| `before`    | comp   | kinds this kind sorts before (feeds the derived kindOrder)              |
| `wire`      | comp   | `false` = a component clients read but cannot write                     |
| `sync`      | comp   | who is told about a write: `none` \| `server` (default) \| `peers`      |
| `durable`   | comp   | how long a value lives: `forever` (default) \| `connection` \| `5s`     |

Storage adapters interpret the loaded metadata: `type: integer` stores with
integer affinity where a plain `number` uses SQLite REAL affinity, `enum`
becomes a CHECK on the column, `required` becomes NOT NULL, and `default` fills
the row that omits the column. A composite `unique` or `index` entry may be
partial: an entry of `{"cols": ["key"], "present": ["key"]}` covers only the
rows that hold a key, so multiple rows can omit a key while non-null keys remain
unique.

Every stored `ref` column is indexed automatically, including stamped refs and
refs with `death: "keep"`. No `index: true` is needed, and `index: false` does
not opt out. A reference that already leads a declared index (including a
composite unique or identity index) needs no additional single-column index.

**`search` selects columns for full-text indexing.**
[@yaks/fts](https://jsr.io/@yaks/fts) builds one index per component using
stored text columns marked `search: true`. Unmarked columns remain readable but
are excluded from that index. `storable()` rejects `search: true` on numbers,
references, enums, computed columns and the `date-time`, `uri`, `query` and
`json` string formats. `@yaks/match` searches stored text directly and currently
does not consult this keyword. The following is a `$defs` fragment:

```json
{
  "recipe": {
    "component": true,
    "type": "object",
    "properties": {
      "note": { "type": "string", "search": true },
      "serves": { "type": "number" }
    }
  }
}
```

**`identity` declares deterministic entity ids.** A component whose column is
marked `identity: true` derives entity ids from that value, as `@yaks/edge` and
`@yaks/key` do. Writing the same identity again updates the same entity without
requiring the caller to retain its `eid`. The following is a `$defs` fragment:

```json
{
  "guide": {
    "component": true,
    "type": "object",
    "properties": {
      "slug": { "type": "string", "identity": true },
      "brief": { "type": "string" }
    }
  }
}
```

`{guide: {slug: 'store', brief: '…'}}` applied a second time patches the first
entity. This package reports the declaration through `identity(comp)`;
[@yaks/graph](https://jsr.io/@yaks/graph) derives the id and rejects a bundle
whose `eid` disagrees with it. A bundle is one entity's components as a JSON
object.

Applications can build completions from native `examples` and distinct stored
values. Component names are alphabetical; writable and stamped column lists
follow their schema declarations. `kindOrder` is alphabetical, constrained
topologically by `before`; a cycle is an error.

**Reverse associations let queries follow references in reverse.** `review.book`
makes `.reviews` mean the reviews pointing at a book, and a component with
several references disambiguates with the column name (`loan.book` →
`.loans_book`). A forward name always wins, so an association never shadows a
column or a component.

```json
{
  "$vocabulary": { "https://yaks.sh/vocab/core": true },
  "$defs": {
    "task": {
      "component": true,
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

## One word, one home — and one exception

A component is declared once. Loading two documents that both declare `doc`
throws: one name, one home, so a package's vocabulary composes with every
other's.

The exception is the spine. `entity` is the identity row every entity has, and
more than one package keeps something in it — the archetype a component set adds
up to, the number a human id is built from. A document adds a column to it by
marking the entry `extends`:

```json
{
  "$defs": {
    "entity": {
      "component": true,
      "extends": true,
      "properties": { "num": { "type": "number", "stamped": true } }
    }
  }
}
```

An extension carries columns and nothing else — `kind`, `prefix`, `wire` and the
indexes belong to the document that declares the component — and a column the
base already has is refused rather than overridden. Extensions are applied after
every document is read, so the load order decides nothing, and an extension of a
component no document declares is an error.

## Extension keywords

Packages can add metadata such as id prefixes, name columns and units through a
**keyword vocabulary**: a URI and a registration describing the permitted
component and column keywords. `@yaks/blob` uses this mechanism for
`store: "blob"`, which selects string columns for content-addressed storage.

```ts
import { extendMeta, loadVocab } from '@yaks/vocab'

let shelf = {
  uri: 'https://example.com/vocab/shelf',
  comp: ['shelf'], // keywords this vocabulary adds to a component
  column: ['unit'], // …and to a column
  doc: { $defs: { shelf: { type: 'string' }, unit: { type: 'string' } } },
}

const shelfCatalog = {
  $defs: {
    book: {
      component: true,
      type: 'object',
      shelf: 'fiction',
      properties: { weight: { type: 'number', unit: 'gram' } },
    },
  },
}
let v = loadVocab(shelfCatalog, [shelf])
v.comp('book')?.keywords.shelf // 'fiction'
v.column('book', 'weight')?.keywords.unit // 'gram'
extendMeta([shelf]) // the meta-schema, now admitting those keywords
```

The loader copies registered extension keywords to the loaded model. The package
that declares each keyword implements its behavior.
[@yaks/id](https://jsr.io/@yaks/id) owns `prefix` this way, and
[@yaks/names](https://jsr.io/@yaks/names) owns `by_name`. A keyword nobody
registered is dropped.

## The runtime

```ts
import { loadVocab } from '@yaks/vocab'

let v = loadVocab([kernel, work]) // application-supplied documents; each component name must be unique

v.comps // client-writable component names, alphabetical
v.kinds // display kinds: alphabetical, constrained by `before`
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
v.deaths('cascade') // client-writable references with this deletion behavior
v.check('task', { priority: 1 }) // [] when supplied columns and values are valid
```

The root export provides these document checks:

- `storable(doc)` checks scalar, reference and enum columns, rejects nesting,
  arrays and column `$ref`, and checks indexes, defaults, identities and state
  lifetimes. A component declaring all of `at`, `by` and `via` must mark each
  column `stamped: true` so clients cannot supply that provenance.
- `reserved(doc, names)` rejects entries that reuse a reserved name.
- `grow(was, next)` reports added columns and rejects removed columns or changes
  to their category, scalar type or reference target. Enum members can be added.

These functions return errors; they do not migrate or write storage. Reference
`death` values specify what the graph does when the target is deleted: `cascade`
deletes the referencing entity, `detach` clears its reference column, `release`
removes its referencing component, and `keep` retains the reference without a
foreign-key constraint.

`syncOf(vocab, comp)` and `durableOf(vocab, comp)` read state-lifetime metadata,
including defaults for unknown components. `sync` selects server
synchronization, peer relay, or local-only data; `durable` selects permanent
storage, connection-lifetime memory, or a duration. `ms('5s')` returns `5000`;
`ms('forever')` and `ms('connection')` return `null`. `lives()` validates
lifetime strings; `said()` and `kept()` normalize the two declarations. Storage
and sync packages implement these policies; this package does not retain or
expire data.

See `vocab_test.ts` and `validate_test.ts` for vocabulary loading and validation
examples.

## Compatibility

The root export is TypeScript with no external runtime dependency. The separate
`@yaks/vocab/tools` export validates JSON Schema with @cfworker/json-schema,
which interprets a schema rather than generating code, so it also runs in a
Cloudflare Worker. Neither uses platform-specific storage; both can run on Deno
and Node (via JSR / npm).

## Tools

Import tool helpers from `@yaks/vocab/tools`; they are not re-exported by
`@yaks/vocab`.

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
to one object schema for consumers such as the CLI argument parser, MCP tool
listing and shell completion. `loadVocab` skips tool entries, so a document is
read once for its components and once for its tools and neither reading knows
about the other. The entry's key is the tool's name, which is how an
implementation is found: `loadTools` in `@yaks/graph/tools` joins a declaration
to the handler the module supplies, and rejects a declaration without a handler.

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
defaults, for adapters that need a reusable validator.
`validateToolOutput(tool, value)` validates against `tool.outputSchema` without
mutating the result. Validators are cached per schema object. Treat registered
schemas as immutable.

Nouns and verbs are single lowercase words (hyphens and digits allowed). A tool
may declare both, or either one alone. Two words are a command line accepted in
either order (`session list`, `list session`) and sent to the server as
`session_list`; one word alone is the whole command and the whole transport
name, so `"noun": "history"` is `yak history T-5` on the command line and
`history` over `/mcp`. The entry's own name is the tool's name either way, so a
tool that already has a name (`land`) may declare neither. `options.positional`
orders input property names; `options.short` maps single letter flags to
property names. Long options derive from property names. Handlers are functions
that receive the graph's `Tool` context. The legacy `input` declaration remains
supported by existing adapters, but cannot be combined with `inputSchema` on the
same tool. `outputSchema` optionally declares the result schema; tools without
it have no result validation through this helper.

## Rules

A `$defs` entry marked `rule: true` declares a graph rule. By default the graph
evaluates it during each batch, a list of changes applied in one transaction.

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
joined by the variables they share. Prefix characters specify the actions:
`+comp` ensures the component, `+!comp` requires absence and adds the component
to prevent a repeated match, `*comp` is its write set, `$name` names an entity,
and a `$name` in a value refers to that same variable. `before` names the rules
this one runs before, to specify execution order.

`rulesIn(docs)` reads rule entries, the way `toolsIn` reads tool declarations,
and `loadVocab` skips both. For the default `rules` phase, `match` describes the
changes directly; no separate handler is required. `phase: "effect"` instead
declares a pattern for a post-commit handler or an explicit scan and is not
executed during `apply()`. `@yaks/graph` loads rule declarations from plugin
documents.

## Exports

The root export includes `loadVocab`, `Vocab`, schema and column types,
`Unknown` and `Ambiguous` lookup errors, `storable`, `reserved`, `grow`,
`kindOrder`, `composite`, state-lifetime helpers, `rulesIn`, and `RuleDecl`.
`CORE_URI`, `coreVocabulary` and `metaSchema` expose the bundled schema
documents; `Keywords`, `JsonSchema` and `extendMeta` support extensions.

The `@yaks/vocab/tools` sub-module exports `ToolDefinition`, `toolDefinition`,
`toolDefinitionSchema`, `toolsIn`, `toolsSaid`, `validateToolInput`,
`validateToolOutput` and `toolOutputValidator`. `toolsSaid` loads declarations
without compiling argument validators; `toolsIn` also validates metadata,
input/output schemas and option mappings.
