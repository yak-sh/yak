// What a listing carries, in one place, because a filter line has one answer:
// the same query asked by the person's agent (tools.ts graph_query), by their
// page (apps.ts `/api/query`) and by the socket that keeps answering it
// (graph.ts `/ws`) is the same question, and the doors answered it differently
// — the tools hid the platform's stamps, the page's door returned them
// (C-32574 item 5), and the live door sent raw batches, so a page's rows
// changed shape the moment they moved (C-32624 item 2). The rule lives here
// and every door reads it.
//
// The rule itself is T-32506's (C-32498 item 10): a listing answers the rows
// a person saved, without the bookkeeping the store keeps about saving them,
// and without a row that is nothing but bookkeeping. Naming a stamp in the
// filter (`.created`, `.created.by=…`) asks for it back — a door never hides
// what was asked for. Anything that is not a row listing (an aggregate, a
// count) passes through as it came.

import { type Clause, clauses, conjoin, parse } from '@yaks/query'
import type { Personal } from '@yaks/member'

// The platform's bookkeeping about a row — who wrote it and when, whether it
// has been served. `archived` is not here: an app's agent reads and writes it
// (it is how an error is marked fixed), so it is the person's business too.
export let STAMPS = ['created', 'updated', 'notified', 'opened', 'quarantined']

// The kernel's own rows about the app, which nobody saved: a break the
// platform wrote down (unseen.ts `noted`) and a failure it expected. They are
// read through `app_errors`, or through their transcript or address, so an
// ordinary listing leaves them out unless the filter names one — the opt-in
// `selected()` asks for the store's blob rows. Asking for the stamps is not
// asking for these: `.created` alone dragged every exception into a person's
// list of their own rows (C-32607 item 4).
export let KERNEL = ['exception', 'error', 'refusal']

// A person is the platform's row too — a store mints one for whoever writes to
// it, so `created.by` has a name to resolve (graph.ts `#vouching`) — but only in an
// app's store: the directory's own graph is made of people, and the agent tier
// reads that through the same listing. So a person is screened out of the
// question, which only a page's doors ask, and never out of an answer.
//
// And the models a store may ask (models.ts `catalogued`) and the commands it
// answers (graph.ts `#planting`: the app's manifest, and the platform's own
// `builder_model`): planted in every app's store by the platform, and saved by
// nobody. So is who may reach the app (`access`, `grant`): the store keeps it
// for its own door to read, and app_set and grant are where it is said.
//
// So are the store's metadata: its lens steps (`_lens`) and the rows that
// describe its vocabulary (@yaks/vocab's bundles.ts), each wearing its own
// word and `doc`, and a `_before` its `edge`.
export let DESCRIBED = [
  '_package',
  '_comp',
  '_effect',
  '_prop',
  '_extends',
  '_before',
  '_vocab',
]
export let PLATFORM = [
  ...KERNEL,
  'person',
  'provider',
  'model',
  'serves',
  'tool',
  'access',
  'grant',
  '_lens',
  ...DESCRIBED,
]

// How a store keeps its rows rather than any row it keeps: which component
// tables each entity spans (@yaks/archetype) and the effects pool's queue
// (@yaks/effects). Every store keeps them, the platform's own two included, and
// a line naming no component read them before anything a person saved.
export let STORAGE = ['archetype', 'retired', 'effect', 'lease', 'provisional']

/** The words a listing in one store leaves out of its question (`asking`), of
 * those it `has`: its storage everywhere, and the platform's rows in an app's
 * store. The platform's own two stores are made of those rows, so only their
 * description pages (`_comp`, …) go there. */
export let screened = (has: (word: string) => boolean, own: boolean) =>
  [...STORAGE, ...PLATFORM.filter((w) => !own || w.startsWith('_'))]
    .filter(has)

export type Row = Record<string, unknown>

/** The paths a line's `.fields` projection names, each a list of segments, or
 * none when it projects nothing. */
export let projects = (line: string): string[][] =>
  clauses(parse(line.replace(/^[?&]+/, '')))
    .find((c) => c.kind == 'fields')?.fields.map((f) => f.path) ?? []

/** Whether a filter line names a component, in any of the three ways a clause
 * can: present (`.created`), absent (`!created`) or wanted (`?created`), or on
 * a path its projection reads (`.fields=created.at`). */
export let names = (line: string, word: string) =>
  ['.', '!', '?'].some((mark) => line.includes(mark + word)) ||
  projects(line).some((path) => path.includes(word))

// The same rule, asked instead of answered: the platform's own rows left out
// of the question. A listing can only screen an answer's rows, so a `.count`
// over one filter still counted what the list beside it did not show — a
// person row wears a `doc` title now, so it matches `.doc` (T-32627).
// Screening the ask is what makes an aggregate, a search and a list agree, and
// every door that serves a page asks this way. Naming one asks for it back,
// and an address asks for its row whatever kind of row it is.
// `words` names which of them to screen for, because a store refuses a filter
// naming a component it never planted — screening for a word this store has no
// table for would refuse the whole read rather than narrow it. A caller that
// knows the store's vocabulary passes the ones it declares; the default is
// every platform word.
// The screen narrows the whole ask, so `.a|.b` leaves the platform's rows out
// of both alternatives (@yaks/query `conjoin`).
// An explicitly requested person-owned aspect is app data on that person's
// row. The store supplies its composed Personal declarations so this screen
// retains the row; the graph's ownership policy still governs the aspect.
export let asking = (
  line: string,
  words: string[] = PLATFORM,
  personal: Personal = {},
) => {
  let ask = line.replace(/^[?&]+/, '')
  if (!ask || line.includes('id=')) return line
  let aspect = Object.entries(personal).some(([name, owner]) =>
    owner == 'entity' && names(line, name)
  )
  // A row of storage holds nothing but its own storage component, so a line
  // that asks for some other component never reaches one: probing each costs
  // a lookup per candidate row for nothing.
  let clause = parse(ask)
  let spared = holds(clause) ? [...STORAGE] : []
  // The store's metadata is immutable, never an aspect on an app's saved row,
  // so a line holding a component none of it wears never reaches it. A
  // stamp-only question can still reach a lens step, and a `doc` or `edge`
  // one a description row, so those retain the screen.
  let platform = [...STORAGE, ...STAMPS, ...PLATFORM]
  if (holds(clause, platform)) spared.push('_lens')
  if (holds(clause, [...platform, 'doc', 'edge'])) spared.push(...DESCRIBED)
  let screen = words.filter((k) =>
    !spared.includes(k) && !names(line, k) &&
    !(k == 'person' && aspect) &&
    !(k == 'refusal' && names(line, 'entry'))
  ).map((k) => `!${k}`)
  return line.slice(0, line.length - ask.length) + conjoin(ask, ...screen)
}

// Whether every row a clause matches holds some component: a present test
// (`.a`, `.a=1`) does; an absent one (`!a`), an optional one (`?a`), a negated
// one and a bare word do not; and an `or` holds one only if each alternative
// does.
let holds = (c: Clause, ignore: string[] = []): boolean =>
  c.kind == 'pred'
    ? !ignore.includes(c.path[0]) && c.op != '?' && c.op != '!=' && !c.not &&
      !(c.op == '=' && c.value?.kind == 'scalar' && c.value.raw == '')
    : c.kind == 'and'
    ? c.clauses.some((c) => holds(c, ignore))
    : c.kind == 'or'
    ? c.clauses.every((c) => holds(c, ignore))
    : false

// The rule itself, over rows: what this filter line's answer carries. A
// projection's row is narrowed on purpose, so one carrying nothing but its
// name is still an answer: an entity whose named properties it lacks.
export let listed = (rows: Row[], asked: string): Row[] => {
  let hidden = STAMPS.filter((s) => !names(asked, s))
  let narrowed = projects(asked).length > 0
  let out: Row[] = []
  for (let row of rows) {
    let kernel = KERNEL.filter((k) => k in row)
    if (
      kernel.length && !kernel.some((k) => names(asked, k)) &&
      !asked.includes('id=') &&
      !(row.entry && names(asked, 'entry') &&
        kernel.every((k) => k == 'refusal'))
    ) continue
    let kept = Object.fromEntries(
      Object.entries(row).filter(([k]) => !hidden.includes(k)),
    )
    // `entity` and `kind` name a row; one with nothing else left was a stamp.
    if (
      narrowed || Object.keys(kept).some((k) => k != 'entity' && k != 'kind')
    ) {
      out.push(kept)
    }
  }
  return out
}

// Outputs speak human (db.ts `human()`) at an app's store too: a property that
// references a person answers `{eid, name}` when this store knows the person,
// and the bare eid when it does not. A view gets one query, and a byline it
// would need a second question for is no byline: the inline leaderboard drew
// "someone" on every row while `created.by` was a uuid (C-32730 item 5). Writes
// are unmoved — the value is the eid, and a read shape handed back is lowered
// to it (db.ts `admitted`).
//
// The query door answers rows painted this way. A socket answers the rows as
// the store keeps them, with `Names` beside them, because a page that keeps a
// copy of its store (@yaks/client) lands each row in the store's own words,
// where `created.by` is an eid; the served client paints the frame's rows with
// the same rule (public/client.js `named`), so its `subscribe()` still answers
// what `query()` does.
//
// Which properties reference is the caller's word (the vocabulary), and so is
// who among the eids is a person (the store's rows): only the caller holds a
// store to ask with (graph.ts).
export type Ref = (comp: string, prop: string) => boolean

/** Who a list of rows points at, as the store says it beside them: the
 * referencing properties the rows hold an eid in (`created.by`), and what the
 * store calls each person among those eids. */
export type Names = { refs: string[]; names: Record<string, string> }

let props = (comp: unknown): comp is Row =>
  !!comp && typeof comp == 'object' && !Array.isArray(comp)

// Every place the rows hold an eid in a referencing property.
let places = function* (rows: Row[], ref: Ref) {
  for (let row of rows) {
    for (let [comp, held] of Object.entries(row)) {
      if (!props(held)) continue
      for (let [prop, v] of Object.entries(held)) {
        if (typeof v == 'string' && ref(comp, prop)) yield { comp, prop, v }
      }
    }
  }
}

/** The eids the rows point at, and the properties that hold them. */
export let mentions = (rows: Row[], ref: Ref) => {
  let eids = new Set<string>()
  let refs = new Set<string>()
  for (let { comp, prop, v } of places(rows, ref)) {
    eids.add(v)
    refs.add(`${comp}.${prop}`)
  }
  return { eids: [...eids], refs: [...refs] }
}

/** The rows, each reference to someone the store named painted `{eid,
 * name}`. Nobody to name is the rows themselves. */
export let named = (rows: Row[], { refs, names }: Names): Row[] => {
  if (!Object.keys(names).length) return rows
  let at = new Set(refs)
  let name = (held: Row, comp: string) =>
    Object.fromEntries(
      Object.entries(held).map(([prop, v]) =>
        typeof v == 'string' && Object.hasOwn(names, v) &&
          at.has(`${comp}.${prop}`)
          ? [prop, { eid: v, name: names[v] }]
          : [prop, v]
      ),
    )
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .map(([comp, held]) => [comp, props(held) ? name(held, comp) : held]),
    )
  )
}

// The same rule over a door's JSON body — what the kernel hands a page back
// from the store's own answer.
export let listing = (body: string, asked: string) => {
  let rows: unknown
  try {
    rows = JSON.parse(body)
  } catch {
    return body
  }
  if (!Array.isArray(rows)) return body
  return JSON.stringify(listed(rows as Row[], asked))
}
