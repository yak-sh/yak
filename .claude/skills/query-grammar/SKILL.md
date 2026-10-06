---
name: query-grammar
description: >
  How a yaks query is written and read: clauses, operators, `.p` `!p` `?p`,
  bare text, `|`, grouping, walks (`->` `<-`), qualifiers, directives (`.order`
  `.limit` `.after` `.count` `.tally` `.distinct` `.fields` `*` `.refs` `.near`
  `.edges`), time values, reverse associations, rule matches with `;` `$vars`
  `+` and brackets, and refusing a property named without its component.
  Use it for any query: `yak graph query`, a tool's `q`, `graph_query`, a
  board, filter, rule/effect `match`, builder query, `.near` search or saved
  query; and before adding syntax that may exist already. Anatomy's
  plain-text search is `platform-visualize`, not query syntax. Computation
  and row cost are `graph-reads-and-writes`; full-text ranking and `.near`
  internals are `search-and-embeddings`; outputs are `builders-and-builds`.
---

# The query grammar

A query is how anything here asks the graph a question, and one grammar serves
every door (M-17876): the CLI, a tool's `q`, `graph_query`, a board, a filter, a
saved query, a rule's or effect's `match`, a builder's query. @yaks/query parses
it, @yaks/sql compiles it and @yaks/match evaluates it in memory, so a line that
works in one place works in all of them. packages/query/README.md is the
reference, and `yak help graph query` prints the short form agents get over MCP.

The grammar is terse on purpose: what a person types in a search box is also a
rule's match. Terseness pulls toward ambiguity, and the grammar holds it off two
ways. A token's shape says what it is, and anything it can't read for certain is
refused, never guessed: a property named without its component, an old
spelling, a stray word in a rule. Each refusal names the form that would have
worked, so read it as the grammar teaching you. And look before inventing: what
a design reaches for (include a component without filtering on it, say) is
often already a prefix or a directive.

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
  not on a bare name: `.task` tests a component, `task` searches the word.
- Each clause has one spelling; old forms (`.p!`, `.p?`, `!.p`) are refused
  with a message naming the right one (`!.task is written !task`).
- The empty query selects nothing, and `graph_query` refuses it.

## What comes back

A row carries only the components the query names, by filtering on them
(`.task`, `.doc.title~=cake`) or by asking for them (`?doc`); `*` carries
every component. A query that names no component (`.entity.eid=T-12`, a bare
word) answers whole. So `.task .task.status=open` returns task rows without
their `doc`; add `?doc` or `.fields=doc.title` to read titles.

## A name alone is a component

Many components share a property name, and a guess between them would be
silently wrong, so a property is always named with its component:
`.task.status=open`. A name by itself tests for a component, and a property
named alone is refused with every form that names it: `.status=open` answers
`.status is a property, not a component — name it .connection.status,
.dispatch.status, .plan.status, .request.status, .session.status, .task.status
or ._extends.status`. The refusal never picks one for you. A path through a
reference goes on with the target's own `comp.prop`
(`.filed.project.doc.title~=yak`), and the entity's id is `.entity.eid`.
Completion offers the qualified forms of a name as it is typed: `.ti` offers
`.timing` and `.doc.title`, and a form whose component is already on the line
comes first.

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
- **Reverse associations:** a reference seen from its target, named by the
  referring component's plural (packages/vocab/README.md, "Routing and
  references"). A component with two references carries the property in the
  name: `comment{target, reply_to}` gives `comments_target`, so
  `.task .comments_target>=3` counts the comments on each task. A `!` before
  the child test is the all/none form: `.task
  .comments_target!.created.by!=<person>` is the tasks with no comment by
  anyone else.

## Walks

- `.requires->T-61615`: what reaches T-61615 through `requires` edges (here
  T-61616, which requires it).
- `.requires<-T-61616`: what T-61616 reaches (T-61615).
- `.requires[<=3]->X` caps the depth; without a cap a walk returns at most
  10,000 nodes.
- The path is a relation name or a reference chain
  (`.comment.reply_to-><comment>`: the replies under a comment).
- An edge is its own entity: `.requires .edge.from=T-61616` is the edge row.
  `.task .requires` tests a task component that doesn't exist and answers 0.

## Directives

A directive belongs to the whole line wherever it is written.

| directive | example | answers |
| --- | --- | --- |
| `.count` | `.task !completed !cancelled .count` | `{"count": 1394}` |
| `.tally=` | `.task .tally=filed.project` | each value with its count (references come back as eids) |
| `.distinct=` | `.distinct=filed.priority` | the values |
| `.fields=` | `.fields=doc.title,filed.project.doc.title` | those properties; a path through a reference brings what it reaches as its own row |
| `*` | `.task *` | every component of each row |
| `.order=` | `.order=-created.at` | `-` is descending; `similar` (with `.near`), `search` (with words) and `hot` are rankings |
| `.limit=` `.after=` | `.limit=50&.after=T-13882` | a window; `.after` continues past an entity in any order |
| `.refs=` | `.refs=D-45640 .count` | what references it; `.refs` / `!refs` alone |
| `.near=` | `.task .near=T-6461 .limit=3` | ranked by meaning (`search-and-embeddings`) |
| `.edges` | `.edges[requires]` | asks for the edges touching the answer; it doesn't filter, and the caller fetches them (packages/edge/README.md) |

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
- `$region .region; [$sfx .sfx .sfx.region=$region]`: one binding per region
  holding all its sfx (a builder runs one build per outer binding).

How rules run is `effects-and-rules`.

## Writing one well

- Completion is the quickest way to look: `complete(vocab, text, caret)`
  (packages/query/complete.ts) is the engine behind every query field and
  offers what can be typed at the caret; `yak graph schema <comp>` lists
  properties.
- Rows are what a query costs, so the best answer is the least you'll read:
  `.count` over rows, `.fields` over whole bundles.
- A saved query (a board, a wake's `while`, a builder's query) is data that
  outlives the names in it, so a rename moves it too (`data-migration`).
- One grammar is worth more than any caller's convenience. Syntax a caller
  needs goes into @yaks/query and every evaluator in the same change, so every
  door gets it at once; a dialect private to one caller is a second grammar.

When this skill is wrong or missing something, fix it in the same change.
