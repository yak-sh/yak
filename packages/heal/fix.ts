// The fixer gates and request the tracker follower decides with, a pass at a
// time. A decision and its writes are serialized so the cap sees earlier
// requests; the task claim guards against another writer taking the work.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { addressed } from '@yaks/graph/call'
import { token } from '@yaks/graph/sha256'
import { defaultUsing } from '@yaks/harness/default'
import { human } from '@yaks/id'
import { absent, and, eq, fields, list, present } from '@yaks/query'

/** What config can set. A fixer asks the native harness's default model
 * (@yaks/harness/default), like every session that names none. */
export type Options = {
  /** the effort a fixer asks for */
  effort?: string
  /** the home project; `nofix` on it mutes every fixer */
  project?: string
  /** the most fixers running at once (default 2) */
  cap?: number
  /** how long after a fixer starts before another starts for the same fault
   * (ms, default 30 minutes) */
  cooldown?: number
  /** the command line a fixer runs the tracker's tools with, which opens the
   * graph holding the tracker's bugs (default `yak`; on a box whose tracker
   * keeps a config of its own, `yak --config <that config>`) */
  cli?: string
}

/** How long a managed fixer counts as running before its process has appeared:
 * the time a start takes, so a start that failed frees its slot. */
export let STARTING = 5 * 60_000

let uuid = () => crypto.randomUUID() as string
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let str = (v: unknown) => v == null ? '' : String(v)

let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.get([eid]))[0]

// The entity config names, by id or by its `name`, where it wears `wears`.
let named = async (g: Graph, id: string | undefined, wears: string) => {
  if (!id) return undefined
  let [eid] = await addressed(g, [id])
  if (comp(await one(g, eid), wears)) return eid
  if (!g.vocab.prop(wears, 'name')) return undefined
  return (await g.read(and(eq(`${wears}.name`, id))))[0]?.entity.eid
}

/** The configured home project, resolved by the same door as fixer gates. */
export let home = (g: Graph, options: Options) =>
  named(g, options.project, 'project')

// Whether `b` was created less than `span` ms before `now`: a span of 0 holds
// nothing, even an entity created in the same millisecond.
let young = (b: Bundle, span: number, now: number) =>
  now - Date.parse(str(comp(b, 'created')?.at)) < span

// One fixer decision at a time, so two bugs arriving together cannot both see
// a free slot and pass the cap between them.
let serially = () => {
  let line: Promise<unknown> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    let run = line.then(job)
    line = run.catch(() => {})
    return run
  }
}

/** A work item, its evidence, and writes that must land with its fixer.
 * `last` is what its fixer is told to do last: resolve the bug, explained. */
export type Work = {
  task: Bundle
  bug: string
  writes?: Bundle[]
  reopen?: boolean
  /** The tracker opening a new fixer belongs to. */
  opening?: string
  /** The tracker still reports this bug open, regardless of local completion. */
  open?: boolean
  last?: string
}

/** Whether a fixer still holds a slot.
 * Native work lives in its transcript, not a process that eventually exits.
 * Managed requests retain their bounded starting window and process lifetime. */
export let active = (fixer: Bundle, now = Date.now()): boolean => {
  if (fixer.exit) return false
  if (fixer.native) {
    if (fixer.stop || comp(fixer, 'session')?.ended) return false
    return ['pending', 'running', 'queued'].includes(
      str(comp(fixer, 'session')?.status),
    )
  }
  return !!fixer.process || young(fixer, STARTING, now)
}

/** What one pass's decisions share, each read once. */
type Pass = {
  /** the home project */
  home: () => Promise<string | undefined>
  /** whether a project wears `nofix` */
  muted: (project: string) => Promise<boolean>
  /** the fixers requested for a bug, with their lifecycle (`reading`) */
  fixers: (bug: string) => Promise<Bundle[]>
  /** every fixer without an exit, with its lifecycle */
  unexited: () => Promise<Bundle[]>
}

/** Decide and write through one graph, a pass of bugs at a time. Gate
 * refusals still commit `writes`. */
export let fixing = (g: Graph, options: Options = {}) => {
  let serial = serially()
  // Slot checks need lifecycle facts, never the computed transcript cost.
  // A pass reads many bugs' fixers at once, each naming its bug.
  let lifecycle = [
    'fixer.bug',
    'session.ended',
    'process.pid',
    'created.at',
  ]
    .filter((path) => {
      let [c, p] = path.split('.')
      return g.vocab.prop(c, p)
    })
  let marks = ['native', 'stop', 'exit'].filter((n) => g.vocab.comp(n))
  let reading = async (query: ReturnType<typeof and>) => {
    let rows = await g.read(and(...query.clauses, fields(...lifecycle)))
    let marked = new Map((await g.get(rows.map((b) => b.entity.eid), marks))
      .map((b) => [b.entity.eid, b]))
    let found = rows.map((b) => ({
      ...b,
      ...Object.fromEntries(
        marks.filter((n) => marked.get(b.entity.eid)?.[n]).map((
          n,
        ) => [n, marked.get(b.entity.eid)![n]]),
      ),
    }))
    // Managed slots depend on process/start time, not transcript status.
    // Terminal native marks decide without inspecting their entries either.
    let native = found.filter((b) =>
      b.native && !b.exit && !b.stop && !comp(b, 'session')?.ended
    )
    if (!native.length) return found
    let statuses = await g.read(and(
      eq('entity.eid', list(...native.map((b) => b.entity.eid))),
      fields('session.status'),
    ))
    let byId = new Map(statuses.map((b) => [b.entity.eid, comp(b, 'session')]))
    return found.map((b) =>
      byId.has(b.entity.eid)
        ? {
          ...b,
          session: { ...comp(b, 'session'), ...byId.get(b.entity.eid) },
        }
        : b
    )
  }
  let unexited = and(present('fixer'), absent('exit'))
  let blocked = async ({ task }: Work, history: Bundle[], pass: Pass) => {
    let project = str(comp(task, 'filed')?.project)
    for (let p of new Set([await pass.home(), project])) {
      if (p && await pass.muted(p)) return true
    }
    let now = Date.now()
    if (history.some((f) => young(f, options.cooldown ?? 30 * 60_000, now))) {
      return true
    }
    let running = (await pass.unexited()).filter((f) => active(f, now))
    return running.length >= (options.cap ?? 2)
  }

  let request = async (work: Work, pass: Pass): Promise<Bundle[]> => {
    let { task, bug, reopen, opening, open, last } = work
    if (task.cancelled || (!reopen && !open && task.completed)) return []
    let history = await pass.fixers(bug)
    let latest =
      history.toSorted((a, b) =>
        str(comp(b, 'created')?.at).localeCompare(str(comp(a, 'created')?.at))
      )[0]
    let holder = comp(task, 'claim')?.session
    // A normal completed turn is not a completed bug. Keep its context and
    // take back a released or terminal claim, but never a live worker's or an
    // explicit stop. Cooldown is for new starts, not this session's next turn.
    // A claim is stale only with terminal evidence. Unknown or empty foreign
    // sessions are held conservatively, including a managed start in flight.
    if (holder && holder != latest?.entity.eid) {
      let owner = await one(g, str(holder))
      let status = str(comp(owner, 'session')?.status)
      if (!owner) return []
      if (
        !owner.exit && (owner.process || !owner.stop &&
            !comp(owner, 'session')?.ended &&
            !['settled', 'stopped', 'failed'].includes(status))
      ) return []
    }
    if (history.some((f) => active(f))) return []
    let continuing = !reopen &&
      (!opening || str(comp(latest, 'created')?.at) >= opening) &&
      latest?.native && !latest.exit &&
      !latest.stop &&
      !comp(latest, 'session')?.ended &&
      comp(latest, 'session')?.status == 'settled'
    if (!continuing && !reopen) {
      // History is a receipt, not a permanent veto. Terminal native sessions
      // get a fresh request after cooldown; their stopped transcript stays put.
      if (!open && (history.length || task.claim)) return []
    }
    if (await blocked(work, continuing ? [] : history, pass)) return []
    let { provider, model } = await defaultUsing(g)
    let session = continuing ? latest.entity.eid : uuid()
    let title = str(comp(task, 'doc')?.title)
    return [
      ...continuing ? [] : [{
        entity: { eid: session },
        session: { operator: false },
        fixer: { bug },
      }],
      {
        entity: { eid: uuid() },
        entry: { session },
        content: {
          body: [
            [human(g.vocab)(task), title].filter(Boolean).join(' — '),
            last,
            ...(continuing
              ? [
                'Tracker still reports the bug open; continue until its cause is fixed and live, then resolve it.',
              ]
              : []),
          ].filter(Boolean).join('\n\n'),
        },
        using: {
          provider,
          model,
          ...(options.effort ? { effort: options.effort } : {}),
        },
      },
      {
        entity: task.entity,
        claim: { session },
        ...(reopen || open && task.completed ? { completed: null } : {}),
        $was: {
          claim: { session: token(comp(task, 'claim')?.session) },
          completed: { at: token(comp(task, 'completed')?.at) },
          cancelled: { at: token(comp(task, 'cancelled')?.at) },
        },
      },
    ]
  }

  /** A pass over some tracker bugs. Its decisions share what they read: the
   * fixers of every bug in the pass, read together when a decision first asks,
   * and the home project, mutes and running fixers. A requested fixer changes
   * its bug's fixers and the slots, so those are read again. `fix` answers
   * whether it wrote. */
  return (bugs: string[]) => {
    let homed: Promise<string | undefined> | undefined
    let mutes = new Map<string, Promise<boolean>>()
    let held = new Map<string, Bundle[]>()
    let together: Promise<void> | undefined
    let running: Promise<Bundle[]> | undefined
    let pass: Pass = {
      home: () => homed ??= home(g, options),
      muted: (project) => {
        if (!mutes.has(project)) {
          mutes.set(
            project,
            Promise.resolve(g.get([project], ['nofix']))
              .then(([row]) => !!row?.nofix),
          )
        }
        return mutes.get(project)!
      },
      fixers: async (bug) => {
        together ??= (async () => {
          let rows = bugs.length
            ? await reading(and(eq('fixer.bug', list(...bugs))))
            : []
          for (let each of bugs) held.set(each, [])
          for (let row of rows) {
            held.get(str(comp(row, 'fixer')?.bug))?.push(row)
          }
        })()
        await together
        let known = held.get(bug)
        if (!known) {
          held.set(bug, known = await reading(and(eq('fixer.bug', bug))))
        }
        return known
      },
      unexited: () => running ??= reading(unexited),
    }
    let fix = (read: () => Promise<Work | undefined>) =>
      serial(async () => {
        let work = await read()
        if (!work) return false
        let asked = await request(work, pass)
        if (asked.length) {
          held.delete(work.bug)
          running = undefined
        }
        let rows = [...(work.writes ?? []), ...asked]
        if (rows.length) await g.apply(rows, { trusted: true })
        return rows.length > 0
      })
    return { fix, home: pass.home, fixers: pass.fixers }
  }
}
