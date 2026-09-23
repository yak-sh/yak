// The query format, described once. OPERATORS and DIRECTIVES are the tables
// everything else is built from — a help page prints them, a tab-completion
// list offers them — and FORMAT is the prose a CLI or an MCP server returns
// when asked how a query is written, composed from those same tables so the two
// cannot disagree. None of it knows a schema: which properties hold times,
// which names are kinds, and how an id resolves are for a schema-aware caller
// to describe alongside.

// One piece of the format: how it is written, the single word for what it is,
// and what it does.
export type Taught = { spell: string; word: string; means: string }

// The predicate operators, in the order someone learns them. The word is the
// reading for a time property (a phrase names a range, and the operator picks
// which edge of it), which reads sensibly for ordinary values too.
export let OPERATORS: Taught[] = [
  {
    spell: '=',
    word: 'equals',
    means: '.p=v equals; .p=a,b,c any of; .p=1..5 a range, inclusive ' +
      '(.p=1...5 excludes the end); .p= absent',
  },
  {
    spell: '!',
    word: 'exists',
    means: '.p! present (including an empty value)',
  },
  { spell: '!=', word: 'not', means: 'negates any = form' },
  {
    spell: '~=',
    word: 'contains',
    means: 'literal, case-insensitive; .p~= is present, the same as .p!',
  },
  { spell: '<', word: 'before', means: 'strictly less' },
  { spell: '<=', word: 'until', means: 'at most' },
  { spell: '>', word: 'after', means: 'strictly more' },
  { spell: '>=', word: 'since', means: 'at least' },
  {
    spell: '?',
    word: 'wanted',
    means: '.comp? carries the component beside the filter without ' +
      'filtering on it; ?comp is the same request',
  },
]

// The reserved names that sit in a clause list and rank, project, aggregate or
// bound the answer rather than filter it.
export let DIRECTIVES: Taught[] = [
  { spell: '.order=', word: 'rank', means: 'the order the answer comes in' },
  { spell: '.near=', word: 'rank', means: 'the entity whose likeness ranks' },
  {
    spell: '.refs=',
    word: 'backlinks',
    means: '.refs=X everything referencing X; .refs! references anything; ' +
      '.refs= references nothing',
  },
  { spell: '.count!', word: 'aggregate', means: 'how many match' },
  { spell: '.tally=', word: 'aggregate', means: "each value's count" },
  { spell: '.distinct=', word: 'aggregate', means: 'the values themselves' },
  {
    spell: '.fields=',
    word: 'projection',
    means:
      'the properties each row carries (.fields=pin.x,pin.z~; a trailing ' +
      '~ mutes a property from the change signal)',
  },
  { spell: '*', word: 'projection', means: 'every component of each row' },
  { spell: '.limit=', word: 'window', means: 'at most N of the answer' },
  {
    spell: '.after=',
    word: 'window',
    means: 'continue past one entity, by number or id (.after=T-13882)',
  },
  {
    spell: '.edges!',
    word: 'rider',
    means: 'the edges incident to the answer; .edges.peers=status,title ' +
      'projects the far endpoint; .edges[type,via]! selects one type',
  },
  {
    spell: '->',
    word: 'walk',
    means: '.requires->T-42 what reaches T-42 through requires; <- the other ' +
      'way; .requires[<=3]->T-42 caps the depth',
  },
]

let row = (t: Taught) => `'${t.spell}' ${t.word}: ${t.means}`

// What a CLI or an MCP server prints when asked how a query is written. Every
// statement here is one the parser enforces; a caller that knows a schema adds
// its own after it.
export let FORMAT = `Filters are dot-params: '.prop=value'. Operators — ${
  OPERATORS.map(row).join('; ')
}.
A time-typed property takes time phrases: today, yesterday, tomorrow, now,
this|last|next minute|hour|day|week|month|year, '5 minutes ago', 'in 2 days'
(or 'in 60m', 'after 8h'), clock times (9am, 9:30pm, 14:00, noon, '9am
tomorrow'), a date, and a full stamp ('2026-07-25T09:00'). A phrase is a
RANGE: = within it, >= from its start, <= to its end
('.updated.at>="1 hour ago"'; glue with - where quoting is hard: 1-hour-ago).
A component name alone tests presence: '.comp' or '.comp!' wears it, '!comp'
or '.comp=' does not; '?comp' selects it when worn without filtering on it.
Whitespace separates terms; every term stands alone. Between terms '&' and
',' are aliases for whitespace ('&' is the same query as a URL string); '|'
between terms is OR and binds looser than the AND of adjacent terms
('.a=1 .b=2|.c=3' is (a and b) or c), and parentheses group ('.a=1 (.b=2|.c=3)').
A directive stays outside the '|'; inside a value ',' is the list operator,
with no spaces ('.status=open,wip', never 'open, wip'). Quotes, double or
single, hold a value together against both separators
('.web.url="https://x.test/p?a=1&b=2"' is one predicate, '.title~="two words"'
one filter, where unquoted '.title~=two words' is the filter 'two' and the
search word 'words'). Bare words are text terms (the document contains them;
a trailing * matches a prefix).
A DOTTED path walks a reference: '.author.title~=j' tests the target's title;
a first segment naming a component is the explicit form ('.pin.x=12') and
never dereferences. A reverse association, named by the schema, walks the other
way: '.comments.author=jeff' keeps what has ANY such child; '.comments!' has
any, '.comments=' none, '.comments>=5' counts, and '!' on the association
negates ('.comments!.author=jeff' has NONE by jeff; '.comments!.author!=jeff'
has EVERY comment by jeff, by De Morgan).
Directives ride beside the filters — ${DIRECTIVES.map(row).join('; ')}.
A WALK has no hop cap by default and returns at most 10,000 nearest nodes;
only an explicit [<=N] caps it. The bracket is a QUALIFIER on the path, and a
clause refuses one it does not take. An AGGREGATE reduces the selection to a
value instead of rows and answers from the index: ask for the number, never
for the rows to count. A WINDOW bounds the ANSWER without changing what
matches: '.limit=200' then the same line carrying your last id pages it; an
'.order=' survives a window and the window pages inside it, because the cursor
names an ENTITY, never a place. A reply that carries a window says so, and
says the total it is a prefix of. The empty query selects nothing.`
