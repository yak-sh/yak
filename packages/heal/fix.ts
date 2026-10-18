// The fixer gates and request shared by legacy bug effects and the tracker
// follower. A decision and its writes are serialized so the cap sees earlier
// requests; the task claim guards against another writer taking the work.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { addressed } from '@yaks/graph/call'
import { token } from '@yaks/graph/sha256'
import { human } from '@yaks/id'
import { absent, and, eq, fields, present } from '@yaks/query'

/** What config can set. */
export type Options = {
  /** who runs a fixer, by name or id; without one, nothing starts */
  provider?: string
  /** the model a fixer runs on, by name or id */
  model?: string
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

// The entity config names, by id or by its `name` (`codex`), where it wears
// `wears`.
let named = async (g: Graph, id: string | undefined, wears: string) => {
  if (!id) return undefined
  let [eid] = await addressed(g, [id])
  if (comp(await one(g, eid), wears)) return eid
  if (!g.vocab.prop(wears, 'name')) return undefined
  return (await g.read(and(eq(`${wears}.name`, id))))[0]?.entity.eid
}

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

/** Decide and write through one graph. Gate refusals still commit `writes`. */
export let fixing = (g: Graph, options: Options = {}) => {
  let serial = serially()
  // Slot checks need lifecycle facts, never the computed transcript cost.
  let lifecycle = [
    'session.status',
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
    return rows.map((b) => ({
      ...b,
      ...Object.fromEntries(
        marks.filter((n) => marked.get(b.entity.eid)?.[n]).map((
          n,
        ) => [n, marked.get(b.entity.eid)![n]]),
      ),
    }))
  }
  let unexited = and(present('fixer'), absent('exit'))
  // The home project, resolved once per decision: the work and its gates ask.
  let homed: Promise<string | undefined> | undefined
  let home = () => homed ??= named(g, options.project, 'project')
  let blocked = async ({ task }: Work, history: Bundle[]) => {
    let project = str(comp(task, 'filed')?.project)
    for (let p of new Set([await home(), project])) {
      if (p && comp(await one(g, p), 'nofix')) return true
    }
    let now = Date.now()
    if (history.some((f) => young(f, options.cooldown ?? 30 * 60_000, now))) {
      return true
    }
    let running = (await reading(unexited))
      .filter((f) => active(f, now))
    return running.length >= (options.cap ?? 2)
  }

  let request = async (work: Work): Promise<Bundle[]> => {
    let { task, bug, reopen, open, last } = work
    if (
      !options.provider || task.cancelled ||
      (!reopen && !open && task.completed)
    ) return []
    let history = await reading(and(eq('fixer.bug', bug)))
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
    let continuing = !reopen && latest?.native && !latest.exit &&
      !latest.stop &&
      !comp(latest, 'session')?.ended &&
      comp(latest, 'session')?.status == 'settled'
    if (!continuing && !reopen) {
      // History is a receipt, not a permanent veto. Terminal native sessions
      // get a fresh request after cooldown; their stopped transcript stays put.
      if (!open && (history.length || task.claim)) return []
    }
    if (await blocked(work, continuing ? [] : history)) return []
    let provider = await named(g, options.provider, 'provider')
    if (!provider) throw new Error(`not a provider: ${options.provider}`)
    let model = await named(g, options.model, 'model')
    if (options.model && !model) {
      throw new Error(`not a model: ${options.model}`)
    }
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
                'Tracker still reports the bug open; continue until it is resolved.',
              ]
              : []),
          ].filter(Boolean).join('\n\n'),
        },
        using: {
          provider,
          ...(model ? { model } : {}),
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

  let fix = (read: () => Promise<Work | undefined>) =>
    serial(async () => {
      homed = undefined
      let work = await read()
      if (!work) return
      let rows = [...(work.writes ?? []), ...await request(work)]
      if (rows.length) await g.apply(rows, { trusted: true })
    })
  return { fix, home }
}
