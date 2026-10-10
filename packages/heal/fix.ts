// The fixer gates and request shared by legacy bug effects and the tracker
// follower. A decision and its writes are serialized so the cap sees earlier
// requests; the task claim guards against another writer taking the work.

import {
  addressed,
  type Bundle,
  type Comp,
  type Graph,
  token,
} from '@yaks/graph'
import { human } from '@yaks/id'
import { absent, and, eq, present, want } from '@yaks/query'

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
}

/** How long a fixer counts as running before its process has appeared: the
 * time a start takes, and no longer, so a start that failed frees its slot. */
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

/** A work item, its evidence, and writes that must land with its fixer. */
export type Work = {
  task: Bundle
  bug: string
  writes?: Bundle[]
  reopen?: boolean
}

/** Decide and write through one graph. Gate refusals still commit `writes`. */
export let fixing = (g: Graph, options: Options = {}) => {
  let serial = serially()
  let home = () => named(g, options.project, 'project')
  let blocked = async ({ task, bug }: Work) => {
    let project = str(comp(task, 'filed')?.project)
    for (let p of new Set([await home(), project])) {
      if (p && comp(await one(g, p), 'nofix')) return true
    }
    let now = Date.now()
    let running = (await g.read(
      and(present('fixer'), absent('exit'), want('process'), want('created')),
    )).filter((f) => f.process || young(f, STARTING, now))
    if (running.length >= (options.cap ?? 2)) return true
    let history = await g.read(
      and(eq('fixer.bug', bug), want('created')),
    )
    return history.some((f) => young(f, options.cooldown ?? 30 * 60_000, now))
  }

  let request = async (work: Work): Promise<Bundle[]> => {
    let { task, bug, reopen } = work
    if (
      !options.provider || task.cancelled ||
      (!reopen && (task.completed || task.claim))
    ) return []
    if (!reopen && (await g.read(and(eq('fixer.bug', bug)))).length) return []
    if (await blocked(work)) return []
    let provider = await named(g, options.provider, 'provider')
    if (!provider) throw new Error(`not a provider: ${options.provider}`)
    let model = await named(g, options.model, 'model')
    if (options.model && !model) {
      throw new Error(`not a model: ${options.model}`)
    }
    let session = uuid()
    let title = str(comp(task, 'doc')?.title)
    return [
      {
        entity: { eid: session },
        session: { operator: false },
        fixer: { bug },
      },
      {
        entity: { eid: uuid() },
        entry: { session },
        content: {
          body: [human(g.vocab)(task), title].filter(Boolean).join(' — '),
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
        ...(reopen ? { completed: null } : {}),
        $was: {
          claim: { session: token(comp(task, 'claim')?.session) },
          completed: { at: token(comp(task, 'completed')?.at) },
        },
      },
    ]
  }

  let fix = (read: () => Promise<Work | undefined>) =>
    serial(async () => {
      let work = await read()
      if (!work) return
      let rows = [...(work.writes ?? []), ...await request(work)]
      if (rows.length) await g.apply(rows, { trusted: true })
    })
  return { fix, home }
}
