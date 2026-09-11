import { dispatch, pool } from './pool.ts'
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
import { transcript } from './react.ts'
import { statusOf } from './status.ts'
import { ENTRY } from './native.ts'
import { type Deps, react, type Step } from './react.ts'

/** A running daemon: wake a transcript by hand, or wait until one is quiet. */
export type Daemon = {
  /** Stop admission, then wait for every admitted callback. Never closes storage. */
  stop: () => Promise<void>
  /** Abort this session's current model request; does not stop tools/processes. */
  interrupt: (session: Eid) => boolean
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
  report: (err: unknown, session?: Eid) => void = (err) => console.error(err),
  // Host-level exclusion across runtimes; an occupied step is not a crash.
  acquire?: (session: Eid) => (() => void) | undefined,
): Daemon => {
  let stopping = false
  let stopped: Promise<void> | undefined
  let effects = new Set<Promise<unknown>>()
  let p = pool(g)
  let active = new Set<Eid>()
  let requests = new Map<Eid, AbortController>()
  let resumes = new Map<Eid, () => void>()
  let recovered = false
  let scheduling: Promise<void> | undefined
  let again = false
  let schedule = () => {
    if (stopping) return
    again = true
    if (scheduling) return
    scheduling = enqueue('pool:scheduler', async () => {
      do {
        if (stopping) return
        again = false
        let rows = await g.read('.dispatch')
        if (!recovered) {
          recovered = true
          for (let b of rows) {
            if (dispatch(b)?.state == 'active') {
              await g.apply([{
                entity: b.entity,
                dispatch: { state: 'queued' },
              }], { trusted: true })
              ;(b.dispatch as Comp).state = 'queued'
            }
          }
        }
        for (let [id, resume] of resumes) {
          if (
            active.size -
                [...active].filter((id) => p.suspended.has(id)).length >=
              (p.limits.maxChildren ?? 32)
          ) break
          p.suspended.delete(id)
          resumes.delete(id)
          resume()
        }
        rows.sort((a, b) =>
          Number(dispatch(a)?.order ?? 0) - Number(dispatch(b)?.order ?? 0)
        )
        for (let b of rows) {
          if (
            active.size -
                [...active].filter((id) => p.suspended.has(id)).length >=
              (p.limits.maxChildren ?? 32)
          ) break
          let id = b.entity.eid
          if (dispatch(b)?.state != 'queued' || active.has(id)) continue
          if (stopping) return
          active.add(id)
          enqueue(id, async () => {
            if (stopping) return
            try {
              let [fresh] = await g.storage.tx((tx) => tx.get([id]))
              if (!fresh) return false
              let entries = await transcript(g, id)
              let cancelled = g.vocab.comps.includes('task') &&
                (await g.read(`.task .claim.session=${id} .cancelled`)).length >
                  0
              if (cancelled && statusOf(entries) != 'stopped') {
                await g.apply([{
                  entity: { eid: id + ':cancelled' },
                  entry: { session: id },
                  stop: {},
                }], { trusted: true })
              }
              if (cancelled || statusOf(entries) == 'stopped') {
                await g.apply([{
                  entity: { eid: id },
                  dispatch: { state: 'settled' },
                }], { trusted: true })
                return true
              }
              let args = dispatch(fresh)?.args
              if (typeof args == 'string') {
                let prepared = await p.limits.prepareChild?.({
                  parent: String((b.spawned as Comp).parent),
                  child: id,
                  args: JSON.parse(args),
                })
                await g.apply([{
                  entity: { eid: id },
                  ...prepared,
                  dispatch: { state: 'active', args: null },
                }], { trusted: true })
              } else {
                await g.apply([{
                  entity: { eid: id },
                  dispatch: { state: 'active' },
                }], { trusted: true })
              }
              return true
            } catch (err) {
              report(err, id)
              await g.apply([{
                entity: { eid: id },
                dispatch: { state: 'settled' },
              }, {
                entity: { eid: id + ':preparation-error' },
                entry: { session: id },
                exception: {},
                content: { body: String(err) },
              }, {
                entity: { eid: id + ':preparation-stop' },
                entry: { session: id },
                stop: {},
              }], { trusted: true })
              return true
            }
          }).then((ready) => ready ? turn(id) : undefined).finally(() => {
            active.delete(id)
            schedule()
          }).catch(report)
        }
      } while (again)
    }).finally(() => {
      scheduling = undefined
      if (again) schedule()
    })
    scheduling.catch(report)
  }
  p.changed = schedule
  p.stopping = () => stopping
  p.resume = (id) => {
    if (stopping || !active.has(id)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      resumes.set(id, resolve)
      schedule()
    })
  }
  let busy = new Map<Eid, Promise<unknown>>()
  let queued = new Map<Eid, Promise<Step>>()
  let enqueue = <T>(session: Eid, work: () => Promise<T>): Promise<T> => {
    if (stopping) return Promise.reject(new Error('Daemon is stopping'))
    let job = (busy.get(session) ?? Promise.resolve()).catch(report).then(work)
    busy.set(session, job)
    let clear = () => {
      if (busy.get(session) == job) busy.delete(session)
    }
    job.then(clear, clear)
    return job
  }
  let turn = (session: Eid): Promise<Step> => {
    if (stopping) {
      return Promise.resolve({ did: 'nothing', status: 'stopped', added: [] })
    }
    let pending = queued.get(session)
    if (pending) return pending
    let step = enqueue(session, async () => {
      queued.delete(session)
      if (stopping) {
        return { did: 'nothing', status: 'stopped', added: [] } as Step
      }
      let release = acquire?.(session)
      if (acquire && !release) {
        return { did: 'nothing', status: 'running', added: [] } as Step
      }
      try {
        let controller = new AbortController()
        requests.set(session, controller)
        let step: Step
        try {
          step = await react(g, session, { ...deps, signal: controller.signal })
        } finally {
          requests.delete(session)
        }
        each(step)
        if (['settled', 'failed', 'stopped'].includes(step.status)) {
          let [self] = await g.storage.tx((tx) => tx.get([session]))
          if (self?.dispatch) {
            await g.apply([{
              entity: self.entity,
              dispatch: { state: 'settled' },
            }], { trusted: true })
          }
        }
        if (['settled', 'failed', 'stopped'].includes(step.status)) {
          let [self] = await g.storage.tx((tx) => tx.get([session]))
          let parent = (self?.spawned as Comp | undefined)?.parent
          if (parent && !stopping) {
            // Do not wait on the parent: it may itself be waiting on this child.
            enqueue(String(parent), () => deliverChild(g, session)).catch(
              report,
            )
          }
        }
        return step
      } catch (err) {
        report(err, session)
        return { did: 'nothing', status: 'failed', added: [] } as Step
      } finally {
        release?.()
      }
    })
    queued.set(session, step)
    return step
  }
  let wake = (session: Eid): Promise<Step> => {
    if (stopping) {
      return Promise.resolve({ did: 'nothing', status: 'stopped', added: [] })
    }
    return enqueue('pool:intake', async () => {
      if (stopping) {
        return { did: 'nothing', status: 'stopped', added: [] } as Step
      }
      let [self] = await g.storage.tx((tx) => tx.get([session]))
      if (!self?.dispatch) {
        turn(session).catch(report)
        return { did: 'nothing', status: 'pending', added: [] } as Step
      }
      if (
        !active.has(session) &&
        statusOf(await transcript(g, session)) == 'stopped'
      ) {
        await g.apply(
          [{ entity: self.entity, dispatch: { state: 'settled' } }],
          { trusted: true },
        )
        let parent = (self.spawned as Comp | undefined)?.parent
        if (parent && !stopping) {
          enqueue(String(parent), () => deliverChild(g, session)).catch(report)
        }
        return { did: 'nothing', status: 'stopped', added: [] } as Step
      }
      if (!active.has(session) || dispatch(self)?.state != 'settled') {
        // A new turn rejoins the tail; a duplicate wake of queued intent
        // retains its position. Hot children cannot starve later submissions.
        let order = dispatch(self)?.order
        if (dispatch(self)?.state != 'queued') {
          order = Math.max(
            0,
            ...(await g.read('.dispatch')).map((b) =>
              Number(dispatch(b)?.order ?? 0)
            ),
          ) + 1
        }
        await g.apply([{
          entity: { eid: session },
          dispatch: { state: 'queued', order },
        }], { trusted: true })
      }
      schedule()
      return { did: 'nothing', status: 'pending', added: [] } as Step
    })
  }
  fx.created('dispatch', () => schedule())
  schedule()
  fx.created(ENTRY, (e) => {
    if (stopping) return
    let session = String(e.comp?.session)
    enqueue(session, async () => {
      let [entry] = await g.storage.tx((tx) => tx.get([e.entity.eid]))
      if (!entry?.notice) wake(session)
    }).catch(report)
  })
  // A task may become done after its worker has gone quiet: a contained or
  // required task settles, or an edge is removed. Recheck only the changed
  // task and its direct dependents, matching done()/openDeps() semantics.
  if (g.vocab.comps.includes('task')) {
    let taskChanged = (e: Event) => {
      if (stopping) return
      let pending = taskChange(e)
      effects.add(pending)
      pending.then(() => effects.delete(pending), () => effects.delete(pending))
      return pending
    }
    let taskChange = async (e: Event) => {
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
        if (
          task.cancelled && self?.dispatch && !active.has(child) && !stopping
        ) {
          await g.apply([{
            entity: { eid: child + ':cancelled' },
            entry: { session: child },
            stop: {},
          }], { trusted: true })
        }
        if (typeof parent == 'string' && !stopping) {
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
    for (;;) {
      await busy.get('pool:intake')
      await scheduling
      let job = busy.get(session)
      if (!job && !active.has(session)) {
        // Effects enqueue intake after the session callback resolves. A queue
        // marker is durable evidence of owed work even in that microtask gap.
        let [self] = await g.storage.tx((tx) => tx.get([session]))
        if (
          !stopping &&
          dispatch(self ?? { entity: { eid: session } })?.state == 'queued' &&
          (p.limits.maxChildren ?? 32) > 0
        ) {
          schedule()
          await scheduling
          if (busy.has(session) || active.has(session)) continue
        }
        await Promise.resolve()
        if (
          busy.has('pool:intake') || scheduling || busy.has(session) ||
          active.has(session)
        ) continue
        return
      }
      await job
      await Promise.resolve()
    }
  }
  let stop = () => {
    stopping = true
    for (let resume of resumes.values()) resume()
    resumes.clear()
    return stopped ??= (async () => {
      // Includes effects already reading storage, not just session queues.
      while (busy.size || effects.size || scheduling) {
        await Promise.allSettled([
          ...busy.values(),
          ...effects,
          ...scheduling ? [scheduling] : [],
        ])
      }
    })()
  }
  return {
    wake,
    idle,
    enqueue,
    stop,
    interrupt: (session) => {
      let controller = requests.get(session)
      if (!controller) return false
      controller.abort()
      return true
    },
  }
}
