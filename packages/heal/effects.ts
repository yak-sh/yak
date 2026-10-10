// An actionable exception is reported through the host's telemetry. Bug tasks
// already in this graph start fixers behind the provider, project, cap and
// cooldown gates; the boot sweep retries bugs those gates held back.

import {
  addressed,
  type Bundle,
  type Comp,
  type Graph,
  identityEid,
  who,
} from '@yaks/graph'
import type { Host as Hosting } from '@yaks/host'
import type { Handlers } from '@yaks/effects'
import { human } from '@yaks/id'
import { absent, and, eq, list, present, want } from '@yaks/query'
import { actionable } from './fault.ts'

/** What these handlers are given (@yaks/cli `Host`). */
export type Host = Pick<Hosting, 'graph' | 'report'>

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

export let effects = (host: Host, options: Options = {}): Handlers => {
  let g = host.graph
  let cap = options.cap ?? 2
  let cooldown = options.cooldown ?? 30 * 60_000
  let serial = serially()
  let home = () => named(g, options.project, 'project')

  // Why no fixer starts for this bug now, or nothing.
  let blocked = async (bug: Bundle): Promise<string | undefined> => {
    let project = str(comp(bug, 'filed')?.project)
    for (let p of [await home(), project]) {
      if (p && comp(await one(g, p), 'nofix')) return 'muted'
    }
    let now = Date.now()
    let running = (await g.read(
      and(present('fixer'), absent('exit'), want('process'), want('created')),
    ))
      .filter((f) => f.process || young(f, STARTING, now))
    if (running.length >= cap) return 'at cap'
    let same = await g.read(and(eq('bug.fault', str(comp(bug, 'bug')?.fault))))
    let fixers = same.length
      ? await g.read(
        and(
          eq('fixer.bug', list(...same.map((b) => b.entity.eid))),
          want('created'),
        ),
      )
      : []
    if (fixers.some((f) => young(f, cooldown, now))) return 'cooling down'
  }

  // Start a fixer on this bug, if it is open, nobody holds it, it never had
  // one, and the gates let it.
  let fix = (eid: string) =>
    serial(async () => {
      if (!options.provider) return
      let bug = await one(g, eid)
      if (!bug?.bug || bug.completed || bug.cancelled || bug.claim) return
      if ((await g.read(and(eq('fixer.bug', eid)))).length) return
      if (await blocked(bug)) return
      let provider = await named(g, options.provider, 'provider')
      if (!provider) throw new Error(`not a provider: ${options.provider}`)
      let model = await named(g, options.model, 'model')
      if (options.model && !model) {
        throw new Error(`not a model: ${options.model}`)
      }
      let session = uuid()
      let title = str(comp(bug, 'doc')?.title)
      // The @yaks/spawn request, and the claim that says who holds the work:
      // the session starts by reading what it holds.
      await g.apply([
        {
          entity: { eid: session },
          session: { operator: false },
          fixer: { bug: eid },
        },
        {
          entity: { eid: uuid() },
          entry: { session },
          content: {
            body: [human(g.vocab)(bug), title].filter(Boolean).join(' — '),
          },
          using: {
            provider,
            ...(model ? { model } : {}),
            ...(options.effort ? { effort: options.effort } : {}),
          },
        },
        { entity: { eid }, claim: { session } },
      ], { trusted: true })
    })

  let report = async (eid: string) => {
    let row = await one(g, eid)
    let x = comp(row, 'exception')
    if (!row || !x) return // cleared before this ran
    let message = str(x.value || x.message || comp(row, 'content')?.body).trim()
    if (!message || !actionable(message)) return
    let source = str(comp(row, 'output')?.source)
    let call = source ? await one(g, source) : undefined
    let to = str(comp(call, 'call')?.to)
    let tool = to ? str(comp(await one(g, to), 'tool')?.name) : ''
    let actor = call && who(call) || who(row)
    let session = str(comp(row, 'entry')?.session) ||
      (row.session ? eid : str(comp(call, 'entry')?.session))
    let process = str(comp(row, 'execution')?.by) ||
      (row.process ? eid : str(comp(call, 'execution')?.by))
    let error = new Error(message)
    error.name = str(x.type) || 'Error'
    // An invented reporting frame would group failures by this handler.
    error.stack = str(x.stack) || undefined
    await host.report?.(error, {
      eid: identityEid('exception_report', [eid]),
      ...(actor ? { actor } : {}),
      ...(tool ? { tags: { tool } } : {}),
      ...(x.at ? { at: str(x.at) } : {}),
      ...(typeof x.version == 'number' ? { version: x.version } : {}),
      during: {
        entity: eid,
        kind: g.vocab.kindOf(row),
        ...(session ? { session } : {}),
        ...(process ? { process } : {}),
      },
    })
  }

  return {
    exception_report: (e) => report(e.entity.eid),
    // Idempotent: a bug that has a fixer, or is held, starts nothing.
    bug_fix: (e) => fix(e.entity.eid),
  }
}
