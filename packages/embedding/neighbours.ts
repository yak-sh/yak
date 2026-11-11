// What a call just made is near: the `reply` the rules export gives the host
// (./graph.ts), which a direct tool call's answer carries beside the tool's
// own (@yaks/tools `Opts.reply`).
//
// An entity a call made — a task, a memory, a comment — comes back with two
// short lists. The first is the few existing entities of its kind nearest to
// it (`hit.near`), so whoever wrote it sees at once whether the graph already
// holds it, and keeps the one that stands instead of two. The second is the
// few nearest of any kind that is a resource (`hit.related`): the memories,
// tasks, designs and topics it bears on, and the words a person wrote. A
// one-off record (wearing a component the vocabulary marks `notice`: a knock,
// a transcript entry) is in neither list unless a person wrote it, even where
// it also wears the kind: a run's receipt is a comment and a knock at once.
// Nor is anything the calling session wrote itself, which it already holds:
// a helper commenting twice is not told of its first comment. A comment is
// shown with the id of what it is on (`hit.target`), since a comment's words
// alone do not say which task they are about. A call that made nothing is
// answered as it was.
//
// Made means created, or marked as a kind for the first time: memory_save
// keeps a person's words where they were said, by marking the transcript entry
// or comment that holds them a `memory`, and that memory is as new as a
// created one.
//
// A new entity has no vector yet: the sweep (./sweep.ts) makes them off the
// write path, seconds later. So this makes the vector now, for the few
// entities a caller is waiting on, and stores it as the sweep would, which
// then finds it made and calls no model. The neighbours are then a query,
// `.near` among entities of the same kind, answered like any other. A model
// that does not answer within WAIT, or a config naming none yet, leaves the
// entity with no vector, and the fallback is its first line as words
// (`.order=search`): a twin that says the same thing in the same words.
//
// Nothing here fails a write. The write committed before a reply is asked
// for, and a model out of reach only means fewer neighbours.

import { type Bundle, type Comp, type Eid, type Graph, who } from '@yaks/graph'

import { called } from '@yaks/graph/hit'
import type { Reply } from '@yaks/tools'
import {
  absent,
  and,
  type Clause,
  every,
  limit,
  ne,
  near,
  or,
  order,
  present,
  text,
} from '@yaks/query'
import {
  as,
  col,
  type Derived,
  oneOf,
  select,
  type Statements,
  statements,
  table,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { type Embedder, hash } from './embedder.ts'
import { type Field, fields, resolved, searched } from './fields.ts'
import { type Lent, type Options, ready } from './options.ts'
import { excerpt } from './search.ts'
import { put, type Source, sources } from './sweep.ts'
import { SIMILAR } from './compile.ts'

// The ordering @yaks/fts gives a text search: closest match first.
let SEARCH = 'search'

/** How many neighbours of each list a new entity is answered with. */
export let FEW = 3

/** How many of one call's new entities are looked at: a plan of twenty
 * tasks is answered about its first few, not with sixty lines. */
export let MOST = 5

/** How long an answer waits for the model, in milliseconds, before it falls
 * back to words. */
export let WAIT = 1000

/** What a reply reads: the graph, its vocabulary, and the database the
 * vectors are kept in. */
export type Host = {
  storage: { statements?: Statements }
  vocab: Vocab
  graph: Graph
  derived?: Derived
  /** the embedders lent by name (@yaks/host `embedders`) */
  embedders?: Lent
}

let comps = (b: Bundle): Comp[] =>
  Object.entries(b).flatMap(([k, v]) =>
    k != 'entity' && v && typeof v == 'object' ? [v as Comp] : []
  )

// The first string a bundle's components hold under `name`: a task's
// `doc.title`, its computed `task.status`.
let said = (b: Bundle, name: string): string | undefined =>
  comps(b).map((c) => c[name]).find((v): v is string => typeof v == 'string')

// An entity's text, read off its bundle the way ./fields.ts reads it off the
// tables: each embedded field in order, joined.
let textOf = (b: Bundle, prose: Field[]): string =>
  prose.map((f) => (b[f.comp] as Comp | undefined)?.[f.prop])
    .filter((v): v is string => typeof v == 'string' && !!v.trim())
    .join('\n')

// Which list a neighbour is in: `near`, a possible twin of the same kind, or
// `related`, a resource of any kind.
type List = 'near' | 'related'

// One neighbour, as a search answers one (@yaks/cli, @yaks/tools `worded`): a
// `hit` naming the id it is called by (@yaks/graph/hit `called`), its kind,
// its title and its status where it has them, the id of what a comment is on,
// whether meaning or words found it, and, under its list's name, the new
// entity it was found near. An entity with no title is shown by an excerpt of
// its text instead.
let hit = (
  vocab: Vocab,
  b: Bundle,
  of: Eid,
  list: List,
  source: 'meaning' | 'text',
  prose: Field[],
  on?: string,
): Bundle => {
  let title = said(b, 'title')
  let status = said(b, 'status')
  return {
    entity: b.entity,
    hit: {
      id: called(vocab)(b),
      kind: vocab.kindOf(b),
      ...title ? { title } : {},
      ...on ? { target: on } : {},
      snippet: title ? '' : excerpt(textOf(b, prose)),
      source,
      [list]: of,
      ...status ? { status } : {},
    },
  }
}

// The ids the comments among these are on, by the comment's eid, each as a
// line names it (its human id where it has one).
let targets = async (
  host: Host,
  found: Bundle[],
): Promise<Map<Eid, string>> => {
  let on = new Map<Eid, Eid>()
  for (let b of found) {
    let target = (b.comment as Comp | undefined)?.target
    if (typeof target == 'string') on.set(b.entity.eid, target)
  }
  if (!on.size) return new Map()
  let rows = await host.graph.get([...new Set(on.values())], host.vocab.kinds)
  let name = called(host.vocab)
  let named = new Map(rows.map((r) => [r.entity.eid, name(r)]))
  return new Map([...on].map(([c, t]) => [c, named.get(t) ?? t]))
}

// The integer ids these eids' rows are keyed by, for the ones this database
// holds: a rehearsed create (`check: true`) holds none.
let owners = (db: Statements, eids: Eid[]): number[] =>
  db.query(select({
    cols: [as(col('id'), 'id')],
    from: table('entity'),
    where: oneOf(col('eid'), eids),
  })).map((r) => Number(r.id))

// A promise's value, or undefined once WAIT passes or it fails: an answer
// waits this long for a model and never longer.
let within = <T>(p: Promise<T>): Promise<T | undefined> =>
  new Promise((done) => {
    let t = setTimeout(() => done(undefined), WAIT)
    p.then(
      (v) => (clearTimeout(t), done(v)),
      () => (clearTimeout(t), done(undefined)),
    )
  })

// The sources that have a vector for their text: the ones the sweep already
// made, and the rest made now and stored as the sweep stores them, where the
// model answers in time.
let vectored = async (
  db: Statements,
  embedder: Embedder,
  made: Source[],
): Promise<Set<Eid>> => {
  let owed = made.filter((s) => s.had != hash(embedder.model, s.text))
  let got = await Promise.all(
    owed.map((s) =>
      within(Promise.resolve().then(() => embedder.embed(s.text)))
    ),
  )
  let have = new Set(made.filter((s) => !owed.includes(s)).map((s) => s.entity))
  await db.atomic(() => {
    owed.forEach((s, i) => {
      let v = got[i]
      if (v && put(db, s, embedder.model, v)) have.add(s.entity)
    })
  })
  return have
}

// The words a twin would share: the first line's words (a document's title),
// the short ones left out, since every word must match.
let words = (s: string): string[] =>
  (s.split('\n')[0].match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 8)

// The kind a written bundle made its entity, if it made one: a created
// entity's kind, or a kind that is a mark (@yaks/vocab `CompInfo.mark`) whose
// `at` this write stamped, so marked for the first time.
let became = (vocab: Vocab, b: Bundle): string | undefined => {
  if (b.tombstone) return undefined
  if (b.created) return vocab.kindOf(b)
  return Object.keys(b).find((c) => {
    let info = vocab.comp(c)
    return info?.kind && info.mark && (b[c] as Comp | undefined)?.at
  })
}

/** What a neighbour in either list is: wearing no notice, or written by a
 * person, where the vocabulary knows people. */
export let resources = (vocab: Vocab): Clause[] => {
  let notices = vocab.all.filter((c) => vocab.comp(c)?.notice)
  if (!notices.length) return []
  let none = and(...notices.map(absent))
  return [vocab.comp('person') ? or(none, present('created.by.person')) : none]
}

/**
 * The reply: for each entity the call's write made, its nearest few existing
 * entities of the same kind, then its nearest few resources of any kind, as
 * `hit` bundles.
 */
export let neighbours = (host: Host, options: Options = {}): Reply => {
  let db = statements(host.storage)
  // Words are a query only where the vocabulary indexes words at all.
  let indexed = fields(host.vocab, searched).length > 0
  let kept = resources(host.vocab)
  return async (call, _answer, wrote) => {
    let kinds = new Map<Eid, string>()
    for (let b of wrote) {
      let kind = became(host.vocab, b)
      if (kind) kinds.set(b.entity.eid, kind)
    }
    let fresh = new Set(kinds.keys())
    let born = [...kinds].filter(([, k]) => k != 'entity').map(([e]) => e)
    if (!born.length) return []
    let now = await ready(host.vocab, options, host.graph, host.embedders)
    let prose = resolved(now.text, host.derived)
    // The first few that have text: a plan's links come back beside its tasks.
    let made = sources(
      db,
      prose,
      owners(db, born),
    ).slice(0, MOST)
    if (!made.length) return []
    let meant = now.embedder
      ? await vectored(db, now.embedder, made)
      : new Set<Eid>()
    // What the calling session wrote is its own, and no news to it. `!=`
    // holds where `created.via` is absent too (@yaks/sql `ne`), and spelling
    // that out as an OR made the screen a union over every `created` row:
    // over two minutes on the box's graph.
    let via = who(call)?.via
    let others = via ? [ne('created.via', via)] : []
    let out: Bundle[] = []
    for (let s of made) {
      let meaning = meant.has(s.entity)
      let terms = words(s.text)
      if (!meaning && !(indexed && terms.length)) continue
      let source: 'meaning' | 'text' = meaning ? 'meaning' : 'text'
      let shown = new Set(fresh)
      // The nearest few matching `by`, past the ones already shown: room for
      // them, which are not neighbours yet.
      let nearest = async (list: List, by: Clause[]) => {
        let room = limit(FEW + shown.size)
        let ranked = meaning
          ? [near(s.entity), order(SIMILAR)]
          : [...terms.map(text), order(SEARCH)]
        let found = (await host.graph.read(
          and(...by, ...kept, ...others, ...ranked, room, every()),
        ))
          .filter((b) => !shown.has(b.entity.eid))
          .slice(0, FEW)
        found.forEach((b) => shown.add(b.entity.eid))
        let on = await targets(host, found)
        out.push(
          ...found.map((b) =>
            hit(
              host.vocab,
              b,
              s.entity,
              list,
              source,
              prose,
              on.get(b.entity.eid),
            )
          ),
        )
      }
      await nearest('near', [present(kinds.get(s.entity)!)])
      await nearest('related', [])
    }
    return out
  }
}
