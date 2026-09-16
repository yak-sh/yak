// The grammar, said once: the dot-param and filter doc strings that teach
// every door (MCP tool descriptions, `task help grammar`). They derive
// from the vocabulary — comps and statuses — so the teaching text cannot
// drift from what the routing actually accepts. io-agnostic on purpose:
// the CLI must import this without dragging in the MCP SDK.
import { FORMAT } from '@yaks/query'
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
by their property names: '.assignee=jeff' routes to filed.assignee, and any reference
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

// The format is the package's to teach (@yaks/query FORMAT); what follows is
// what THIS vocabulary adds: typed atoms, the shared stamp columns, the kind
// scope, id resolution, the rows a listing screens, and where a query lives.
export let FILTERS = `${FORMAT}
Here each scalar/list/range atom parses through the property's type, so
invalid enum, boolean, number, and priority values fail loudly:
'.priority<=P1', '.domain=Ops,Eng', '.priority=P1..P3', '.verified=yes',
'.num=01,2,3'. The stamps share column names, so spell out the component:
'.created.at', '.updated.at' (an entity never touched since reads its
created.at), '.created.by=jeff' (who authored), '.updated.by!=jeff'.
'.decided.at' is the DECISION's own date — it can be older than the row,
which is why 'task decided' orders by it and not by when a thing was filed.
'.proposed=' is the fix queue (absent), '.proposed!' the idea backlog.
'.kind=memory' is the most specific kind present, a scope that composes like
a column. Reference filters resolve aliases and human ids ('.assignee=jeff',
'.project=P-19'), and '.archived.at=' means live. Reverse associations are
named by pluralizing the referencing component ('.comments', '.claims'). A
quarantined row is listed only by a filter naming '.quarantined'; a blob row
only by one naming '.blob' or '.image'; session-log entries only by one naming
an entry component ('.entry.session=S-1'). Boards persist these same queries
(board.query).`
