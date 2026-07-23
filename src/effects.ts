// Effects: what the server DOES about a change, once it's true. The
// doctrine, in two halves:
//
//   RULES live in apply() — in-transaction, synchronous, able to reject
//   or rewrite the batch (the claim lease, the stop_request gate,
//   tombstones, cascades). They are part of what a commit MEANS.
//
//   EFFECTS live here — post-commit observers doing slow, fallible,
//   worldly things (spawn a process, signal a group, someday send an
//   email). At-most-once by construction: a crash between commit and
//   effect loses the effect, and boot reconciliation (sessions.ts
//   recover()) is what makes that survivable. A handler failure is
//   reported, never thrown — watching must not break the thing being
//   watched, so the wire never waits on an effect and never hears one
//   fail.
//
// The registry is curated where it's registered (server.ts, beside the
// renderer list in Entity.tsx) — a handler is one row there, and a future
// plugin contributes rows the same way. Dispatch walks apply()'s
// RETURNED batch (which already carries the synthesized cascade
// deletions), told apart by the Trace apply() filled in: a create and a
// patch are the same Change on the wire, and a cascade victim's comp
// rows never ride it at all.
import { type Change } from './types.ts'

// One handler: the eid and the comp PATCH as applied (a created() comp is
// the whole birth row as sent). May be async; the return value rides the
// dispatch promise so tests can await a whole effect chain.
export type Handler = (eid: string, comp: Record<string, unknown>) => unknown

export type Effect = {
  created?: Handler
  // Column-scoped: fires when a PATCH (not a create) carries that column.
  changed?: Record<string, Handler>
  removed?: (eid: string) => unknown
  // The outbox relay's declaration: what an UNACTED row of this comp
  // looks like (a SQL predicate over its table). An intent committed
  // just before a crash never fired its created() — at boot, relay()
  // hands every pending row back through it. Declaring a sweep is a
  // promise that created() is idempotent: delivery becomes at-least-once.
  sweep?: { pending: string }
  // The registration's one-liner — what the lever DOES, said where it's
  // registered. docs() reads these into the Vocabulary doc, so the only
  // way to document an effect is to register it.
  doc?: string
}

let registry: Record<string, Effect[]> = {}
export let on = (comp: string, e: Effect) => {
  ;(registry[comp] ??= []).push(e)
}

// The registry, read back as documentation: which hooks each effect
// wears, its sweep predicate, its one-liner. Introspection, not a second
// list — an unregistered effect can't appear, a registered one can't hide.
export let docs = () =>
  Object.entries(registry).flatMap(([comp, es]) =>
    es.map((e) => ({
      comp,
      hooks: [
        ...(e.created ? ['created'] : []),
        ...Object.keys(e.changed ?? {}).map((c) => `changed(${c})`),
        ...(e.removed ? ['removed'] : []),
      ],
      sweep: e.sweep?.pending,
      doc: e.doc,
    }))
  )

// What apply() learned that the wire doesn't say: which comp rows the
// batch inserted, and which rows its deletes took (keyed by eid). Hand a
// fresh one to apply(), then to dispatch() with the batch it returned.
export type Trace = { created: Set<string>; removed: Map<string, string[]> }
export let trace = (): Trace => ({ created: new Set(), removed: new Map() })

// Run every matching handler, isolated: a throw (or rejection) goes to
// `oops` and the rest still fire. Returns a promise of all handler
// results — callers on the wire ignore it; tests await it.
export let dispatch = (
  changes: Change[],
  t: Trace,
  oops: (comp: string, e: unknown) => void = (comp, e) =>
    console.warn(`effect ${comp} failed —`, e),
): Promise<unknown[]> => {
  let jobs: Promise<unknown>[] = []
  let fire = (comp: string, run: () => unknown) => {
    try {
      jobs.push(Promise.resolve(run()).catch((e) => oops(comp, e)))
    } catch (e) {
      oops(comp, e)
    }
  }
  for (let { eid, name, comp } of changes) {
    if (name == 'entity' && comp == null) {
      // An entity death: every comp row it carried is a removal, in the
      // order the cascade took them.
      for (let gone of t.removed.get(eid) ?? []) {
        for (let e of registry[gone] ?? []) {
          if (e.removed) fire(gone, () => e.removed!(eid))
        }
      }
      continue
    }
    if (comp == null) {
      if (t.removed.get(eid)?.includes(name)) {
        for (let e of registry[name] ?? []) {
          if (e.removed) fire(name, () => e.removed!(eid))
        }
      }
      continue
    }
    if (name == 'dependency') {
      // Edges are data too: a handler registered on 'dependency' hears
      // every sentence spoken or unsaid (the comp carries type,
      // child_eid, and gone when unlinking). created() is the one hook —
      // an edge has no columns to patch and no row to remove.
      for (let e of registry.dependency ?? []) {
        if (e.created) fire('dependency', () => e.created!(eid, comp!))
      }
      continue
    }
    if (name == 'entity') continue
    let born = t.created.has(`${name} ${eid}`)
    for (let e of registry[name] ?? []) {
      if (born) {
        if (e.created) fire(name, () => e.created!(eid, comp!))
      } else {
        for (let col of Object.keys(e.changed ?? {})) {
          if (col in comp) fire(name, () => e.changed![col](eid, comp!))
        }
      }
    }
  }
  return Promise.all(jobs)
}

// The boot half of the outbox: every effect that declared a sweep gets
// its pending rows back through created(), isolated like any dispatch.
// The caller brings the rows (this module never touches the db) — one
// fetch per declaration, so a fetch that throws fails that sweep alone.
// Resolves to the fired handlers' results: length 0 means nothing was
// pending, which is what a second pass right after a first must find.
export let relay = (
  rows: (comp: string, pending: string) => Record<string, unknown>[],
  oops: (comp: string, e: unknown) => void = (comp, e) =>
    console.warn(`sweep ${comp} failed —`, e),
): Promise<unknown[]> => {
  let jobs: Promise<unknown>[] = []
  // Isolation at BOTH grains: a fetch that throws fails that sweep alone,
  // and a handler that throws (sync or async) fails that ROW alone — the
  // rest of the pending set still fires, same discipline as dispatch.
  for (let [comp, es] of Object.entries(registry)) {
    for (let e of es) {
      if (!e.sweep || !e.created) continue
      let got: Record<string, unknown>[]
      try {
        got = rows(comp, e.sweep.pending)
      } catch (err) {
        oops(comp, err)
        continue
      }
      for (let row of got) {
        try {
          jobs.push(
            Promise.resolve(e.created(String(row.eid), row))
              .catch((err) => oops(comp, err)),
          )
        } catch (err) {
          oops(comp, err)
        }
      }
    }
  }
  return Promise.all(jobs)
}
