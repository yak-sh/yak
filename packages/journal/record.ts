// The writing half: a plugin that turns each committed batch into rows.
//
// It hooks two phases of `apply()`. At `precondition` it READS — the whole of
// every entity the batch is about to touch, plus everything the batch is about
// to kill (@yaks/graph's own `doomed()` walk, so the death rule is asked and
// never re-implemented) — and rides that reading forward on the batch under
// `$prior`. A `$`-key is not a component, so no storage adapter ever sees it;
// it is how one phase of a write tells a later one what it learned. At
// `journal`, inside the same transaction, it replays the batch AS APPLIED
// against that reading and writes down what moved.
//
// Replaying rather than logging the patch is what makes history readable: the
// same bundle creates a component that was absent and patches one that was
// there, a cascade's casualty rides back as a bare tombstone with none of the
// components it used to carry, and a batch that patches the same entity twice
// is two facts, not one. The replay knows which is which because it carries
// the state forward as it walks.
//
// One reading per batch: if the batch already carries `$prior` — a second
// journal, or a plugin that read first — this one reuses it. @yaks/effects
// takes a lighter reading of its own under `$before` (component names, no
// values), which a journal cannot use and does not disturb.

import type { Ask, Bundle, Comp, Eid, Plugin, Tx } from '@yaks/graph'
import { actorOf, comps, dead, doomed, then, TOMBSTONE } from '@yaks/graph'
import { and, gt, limit, order } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { BATCH, DELTA, journalDoc } from './vocab.ts'
import { enc } from './value.ts'

/** What each entity in a batch carried before it — the whole bundle, by eid. */
export type Prior = Record<Eid, Bundle>

/** The key that reading rides forward on. Not a component: `$`-prefixed keys
 * are `apply()`'s pipeline, never columns, so storage never sees it. */
export let PRIOR = '$prior'

/**
 * Read what the batch's entities — and everything that will die with them —
 * carry right now, and ride it forward under {@link PRIOR}. Registered on the
 * `precondition` phase, so it reads inside the transaction and before a single
 * patch has gone in. A batch that already carries a reading keeps it.
 */
export let capture = (vocab: Vocab) =>
(
  bundles: Bundle[],
  tx: Tx,
): Bundle[] | Promise<Bundle[]> => {
  if (bundles.some((b) => b[PRIOR])) return bundles
  let killed = [...new Set(bundles.filter(dead).map((b) => b.entity.eid))]
  return then(killed.length ? doomed(tx, vocab, killed) : [], (gone) =>
    then(
      tx.get([...new Set([...bundles.map((b) => b.entity.eid), ...gone])]),
      (found) => {
        let prior: Prior = {}
        for (let b of found) prior[b.entity.eid] = b
        return bundles.map((b) => ({ ...b, [PRIOR]: prior }))
      },
    ))
}

/**
 * What {@link capture} is about to read, said before it reads it: every entity
 * the batch is about, and — for a delete — everything pointing at what is
 * dying, which is the `doomed()` walk's own question. Declared as a plugin's
 * `wants` so @yaks/graph takes both in one gather.
 */
export let wanting = (vocab: Vocab) => (bundles: Bundle[]): Ask[] => {
  let killed = bundles.filter(dead).map((b) => b.entity.eid)
  return [
    { eids: bundles.map((b) => b.entity.eid) },
    ...(killed.length
      ? [{
        about: killed,
        comps: [...new Set(vocab.deaths('cascade').map(([c]) => c))],
      }]
      : []),
  ]
}

// One movement, before it is written down.
type Draft = {
  target: Eid
  comp: string
  column: string | null
  before: unknown
  after: unknown
}

// The columns of a component worth writing down: every one the vocabulary
// declares and storage keeps. A computed column has no value to restore.
let kept = (vocab: Vocab, comp: string): Set<string> =>
  new Set(
    vocab.columns(comp).filter((c) => vocab.column(comp, c)?.persist !== false),
  )

// A component as the journal writes it down: the columns worth keeping, with
// the empty ones dropped. A null column and an absent one mean the same thing
// in this model, and an adapter that reads back every declared column must
// record the same component as one that reads back only what was written.
let plain = (vocab: Vocab, comp: string, value: Comp): Comp => {
  let cols = kept(vocab, comp)
  let out: Comp = {}
  for (let [k, v] of Object.entries(value)) {
    if (cols.has(k) && v != null) out[k] = v
  }
  return out
}

// What an entity carried before the batch, as a component table.
let state = (vocab: Vocab, prior: Prior, eid: Eid): Record<string, Comp> => {
  let out: Record<string, Comp> = {}
  for (let [name, comp] of comps(prior[eid] ?? { entity: { eid } })) {
    if (comp) out[name] = plain(vocab, name, comp)
  }
  return out
}

// The batch as applied, read as what moved. A component that was not there is
// announced by a column-less draft before its columns follow, a component that
// went is a column-less draft carrying what it held, and a death is every
// component going plus the tombstone the entity now wears. That vocabulary of
// three is what `applied()` and `undone()` replay in either direction.
let record = (
  bundles: Bundle[],
  vocab: Vocab,
  skip: Set<string>,
): Draft[] => {
  let prior = (bundles.find((b) => b[PRIOR])?.[PRIOR] ?? {}) as Prior
  let held = new Map<Eid, Record<string, Comp>>()
  let now = (eid: Eid): Record<string, Comp> => {
    let s = held.get(eid)
    if (!s) held.set(eid, s = state(vocab, prior, eid))
    return s
  }
  let out: Draft[] = []
  for (let b of bundles) {
    let target = b.entity.eid
    let st = now(target)
    if (dead(b)) {
      for (let [comp, was] of Object.entries(st)) {
        if (skip.has(comp)) continue
        out.push({ target, comp, column: null, before: was, after: null })
      }
      held.set(target, {})
      out.push({
        target,
        comp: TOMBSTONE,
        column: null,
        before: null,
        after: {},
      })
      continue
    }
    for (let [comp, patch] of comps(b)) {
      if (skip.has(comp)) continue
      let was = st[comp]
      if (patch == null) {
        if (!was) continue
        out.push({ target, comp, column: null, before: was, after: null })
        delete st[comp]
        continue
      }
      let cols = kept(vocab, comp)
      let moved = Object.entries(patch).filter(([c]) => cols.has(c))
      if (!was) {
        out.push({ target, comp, column: null, before: null, after: {} })
        st[comp] = was = {}
      }
      if (!moved.length) continue
      let next: Comp = { ...was }
      for (let [column, value] of moved) {
        out.push({
          target,
          comp,
          column,
          before: was[column] ?? null,
          after: value ?? null,
        })
        if (value == null) delete next[column]
        else next[column] = value
      }
      st[comp] = next
    }
  }
  return out
}

// Take the reading back off, so the batch the caller gets back is the batch as
// applied and nothing else. In place, on the copies `capture()` made.
let shed = (bundles: Bundle[]): Bundle[] => {
  for (let b of bundles) if (PRIOR in b) delete b[PRIOR]
  return bundles
}

/** How a journal is built. */
export type JournalOpts = {
  /** ids for the rows it writes (default: `crypto.randomUUID()`) */
  mint?: () => Eid
  /** the clock a batch row is stamped with (default: now, ISO-8601) */
  now?: () => string
  /** components never written down (default: `created`, `updated` — the
   * provenance a batch row already carries, column for column) */
  skip?: string[]
  /** the plugin's name, for diagnostics (default: `@yaks/journal`) */
  name?: string
}

// The highest seq the log holds, or 0 — read once per process, then counted
// forward inside each batch's own transaction.
let highest = (tx: Tx): number | Promise<number> =>
  then(
    tx.read(and(gt(`${BATCH}.seq`, 0), order(`-${BATCH}.seq`), limit(1))),
    (found) => Number((found[0]?.[BATCH] as Comp | undefined)?.seq ?? 0),
  )

/**
 * The journal, as a plugin:
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { journal, journalDoc } from '@yaks/journal'
 * import { loadVocab } from '@yaks/vocab'
 *
 * let vocab = loadVocab([journalDoc, ...mine])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [journal(vocab)] })
 * g.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' },
 *           $actor: { by: 'ada' } }])
 * ```
 *
 * It takes the loaded vocabulary because two questions are only a vocabulary's
 * to answer: which columns are worth writing down, and what a cascade will
 * kill. The vocabulary must carry {@link journalDoc}, which the plugin also
 * contributes, so `loadVocab(vocabOf(plugins))` finds it.
 */
export let journal = (vocab: Vocab, opts: JournalOpts = {}): Plugin => {
  let mint = opts.mint ?? (() => crypto.randomUUID() as Eid)
  let clock = opts.now ?? (() => new Date().toISOString())
  let skip = new Set(opts.skip ?? ['created', 'updated'])
  let seq: number | null = null

  let next = (tx: Tx): number | Promise<number> =>
    then(seq == null ? highest(tx) : seq, (n) => (seq = n + 1))

  let write = (bundles: Bundle[], tx: Tx): Bundle[] | Promise<Bundle[]> => {
    let drafts = record(bundles, vocab, skip)
    shed(bundles)
    if (!drafts.length) return bundles
    let actor = actorOf(bundles)
    return then(next(tx), (n) =>
      then(
        tx.patch([
          {
            entity: { eid: mint() },
            [BATCH]: {
              seq: n,
              at: clock(),
              by: actor.by ?? null,
              via: actor.via ?? null,
            },
          },
          ...drafts.map((d, ord) => ({
            entity: { eid: mint() },
            [DELTA]: {
              seq: n,
              ord,
              target: d.target,
              comp: d.comp,
              column: d.column,
              before: enc(d.before),
              after: enc(d.after),
            },
          })),
        ]),
        () => bundles,
      ))
  }

  return {
    name: opts.name ?? '@yaks/journal',
    vocab: [journalDoc],
    hooks: { precondition: capture(vocab), journal: write },
    wants: wanting(vocab),
  }
}
