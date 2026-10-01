---
name: query-grammar
description: >
  How a yaks query is written and read: clauses and operators, the `.p` `!p`
  `?p` prefixes, bare words as text, `|` and grouping, walks (`->` `<-`),
  qualifiers, directives (`.order` `.limit` `.after` `.count` `.tally`
  `.distinct` `.fields` `*` `.refs` `.near` `.edges`), time values, reverse
  associations, rule matches with `;` `$vars` `+` and brackets, and the
  ambiguity refusal. Use it whenever you write or read a query anywhere:
  `yak graph query`, a tool's `q`, `graph_query`, a board's query, a filter
  field, a rule's or effect's `match`, a builder's query, a `.near` search, a
  saved query in data; and before adding syntax to the grammar, since it is
  often already there. How the answer is computed (the archetype index, row
  cost, writes) is `graph-reads-and-writes`; full-text ranking and `.near`
  internals are `search-and-embeddings`.
---

# The query grammar

One grammar for every door (M-17876): @yaks/query parses it, @yaks/sql compiles
it, @yaks/match evaluates it in memory. packages/query/README.md is the
reference, and `yak help graph query` prints the short form agents get over
MCP. This skill is what you need to write a query right the first time. Check
the grammar before inventing syntax: what a design reaches for (include a
component without filtering on it, say) is often already a prefix or a
directive.

Every example below ran against the live graph.

## A token's shape decides what it is

A clause starts with a prefix character or holds an operator; anything else is
a full-text word. `crash on save .updated.at=today` is three words and one
filter. A malformed clause throws rather than becoming a search term.

| written | means |
| --- | --- |
| `.task` | has the component |
| `!filed` | lacks it (`.task !filed`: tasks not filed anywhere) |
| `?doc` | carry it in the answer when present, without filtering |
| `.task.status=open` | property equals |
| `.p=a,b` / `.p=1..5` | any of / range (`1...5` excludes the end) |
| `.p!=v` `.p~=v` | not equal / contains a literal substring |
| `.p<v` `.p<=v` `.p>v` `.p>=v` | comparisons |
| `word`, `"two words"`, `lemo*` | full-text terms (see `search-and-embeddings`) |

- Whitespace, `&` and `,` between terms all mean AND; `&` survives a URL.
  `|` is OR and binds looser: `.a .b|.c` is `(a and b) or c`; parentheses
  group. Inside a value `,` means any-of, and a list has no spaces.
- A value with a space is quoted: `.created.at>'1 hour ago'`. Unquoted, the
  second word becomes a search term.
- The leading dot may be dropped after an operator (`task.status=open`), but
  not on a bare name: `.env` tests a component, `env` searches the word.
- Each clause has one spelling; old forms (`.p!`, `.p?`, `!.p`) are refused
  with a message naming the right one.
- The empty query selects nothing.

## What comes back

A row carries only the components the query names, by filtering on them
(`.recipe`, `.doc.title~=cake`) or by asking for them (`?doc`); `*` carries
every component. A query that names no component (`.entity.eid=T-12`, a bare
word) answers whole. So `.task .task.status=open` returns task rows without
their `doc`; add `?doc` or `.fields=doc.title` to read titles.

## Ambiguity

A bare property two components declare is refused, naming them:
`.status=open` answers `Ambiguous: .status is ambiguous (connection, session,
task)`. Name the component (`.task.status=open`), or name it elsewhere on the
line: `.task .status=open` reads as `.task.status=open` (`meant()` in
packages/query/meant.ts). The properties of a `_` component never answer to a
bare name.

## Values the vocabulary interprets

The parser emits plain scalars; the compiler reads them by the property's type.

- **Times:** `today`, `yesterday`, `'1 hour ago'`, `'in 5m'`, or an ISO
  instant. `.task .created.at=today` is today's tasks; `>` and `<` compare
  against the span (packages/query/time.ts).
- **References:** a human id or eid, `.filed.project=P-19`.
- **Computed properties** filter like stored ones: `.task.status=wip`, from the
  `status` keyword; a status filter binds as presence
  (`graph-reads-and-writes`).
- **Kinds:** `.kind=memory` expands to the components that kind implies.
- **Reverse associations:** a plural of a component that references this one:
  `.task .comments>=3` counts referrers; `.reviews!.rating!=5` is the
  all/none form.

## Walks

- `.requires->T-61615`: what reaches T-61615 through `requires` edges (here
  T-61616, which requires it).
- `.requires<-T-61616`: what T-61616 reaches (T-61615).
- `.requires[<=3]->X` caps the depth; without a cap a walk returns at most
  10,000 nodes.
- The path is a relation name or a reference chain (`.fork.from->S-7`).
- An edge is its own entity: `.requires .edge.from=T-61616` is the edge row.
  `.task .requires` tests a task component that doesn't exist and answers 0.

## Directives

A directive belongs to the whole line wherever it is written.

| directive | example | answers |
| --- | --- | --- |
| `.count` | `.task !completed !cancelled .count` | `{"count": 1270}` |
| `.tally=` | `.task .tally=filed.project` | each value with its count (references come back as eids) |
| `.distinct=` | `.distinct=filed.priority` | the values |
| `.fields=` | `.fields=doc.title,filed.project.doc.title` | those properties; a path through a reference brings what it reaches as its own row |
| `*` | `.task *` | every component of each row |
| `.order=` | `.order=-created.at` | `-` is descending; `similar` (with `.near`), `search` (with words) and `hot` are rankings |
| `.limit=` `.after=` | `.limit=50&.after=T-13882` | a window; `.after` continues past an entity in any order |
| `.refs=` | `.refs=D-45640 .count` | what references it; `.refs` / `!refs` alone |
| `.near=` | `.task .near=T-6461 .limit=3` | ranked by meaning (`search-and-embeddings`) |
| `.edges` | `.edges[requires]` | the edges touching the answer |

`.order`, `.limit` and `.after` shape rows, so an aggregate ignores them:
`.count&.limit=20` counts every match. A trailing `~` in `.fields` mutes that
property from a subscription's change signal.

## Rules and matches

A rule's or effect's `match` is the same grammar, parsed strict (`{ text: false
}`: a stray word is refused, not searched), with more prefixes:

| written | in a rule |
| --- | --- |
| `+comp`, `+comp.p=v` | add it, or assign a property, when the rule runs |
| `+!comp` | must be absent, then added: fires once |
| `*comp` | the rule's write set (also asserts presence) |
| `-comp` | the current write removed it |
| `$name` | a variable shared across patterns |
| `#Name` | a singleton resource |

Patterns for several entities are separated by `;`, joined by shared variables,
and a bracket gathers inner matches into one binding:

- `$call .call, !execution, !results, !wake; +result.call=$call`
  (packages/tools/vocab.json, `call_ready`): an unclaimed call, and a new
  entity whose `result.call` is that call.
- `$region .region; [$sfx .sfx, sfx.region=$region]`: one binding per region
  holding all its sfx (a builder runs one build per outer binding).

How rules run is the `effects-and-rules` skill.

## Writing one well

- Look before inventing: `complete(vocab, text, caret)` (packages/query/
  complete.ts) is the engine behind every query field and offers what can be
  typed at the caret; `yak graph schema <comp>` lists properties.
- Ask for the least you'll read: `.count` over rows, `.fields` over whole
  bundles.
- A saved query (a board, a wake's `while`, a builder's query) is data that
  outlives the names in it; a rename has to move it too (`data-migration`).
- New syntax goes in @yaks/query and every evaluator in the same change, so
  every door gets it; never a private dialect in one caller.

When this skill is wrong or missing something, fix it in the same change.
