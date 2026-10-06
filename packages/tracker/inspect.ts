/** A bug's page and an error's, as the inspector draws them: what broke, how
 * often and since when, where it ran, and the newest occurrence to read next.
 * Long things are summed up (counts with the few most shared, short commits,
 * a message's headline) and open whole on a press, in the page's graph.
 * Queries belong here; traces are drawn through the registry, never through
 * a timing import.
 * @module
 */
import { type ComponentChildren, h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import {
  type Bundle,
  type Io,
  mention,
  type Props,
  useNamed,
  type View,
} from '@yaks/inspect'
import {
  Dot,
  Head,
  Pairs,
  Rows,
  Section,
  Table,
  Timeline,
  Value,
} from '@yaks/ui'
import { Disclosure, disclosureAt, isOpen } from '@yaks/ux'
import { comp, type Crumb, type Frame, str } from './model.ts'
import { count, headline, place, sha, thrown } from './brief.ts'
import { spread, tags, type Tally } from './spread.ts'
import { Histogram } from './Histogram.ts'
import {
  frameAt,
  occurrences,
  pip,
  relatedTraces,
  said,
  standing,
  where,
} from './reading.ts'

/** How many of a list show before the rest is asked for. */
let FEW = 3
/** How many occurrences a bug's page lists before the rest. */
let ROWS = 8

let REFS = ['process', 'entity', 'app', 'space', 'request']

/** Content a press opens, its state kept in the page's graph under `at`. */
let More = (
  { io, at, summary, children }: {
    io: Io
    at: string
    summary: ComponentChildren
    children?: ComponentChildren
  },
): JSX.Element => {
  let eid = disclosureAt(at), e = io.state(eid) ?? { entity: { eid } }
  return h(Disclosure, {
    e,
    onChange: (b: Bundle) => io.set([b]),
    summary: [isOpen(e) ? '▾ ' : '▸ ', summary],
    summaryProps: { mod: 'quiet' },
  }, children)
}

let at = (io: Io, moment: string) =>
  h('time', { datetime: moment, title: moment }, io.when(moment))

// One shared value: a reference named, a commit short, a tag as written.
let value = (io: Io, name: string, v: string): ComponentChildren =>
  REFS.includes(name)
    ? mention(io, v)
    : name == 'commit'
    ? h(Value, { mod: 'id', title: v }, sha(v))
    : v

let times = (n: number) => h(Value, { mod: 'id' }, ` ×${n}`)

/** The few values most occurrences share, and the rest on a press. */
let Shared = (
  { io, name, tallies, owner }: {
    io: Io
    name: string
    tallies: Tally[]
    owner: string
  },
): JSX.Element => {
  let each = (t: Tally, i: number) => [
    i ? ' · ' : '',
    value(io, name, t.value),
    tallies.length > 1 || t.n > 1 ? times(t.n) : null,
  ]
  // Values each seen once say only how many there were; they list on a press.
  let scattered = tallies.length > FEW && tallies.every((t) => t.n == 1)
  let few = scattered ? [] : tallies.slice(0, FEW)
  let rest = tallies.slice(few.length)
  useNamed(io, REFS.includes(name) ? few.map((t) => t.value) : [])
  return h(
    'span',
    {},
    scattered ? `${tallies.length} different` : few.map(each),
    rest.length
      ? h(
        More,
        {
          io,
          at: `${owner}|${name}`,
          summary: scattered ? 'list them' : `${rest.length} more`,
        },
        h(Named, {
          io,
          eids: REFS.includes(name) ? rest.map((t) => t.value) : [],
        }),
        rest.map(each),
      )
      : null,
  )
}

/** Names the entities a press opened, while they show. */
let Named = ({ io, eids }: { io: Io; eids: string[] }) => {
  useNamed(io, eids)
  return null
}

/** What a bug's occurrences ran in, a row for each thing they recorded. */
let Ran = (
  { io, errors, owner }: { io: Io; errors: Bundle[]; owner: string },
): JSX.Element =>
  h(
    Pairs,
    {},
    spread(errors).map(({ name, tallies }) => [
      h(Pairs.Key, { key: `${name}-key` }, name),
      h(
        Pairs.Value,
        { key: name },
        h(Shared, { io, name, tallies, owner }),
      ),
    ]),
    first(errors)
      ? [
        h(Pairs.Key, {}, 'first seen in'),
        h(Pairs.Value, {}, value(io, 'commit', first(errors)!)),
      ]
      : null,
  )

// The commit the earliest kept occurrence ran: retention keeps the first of
// each commit, so this is the first commit the bug was seen in.
let first = (errors: Bundle[]): string | undefined =>
  str(comp(errors.at(-1), 'error').commit) || undefined

/** A stack, top first: what ran and where, the project's own frames marked. */
let Stack = (
  { io, frames, owner }: { io: Io; frames: Frame[]; owner: string },
): JSX.Element => {
  let row = (f: Frame, i: number) =>
    h(
      Table.Row,
      { key: i },
      h(
        Table.Cell,
        {},
        f.app ? h(Dot, { mod: 'accent', title: 'in the project' }) : null,
      ),
      h(
        Table.Cell,
        {},
        f.app
          ? f.function || 'anonymous'
          : h(Value, { mod: 'id' }, f.function || 'anonymous'),
      ),
      h(
        Table.Cell,
        { title: f.file },
        h(
          Value,
          { mod: f.app ? undefined : 'id' },
          place(f.file) + [f.line, f.column].filter((n) => n != null)
            .map((n) => `:${n}`).join(''),
        ),
      ),
    )
  let shown = frames.length > 14 ? frames.slice(0, 10) : frames
  let rest = frames.slice(shown.length)
  return h(
    'div',
    {},
    h(
      Table,
      { cols: ['num', null, null] },
      h(Table.Body, {}, shown.map(row)),
    ),
    rest.length
      ? h(
        More,
        {
          io,
          at: `${owner}|frames`,
          summary: `${rest.length} more frames`,
        },
        h(
          Table,
          { cols: ['num', null, null] },
          h(Table.Body, {}, rest.map((f, i) => row(f, i + shown.length))),
        ),
      )
      : null,
  )
}

let framesOf = (e: Bundle) => (comp(e, 'exception').frames ?? []) as Frame[]

/** A message's headline as the title, its thrown type beside it, and the
 * whole message on a press when the headline left some out. */
let Message = (
  { io, e, sub, facts }: {
    io: Io
    e: Bundle
    sub: ComponentChildren
    facts: ComponentChildren[]
  },
): JSX.Element => {
  let whole = said(e), { type, message } = thrown(headline(whole))
  return h(
    Head,
    {},
    h(
      Head.Title,
      {},
      message,
      h(Head.Id, {}, io.id(e)),
      type ? h(Head.Kind, {}, type) : null,
    ),
    sub ? h(Head.Sub, {}, sub) : null,
    h(
      Head.Facts,
      {},
      facts.filter(Boolean).map((f, i) => h('span', { key: i }, f)),
    ),
    whole != headline(whole)
      ? h(
        More,
        { io, at: `${e.entity.eid}|message`, summary: 'whole message' },
        h(Value, { mod: 'text' }, whole),
      )
      : null,
  )
}

/** Occurrences as rows, their references named while they show. */
let Listed = ({ io, rows }: { io: Io; rows: Bundle[] }): JSX.Element => {
  useNamed(
    io,
    rows.flatMap((b) => REFS.map((k) => str(comp(b, 'during')[k]))),
  )
  return h(
    Rows,
    {},
    rows.map((b) =>
      h(Rows.Item, { key: b.entity.eid }, io.show(b, 'Bug.List.Tile'))
    ),
  )
}

/** The occurrences a bug kept, newest first, the rest on a press. */
let Occurrences = (
  { io, errors, owner }: { io: Io; errors: Bundle[]; owner: string },
): JSX.Element => {
  let rest = errors.slice(ROWS)
  return h(
    'div',
    {},
    h(Listed, { io, rows: errors.slice(0, ROWS) }),
    rest.length
      ? h(
        More,
        { io, at: `${owner}|occurrences`, summary: `${rest.length} more` },
        h(Listed, { io, rows: rest }),
      )
      : null,
  )
}

let BugPage = ({ e, io, got }: Props): JSX.Element => {
  let bug = comp(e, 'bug'), owner = e.entity.eid
  let errors = [...got.errors?.rows ?? []].sort((a, b) =>
    str(comp(b, 'error').at).localeCompare(str(comp(a, 'error').at))
  )
  let newest = errors[0]
  let hits = Number(bug.hits ?? 0)
  let first = Date.parse(str(bug.first) || str(comp(errors.at(-1), 'error').at))
  let ats = errors.map((b) => str(comp(b, 'error').at))
  return h(
    'article',
    { 'data-bug': owner },
    h(Message, {
      io,
      e,
      sub: where(e, newest),
      facts: [
        [h(Dot, { mod: pip(e) }), ' ', standing(e)],
        count(hits, 'hit'),
        bug.people != null ? count(Number(bug.people), 'actor') : null,
        bug.last ? ['last ', at(io, str(bug.last))] : null,
        bug.first ? ['since ', at(io, str(bug.first))] : null,
      ],
    }),
    h(
      Section,
      {},
      h(
        Section.Title,
        {},
        'When',
        h(
          Section.Count,
          {},
          errors.length < hits
            ? `${errors.length} kept of ${hits.toLocaleString('en-US')}`
            : count(errors.length, 'occurrence'),
        ),
      ),
      errors.length && Number.isFinite(first)
        ? h(Histogram, { ats, from: first, to: Date.now() })
        : null,
      errors.length < hits
        ? h(
          Section.Sub,
          {},
          'The tracker keeps the newest hundred occurrences and the first of each commit; the hits count all of them.',
        )
        : null,
    ),
    errors.length
      ? h(
        Section,
        {},
        h(Section.Title, {}, 'Where it ran'),
        h(Ran, { io, errors, owner }),
      )
      : null,
    newest
      ? h(
        Section,
        {},
        h(
          Section.Title,
          {},
          'Newest occurrence',
          h(Section.Note, {}, at(io, str(comp(newest, 'error').at))),
          h(
            Section.Note,
            {},
            h('a', { href: io.link(newest.entity.eid) }, io.id(newest)),
          ),
        ),
        headline(said(newest)) != headline(said(e))
          ? h(Section.Sub, {}, headline(said(newest)))
          : null,
        framesOf(newest).length
          ? h(Stack, { io, frames: framesOf(newest), owner: newest.entity.eid })
          : h(Section.Sub, {}, 'No stack was recorded.'),
      )
      : null,
    h(
      Section,
      {},
      h(
        Section.Title,
        {},
        'Occurrences',
        h(Section.Count, {}, errors.length),
      ),
      !got.errors?.ready
        ? h(Section.Sub, { role: 'status' }, 'Reading occurrences…')
        : errors.length
        ? h(Occurrences, { io, errors, owner })
        : h(Section.Sub, {}, 'No occurrence is kept.'),
    ),
    bug.fault
      ? h(
        More,
        { io, at: `${owner}|fault`, summary: 'Grouping key' },
        h(Value, { mod: 'id' }, str(bug.fault)),
      )
      : null,
  )
}

let Traces = (
  { io, related, got }: {
    io: Io
    related: { label: string }
    got: Props['got']
  },
): JSX.Element =>
  h(
    Section,
    {},
    h(Section.Title, {}, 'Traces', h(Section.Note, {}, related.label)),
    got.traces?.error
      ? h(
        Section.Sub,
        { role: 'alert' },
        `Traces unavailable: ${got.traces.error}`,
      )
      : !got.traces?.ready
      ? h(Section.Sub, { role: 'status' }, 'Reading traces…')
      : got.traces.rows.length
      ? h('div', {}, got.traces.rows.map((b) => io.show(b, 'List.Tile')))
      : h(Section.Sub, {}, 'No recorded trace matches this occurrence.'),
  )

// The bug an occurrence belongs to, by its id: its message is already the
// page's title.
let bugOf = (io: Io, eid: string): ComponentChildren => {
  let b = io.get(eid)
  return b
    ? h('a', { href: io.link(eid), title: said(b) }, io.id(b))
    : mention(io, eid)
}

let ErrorPage = ({ e, io, got }: Props): JSX.Element => {
  let error = comp(e, 'error'), d = comp(e, 'during'), owner = e.entity.eid
  let related = io.vocab.all.includes('trace') ? relatedTraces(e) : undefined
  let frames = framesOf(e)
  let crumbs = (comp(e, 'breadcrumbs').items ?? []) as Crumb[]
  let top = frames.find((f) => f.app) ?? frames[0]
  useNamed(io, [...REFS.map((k) => str(d[k])), str(error.bug)])
  let context = [
    ...tags(e).map(([k, v]) => [k, v] as [string, ComponentChildren]),
    ...REFS.filter((k) => d[k]).map((k) =>
      [k, mention(io, str(d[k]))] as [string, ComponentChildren]
    ),
    ...d.kind ? [['kind', str(d.kind)] as [string, ComponentChildren]] : [],
    ...comp(e, 'exception').mechanism
      ? [
        ['caught by', str(comp(e, 'exception').mechanism)] as [
          string,
          ComponentChildren,
        ],
      ]
      : [],
  ]
  return h(
    'article',
    { 'data-error': owner },
    h(Message, {
      io,
      e,
      sub: error.bug ? ['one occurrence of ', bugOf(io, str(error.bug))] : null,
      facts: [
        error.at ? at(io, str(error.at)) : null,
        str(error.level),
        str(error.environment),
        error.commit
          ? h(
            Value,
            { mod: 'id', title: str(error.commit) },
            sha(str(error.commit)),
          )
          : null,
        error.version != null ? `version ${error.version}` : null,
      ],
    }),
    h(
      Section,
      {},
      h(Section.Title, {}, 'Where'),
      h(
        Pairs,
        {},
        top ? [h(Pairs.Key, {}, 'at'), h(Pairs.Value, {}, frameAt(top))] : null,
        context.map(([k, v]) => [
          h(Pairs.Key, { key: `${k}-key` }, k),
          h(Pairs.Value, { key: k }, v),
        ]),
      ),
    ),
    h(
      Section,
      {},
      h(Section.Title, {}, 'Stack', h(Section.Count, {}, frames.length)),
      frames.length
        ? h(Stack, { io, frames, owner })
        : h(Section.Sub, {}, 'No stack was recorded.'),
      comp(e, 'exception').stack
        ? h(
          More,
          { io, at: `${owner}|stack`, summary: 'Stack as thrown' },
          h('pre', {}, h('code', {}, str(comp(e, 'exception').stack))),
        )
        : null,
    ),
    crumbs.length
      ? h(
        Section,
        {},
        h(Section.Title, {}, 'Before it', h(Section.Count, {}, crumbs.length)),
        h(
          Timeline,
          {},
          crumbs.map((c, i) =>
            h(
              Timeline.Item,
              { key: i },
              h(Timeline.When, {}, at(io, c.at)),
              h(Timeline.Who, {}, c.category),
              h(Timeline.What, {}, headline(c.message)),
            )
          ),
        ),
      )
      : null,
    related ? h(Traces, { io, related, got }) : null,
  )
}

/** The pages this package draws in the inspector. */
export let inspectViews: View[] = [
  {
    view: 'Full',
    match: parse('.bug'),
    asks: (e) => ({ errors: occurrences(e.entity.eid) }),
    Render: BugPage,
  },
  {
    view: 'Full',
    match: parse('.error'),
    asks: (e, io): Record<string, string> => {
      let related = io.vocab.all.includes('trace') && relatedTraces(e)
      return related ? { traces: related.query } : {}
    },
    Render: ErrorPage,
  },
]
