// What a call just made is near: the `reply` the rules export gives the host
// (./rules.ts), which a direct tool call's answer carries beside the tool's
// own (@yaks/tools `Opts.reply`).
//
// An entity a call created — a task, a memory, a comment — comes back with the
// few existing entities of its kind nearest to it, so whoever wrote it sees at
// once whether the graph already holds it, and keeps the one that stands
// instead of two. A call that created nothing is answered as it was.
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

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import type { Reply } from '@yaks/tools'
import { and, every, limit, near, order, present, text } from '@yaks/query'
import {
  among,
  as,
  col,
  type Derived,
  type Driver,
  each,
  select,
  table,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { type Embedder, hash } from './embedder.ts'
import { type Field, fields, resolved, searched } from './fields.ts'
import { type Options, ready } from './options.ts'
import { excerpt } from './search.ts'
import { put, type Source, sources } from './sweep.ts'
import { SIMILAR } from './compile.ts'

// The ordering @yaks/fts gives a text search: closest match first.
let SEARCH = 'search'

/** How many neighbours each new entity is answered with. */
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
  sql: Driver
  vocab: Vocab
  graph: Graph
  derived?: Derived
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

// One neighbour, as a search answers one (@yaks/cli, @yaks/tools `worded`): a
// `hit` naming its kind, its title and its status where it has them, whether
// meaning or words found it, and `near`, the new entity it was found near. An
// entity with no title is shown by an excerpt of its text instead.
let hit = (
  vocab: Vocab,
  b: Bundle,
  of: Eid,
  source: 'meaning' | 'text',
  prose: Field[],
): Bundle => {
  let title = said(b, 'title')
  let status = said(b, 'status')
  return {
    entity: b.entity,
    hit: {
      kind: vocab.kindOf(b),
      ...title ? { title } : {},
      snippet: title ? '' : excerpt(textOf(b, prose)),
      source,
      near: of,
      ...status ? { status } : {},
    },
  }
}

// The integer ids these eids' rows are keyed by, for the ones this database
// holds: a rehearsed create (`check: true`) holds none.
let owners = (db: Driver, eids: Eid[]): number[] =>
  db.query(select({
    cols: [as(col('id'), 'id')],
    from: table('entity'),
    where: among(col('eid'), each(eids)),
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
  db: Driver,
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
  owed.forEach((s, i) => {
    let v = got[i]
    if (!v) return
    put(db, s.owner, embedder.model, s.text, v)
    have.add(s.entity)
  })
  return have
}

// The words a twin would share: the first line's words (a document's title),
// the short ones left out, since every word must match.
let words = (s: string): string[] =>
  (s.split('\n')[0].match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 8)

/**
 * The reply: for each entity the call's write created (it wears the `created`
 * that write stamped), its nearest few existing entities of the same kind, as
 * `hit` bundles.
 */
export let neighbours = (host: Host, options: Options = {}): Reply => {
  // Words are a query only where the vocabulary indexes words at all.
  let indexed = fields(host.vocab, searched).length > 0
  return async (_call, _answer, wrote) => {
    let fresh = new Set(
      wrote.filter((b) => b.created && !b.tombstone).map((b) => b.entity.eid),
    )
    let born = wrote.filter((b) =>
      fresh.has(b.entity.eid) && host.vocab.kindOf(b) != 'entity'
    )
    if (!born.length) return []
    let now = ready(host.vocab, options)
    let prose = resolved(now.text, host.derived)
    // The first few that have text: a plan's links come back beside its tasks.
    let made = sources(
      host.sql,
      prose,
      owners(host.sql, born.map((b) => b.entity.eid)),
    ).slice(0, MOST)
    if (!made.length) return []
    let meant = now.embedder
      ? await vectored(host.sql, now.embedder, made)
      : new Set<Eid>()
    let kinds = new Map(born.map((b) => [b.entity.eid, host.vocab.kindOf(b)]))
    let out: Bundle[] = []
    for (let s of made) {
      let kind = present(kinds.get(s.entity)!)
      // Room for the other new ones, which are not neighbours yet.
      let room = limit(FEW + fresh.size)
      let terms = words(s.text)
      let asked = meant.has(s.entity)
        ? and(kind, near(s.entity), order(SIMILAR), room, every())
        : indexed && terms.length
        ? and(kind, ...terms.map(text), order(SEARCH), room, every())
        : null
      if (!asked) continue
      let found = (await host.graph.read(asked))
        .filter((b) => !fresh.has(b.entity.eid))
        .slice(0, FEW)
      let source: 'meaning' | 'text' = meant.has(s.entity) ? 'meaning' : 'text'
      out.push(...found.map((b) => hit(host.vocab, b, s.entity, source, prose)))
    }
    return out
  }
}
