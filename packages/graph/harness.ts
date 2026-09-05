// Test fixtures (not published — see deno.json): a small bookstore vocabulary,
// a storage adapter over a plain Map, and a wrapper that makes that adapter
// asynchronous. The tests use all three.
//
// The Map adapter is the smallest thing that can be a {@link Storage}: it
// answers only the one query shape `apply()` itself asks (`.comp.prop=<eid>`,
// which is how the cascade finds what points at a dying entity), which is
// exactly the point — the core must not need a SQL compiler to work, or it
// could never run in a browser tab over a map of bundles.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import type { Query as Ast } from '@yaks/query'
import type { Bundle, Comp, Eid, Entity } from './bundle.ts'
import { comps, TOMBSTONE, tombstoned } from './bundle.ts'
import type { Query, Row, Storage, Tx } from './storage.ts'
import { isPromise } from './pipe.ts'

// A bookstore: books by publishers, reviews about books, bookmarks that only
// exist to point at something. One reference per death word, so the cascade
// rules are all exercised by a domain anyone can hold in their head.
let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    book: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        pages: { type: 'number' },
        shelved: { type: 'boolean' },
        status: { enum: ['draft', 'stocked', 'sold'] },
        // deleting a publisher leaves the book, publisher-less
        publisher: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    review: {
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        // a review of a deleted book has nothing left to be about
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
    bookmark: {
      type: 'object',
      properties: {
        // the row's whole reason to exist is the reference
        of: { type: 'string', ref: 'entity', death: 'release' },
      },
    },
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

/** The bookstore vocabulary the package's tests write against. */
export let books: Vocab = loadVocab(doc)

type Rec = { num: number; dead: boolean; comps: Record<string, Comp> }

// The one query shape this adapter answers: `and(eq('comp.prop', value))`.
let onlyPred = (query: Query) => {
  if (typeof query == 'string') throw new Error('memory(): AST queries only')
  let ast = query as Ast
  let [clause, ...rest] = ast.clauses
  if (rest.length || !clause || clause.kind != 'pred' || clause.op != '=') {
    throw new Error('memory(): only `comp.prop = value` is answered')
  }
  let [comp, prop] = clause.path
  let value = clause.value && clause.value.kind == 'scalar'
    ? clause.value.raw
    : undefined
  if (!prop || value == null) {
    throw new Error('memory(): only `comp.prop = value` is answered')
  }
  return { comp, prop, value }
}

/**
 * A synchronous storage adapter over a Map — enough of one to run `apply()`,
 * and nothing more. Rolls a transaction back by restoring the snapshot it took
 * when the transaction opened.
 */
export let memory = (): Storage => {
  let rows = new Map<Eid, Rec>()
  let next = 1

  let bundleOf = (eid: Eid): Bundle | undefined => {
    let r = rows.get(eid)
    if (!r) return undefined
    if (r.dead) return tombstoned({ eid, num: r.num })
    return { entity: { eid, num: r.num }, ...r.comps }
  }

  let tx: Tx = {
    get: (eids) => eids.flatMap((e) => bundleOf(e) ?? []),
    read: (query) => {
      let { comp, prop, value } = onlyPred(query)
      return [...rows]
        .filter(([, r]) => !r.dead && r.comps[comp]?.[prop] === value)
        .flatMap(([eid]) => bundleOf(eid) ?? [])
    },
    patch: (bundles) => {
      let born: Entity[] = []
      for (let b of bundles) {
        let eid = b.entity.eid
        let r = rows.get(eid)
        if (!r) {
          r = { num: next++, dead: false, comps: {} }
          rows.set(eid, r)
          born.push({ eid, num: r.num })
        }
        if (r.dead) continue
        for (let [name, patch] of comps(b)) {
          if (patch == null) {
            delete r.comps[name]
            continue
          }
          let cur = r.comps[name] ?? {}
          r.comps[name] = { ...cur, ...patch }
        }
      }
      return born
    },
    remove: (entities) => {
      for (let { eid } of entities) {
        let r = rows.get(eid)
        if (!r) continue
        r.dead = true
        r.comps = {}
      }
    },
  }

  let snapshot = () =>
    new Map(
      [...rows].map((
        [k, r],
      ) => [k, { ...r, comps: structuredClone(r.comps) }]),
    )

  return {
    ddl: () => [],
    install: () => {},
    read: (query) => tx.read(query),
    rows: (query) =>
      (tx.read(query) as Bundle[]).map((b) => ({ eid: b.entity.eid }) as Row),
    tx: (body) => {
      let saved = snapshot()
      let undo = (e: unknown) => {
        rows = saved
        throw e
      }
      try {
        let out = body(tx)
        return (isPromise(out) ? out.catch(undo) : out) as typeof out
      } catch (e) {
        return undo(e)
      }
    },
  }
}

/** The same adapter, asynchronous: every method answers with a promise. What
 * proves the pipeline's sync pass-through actually passes async through. */
export let slow = (base: Storage): Storage => ({
  ddl: () => base.ddl(),
  install: () => Promise.resolve(base.install()),
  read: (query, opts) => Promise.resolve(base.read(query, opts)),
  rows: (query, opts) => Promise.resolve(base.rows(query, opts)),
  tx: (body) =>
    base.tx((tx) =>
      body({
        read: (q, o) => Promise.resolve(tx.read(q, o)),
        get: (eids) => Promise.resolve(tx.get(eids)),
        patch: (bundles) => Promise.resolve(tx.patch(bundles)),
        remove: (entities) => Promise.resolve(tx.remove(entities)),
      })
    ),
})

/** A bundle's component, for a test that wants one column out of it. */
export let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** Whether a bundle is the tombstone one `apply()` synthesizes. */
export let isDead = (b: Bundle): boolean => b[TOMBSTONE] != null
