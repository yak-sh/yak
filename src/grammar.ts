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
'.verified=yes', '.priority=p02'). Statuses: ${statuses.join(', ')}.`

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
'.project.retired_at=' — absent means live), it never dereferences. Bare words
are text terms (doc contains). Boards persist these same queries
(board.query).`
