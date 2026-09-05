// The grammar, said once: the dot-param and filter doc strings that teach
// every door (MCP tool descriptions, `task help grammar`). They derive
// from the vocabulary — comps and statuses — so the teaching text cannot
// drift from what the routing actually accepts. io-agnostic on purpose:
// the CLI must import this without dragging in the MCP SDK.
import { comps, type PropType, statuses } from './types.ts'

// A prop's type, said inline where it isn't obvious: enums spell their
// values, associations say (eid) — the doc string derives from the same
// typed table everything else reads.
let sig = (t: PropType) =>
  typeof t == 'string'
    ? t == 'priority' ? '(P<number>)' : ''
    : 'enum' in t
    ? `(${[...t.enum, ...Object.keys(t.aliases ?? {})].join('|')})`
    : 'eid' in t
    ? '(eid)'
    : ''

export let GRAMMAR =
  `Dot-params: '.prop=value' routes by prop through the component
vocabulary (${
    Object.entries(comps).map(([n, props]) =>
      `${n}: ${
        Object.entries(props).map(([p, t]) => p + sig(t)).join('/') || '(tag)'
      }`
    ).join('; ')
  }). A prop unique to one component routes bare ('.title=x' → doc); for the
few collisions (pin/camera x,y,w,h) use '.comp.prop=x'. References go
by their property names: '.assignee=jeff' routes to task.assignee, and any reference
value may be an alias, a human id (T-3, P-19), or an eid. Numeric-looking
text stays text; typed scalars parse by their grammar ('.pin.x=01',
'.verified=yes', '.priority=p02'). Empty writable tags use Boolean presence
('.verifier=true' adds it; '.verifier=false' removes it). To change PART of a
long text value, a dot-param value may be the $edit OPERATOR spelled as the
same JSON graph_apply takes —
'.body={"$edit":{"old":"teh","new":"the"}}' patches in place instead of
replacing the whole value. Statuses: ${statuses.join(', ')}.`

// The $edit operator, taught in full beside graph_apply (the wire door) and
// appended to `task help grammar`; GRAMMAR carries the one-line dot-param
// spelling, since the update doors (task_update, `task set`) route the same
// operator. This is the one Claude-facing surgical edit surface; the codex V4A
// equivalent is the graph_patch tool.
export let EDIT_OP =
  `The $edit operator (surgical in-place edit): in a graph_apply CHANGE, a
text/body comp value may carry {$edit: …} instead of a whole new literal.
The dot-param doors take the same operator as its JSON text —
task_update ".body={\\"$edit\\":{\\"old\\":\\"a\\",\\"new\\":\\"b\\"}}".
apply() reads that column's CURRENT value under the write lock and replaces
old→new in place — the comp-agnostic Edit primitive, working on ANY text or
body column of ANY comp (doc.body, doc.title, a design/persona/memory body,
project.color, …). Shape: one hunk {old, new, all?}, or a LIST of hunks
applied in order; an empty new deletes the matched text. old must occur
exactly ONCE unless all:true. Guarantees: a non-match, or an ambiguous
match (several hits without all), is REFUSED so you never change the wrong
text, and a net-unchanged result is refused too. Because it merges into the
current value under the lock (old must still match), a concurrent full-value
rewrite is never clobbered — the batch refuses instead. Refused on
enum/number/reference/bool columns with an addressed error. Prefer it over
rewriting a whole large value literally — cheaper, and safe against a
concurrent edit. Example change:
{"eid":"T-3","name":"doc","comp":{"body":{"$edit":[{"old":"foo","new":"bar"}]}}}`

export let FILTERS = `Filters add operators to that routing: '.priority<=P1',
'.domain=Ops,Eng' (any of), '.priority=P1..P3' (range; P1...P3 excludes
the end), '.status!=done', '.title~=flux' (literal contains), '.domain='
(absent), '.proposed.at!' (present), '.verified=yes', '.num=01,2,3'. Each
scalar/list/range atom
parses through the property's type; invalid enum, boolean, number, and
priority values fail loudly. Timestamp columns take time phrases — today,
yesterday, '2026-07-04', this|last|next week|month|year, '5 minutes ago',
'in 2 days' (or 'in 60m' / 'after 8h'), clock times — 9am, 9:30pm,
14:00, noon, '9am tomorrow' — and a full stamp, '2026-07-25T09:00'. A
phrase is a RANGE: = within it, >= from its start, <= to its
end ('.updated.at>="1 hour ago"'; glue with - where quoting is hard).
The stamps share column names, so spell out the component: '.created.at',
'.updated.at', '.created.by=jeff' (who authored), '.updated.by!=jeff'.
'.decided.at' is the DECISION's own date — it can be older than the row,
which is why 'task decided' orders by it and not by when a thing was filed.
Component names test facets directly: '.proposed=' means absent (the fix
queue), while '.proposed!' means present (the idea backlog).
Quotes hold a value together against BOTH separators, whitespace and '&':
'.web.url="https://x.test/p?a=1&b=2"' is one predicate, where unquoted the
'&' would start a second one.
Reference filters resolve aliases and human ids ('.assignee=jeff',
'.project=P-19'),
and a DOTTED path walks one reference: '.assignee.title~=jeff' — but a
first segment naming a component stays the explicit spelling ('.pin.x=12',
'.archived.at=' — absent means live), it never dereferences.
A PLURAL first segment walks a reference the OTHER way — the entities
pointing back at this one: '.comments.created.by=jeff' keeps every entity
with a comment jeff wrote, ANY child matching (the default). '.comments!'
has any comment, '.comments=' has none, '.comments>=5' counts them, and a
'!' on the association negates — '.comments!.created.by=jeff' has NONE by
jeff, '.comments!.created.by!=jeff' has EVERY comment by jeff (ALL, by De
Morgan). Bare words are text terms (doc contains).
AGGREGATES reduce the selection to a VALUE instead of rows: '.count!' how
many ('.status=open&.count!'), '.tally=status' each value's count,
'.distinct=domain' the values themselves. They ride beside the filters that
select what they reduce, and they answer from the index — a caller wanting a
number asks for the number, never for the rows to count.
A WINDOW bounds the ANSWER without changing what matches: '.limit=200' is
200 of them, newest by id when the line names no order, '.after=13882'
continues past one you already have, so paging is '.limit=200' then the same
line carrying your last id's number. An '.order=' SURVIVES a window and the
window pages inside it — the cursor names an ENTITY, never a place, so the
one spelling pages a ranking ('.order=hot') as well as an id order.
A reply that carries a window says so, and says the total it is a prefix of.
Boards persist these same queries (board.query).`
