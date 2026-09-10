// The daemon: a `created(entry)` effect over `react`. Every entry that lands
// wakes one step over its transcript, and the steps of one transcript run one
// after another — the step that asks the model appends entries, those wake the
// step that runs the tool, and so on until a step finds nothing to do. Two
// transcripts proceed side by side.
//
// A step writes through the graph's own door, not the effect's `write`: each
// step is a fresh batch at generation zero, so the chain is never cut short by
// the registry's depth. The handler itself returns at once — the step is
// queued, not awaited — so a batch is committed and cast before anything
// reacts to it, and a slow model never holds a writer.

import type { Comp, Eid, Graph } from '@yaks/graph'
import type { Effects, Event } from '@yaks/effects'
import { deliverChild } from './children.ts'
import { ENTRY } from './native.ts'
import { type Deps, react, type Step } from './react.ts'

/** A running daemon: wake a transcript by hand, or wait until one is quiet. */
export type Daemon = {
  /** Serialize a write with this session’s model/tool steps. */
  enqueue: <T>(session: Eid, work: () => Promise<T>) => Promise<T>
  /** queue one step over this transcript; answers when that step is done */
  wake: (session: Eid) => Promise<Step>
  /** answers once every step queued for this transcript has run */
  idle: (session: Eid) => Promise<void>
}

/**
 * Register the daemon on an effects registry that is a plugin of `g`:
 *
 * ```ts
 * let fx = effects(vocab)
 * let g = graph({ storage: ram(vocab), vocab, plugins: [sessions(), fx] })
 * let d = daemon(g, fx, { model, tools })
 * g.apply([input])          // wakes the first step
 * await d.idle(session)     // settled, stopped, or failed
 * ```
 *
 * A step that throws is reported through `report` (default `console.error`)
 * and the chain goes on: a defect in one step is not a dead transcript.
 */
export let daemon = (
  g: Graph,
  fx: Effects,
  deps: Deps,
  each: (step: Step) => void = () => {},
  report: (err: unknown) => void = (err) => console.error(err),
): Daemon => {
  let busy = new Map<Eid, Promise<unknown>>()
  let queued = new Map<Eid, Promise<Step>>()
  let enqueue = <T>(session: Eid, work: () => Promise<T>): Promise<T> => {
    let job = (busy.get(session) ?? Promise.resolve()).catch(report).then(work)
    busy.set(session, job)
    let clear = () => {
      if (busy.get(session) == job) busy.delete(session)
    }
    job.then(clear, clear)
    return job
  }
  let wake = (session: Eid): Promise<Step> => {
    let pending = queued.get(session)
    if (pending) return pending
    let step = enqueue(session, async () => {
      queued.delete(session)
      try {
        let step = await react(g, session, deps)
        each(step)
        if (['settled', 'failed', 'stopped'].includes(step.status)) {
          let [self] = await g.storage.tx((tx) => tx.get([session]))
          let parent = (self?.spawned as Comp | undefined)?.parent
          if (parent) {
            // Do not wait on the parent: it may itself be waiting on this child.
            enqueue(String(parent), () => deliverChild(g, session)).catch(
              report,
            )
          }
        }
        return step
      } catch (err) {
        report(err)
        return { did: 'nothing', status: 'failed', added: [] } as Step
      }
    })
    queued.set(session, step)
    return step
  }
  fx.created(ENTRY, (e) => {
    wake(String(e.comp?.session))
  })
  // A task may become done after its worker has gone quiet: a contained or
  // required task settles, or an edge is removed. Recheck only the changed
  // task and its direct dependents, matching done()/openDeps() semantics.
  if (g.vocab.comps.includes('task')) {
    let taskChanged = async (e: Event) => {
      let ids = new Set<Eid>([e.entity.eid])
      let [changed] = await g.storage.tx((tx) => tx.get([e.entity.eid]))
      for (let part of [e.comp, changed?.edge as Comp | undefined]) {
        if (typeof part?.from == 'string') ids.add(part.from)
      }
      for (let rel of ['contains', 'requires']) {
        for (let b of await g.read(`.${rel} .edge.to=${e.entity.eid}`)) {
          let from = (b.edge as Comp)?.from
          if (typeof from == 'string') ids.add(from)
        }
      }
      // Removed edges have no before-image in effects. Reconcile active
      // task claims in that case, rather than miss a newly unblocked task.
      let candidates =
        e.kind == 'removed' && ['edge', 'contains', 'requires'].includes(e.name)
          ? await g.read('.task .claim.session!')
          : await g.storage.tx((tx) => tx.get([...ids]))
      for (let task of candidates) {
        let child = (task.claim as Comp | undefined)?.session
        if (!task.task || typeof child != 'string') continue
        let [self] = await g.storage.tx((tx) => tx.get([child]))
        let parent = (self?.spawned as Comp | undefined)?.parent
        if (typeof parent == 'string') {
          enqueue(parent, () => deliverChild(g, child)).catch(report)
        }
      }
    }
    for (
      let name of [
        'task',
        'completed',
        'cancelled',
        'claim',
        'edge',
        'contains',
        'requires',
      ]
    ) {
      fx.created(name, taskChanged).changed(name, taskChanged).removed(
        name,
        taskChanged,
      )
    }
  }
  let idle = async (session: Eid) => {
    let seen: Promise<unknown> | undefined
    while (busy.get(session) != seen) {
      seen = busy.get(session)
      await seen
    }
  }
  return { wake, idle, enqueue }
}
