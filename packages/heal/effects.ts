// The effect handlers this package exports as `@yaks/heal/effects`: what a
// host does when something it did not expect goes wrong.
//
// An `exception` landing on any entity files one task about it, keyed by the
// fault (./fault.ts). While that task is open, the same fault caught again
// counts on it rather than filing another, so a runner failing every 300ms
// leaves one task with a count. `error` is a failure the code expected, and is
// never a bug.
//
// A new bug then starts a fixer: an agent session holding the claim on the
// task, marked `fixer` so the gates can count it. Four gates stand in front of
// that, and a gate saying no leaves the task filed and nothing more:
//
// - off: no `provider` configured, or a host running without duties;
// - muted: `nofix` on the bug's project, or on the home project for all;
// - at cap: this many fixers running already;
// - cooling down: a fixer was started for the same fault this recently.
//
// A bug a gate held back is tried again when a fixer's process exits and when
// the host starts (the `bug` sweep); one bug never gets a second fixer.
//
// Config:
//
// ```json
// { "use": "@yaks/heal",
//   "with": { "provider": "codex", "model": "gpt-5.6-sol", "project": "P-19" } }
// ```

import {
  addressed,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
} from '@yaks/graph'
import type { Watch } from '@yaks/effects'
import { edgeEid, link } from '@yaks/edge'
import { human } from '@yaks/id'
import { absent, and, eq, list, present, want } from '@yaks/query'
import { actionable, faultKey, recurred, severity } from './fault.ts'

/** What these handlers are given (@yaks/cli `Host`). */
export type Host = { graph: Graph; me: Eid; config?: { duties?: boolean } }

/** What config can set. */
export type Options = {
  /** who runs a fixer, by name or id; without one, bugs file and nothing
   * starts */
  provider?: string
  /** the model a fixer runs on, by name or id */
  model?: string
  /** the effort a fixer asks for */
  effort?: string
  /** the project a bug files under when nothing names one; `nofix` on it
   * mutes every fixer */
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
  (await g.storage.tx((tx) => tx.get([eid])))[0]

// The entity config names, by id or by its `name` (`codex`), where it wears
// `wears`.
let named = async (g: Graph, id: string | undefined, wears: string) => {
  if (!id) return undefined
  let [eid] = await addressed(g, [id])
  if (comp(await one(g, eid), wears)) return eid
  if (!g.vocab.prop(wears, 'name')) return undefined
  return (await g.read(and(eq(`${wears}.name`, id))))[0]?.entity.eid
}

// A bug whose task is not settled yet.
let open = [present('bug'), absent('completed'), absent('cancelled')]

let bornAfter = (b: Bundle, t: number) =>
  Date.parse(str(comp(b, 'created')?.at)) >= t

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

export let effects = (host: Host, options: Options = {}): Watch[] => {
  let g = host.graph
  let cap = options.cap ?? 2
  let cooldown = options.cooldown ?? 30 * 60_000
  let serial = serially()
  let home = () => named(g, options.project, 'project')

  // The project a failure belongs to: the broken entity's own, else the one
  // its session is working for, else the home project.
  let owner = async (row: Bundle): Promise<string | undefined> => {
    let filed = str(comp(row, 'filed')?.project)
    if (filed) return filed
    let session = row.session
      ? row.entity.eid
      : str(comp(row, 'entry')?.session)
    for (
      let held of session
        ? await g.read(and(eq('claim.session', session), want('filed')))
        : []
    ) {
      let p = str(comp(held, 'filed')?.project)
      if (p) return p
    }
    return home()
  }

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
      .filter((f) => f.process || bornAfter(f, now - STARTING))
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
    if (fixers.some((f) => bornAfter(f, now - cooldown))) return 'cooling down'
  }

  // Start a fixer on this bug, if it is open, nobody holds it, it never had
  // one, and the gates let it.
  let fix = (eid: string) =>
    serial(async () => {
      if (!options.provider || host.config?.duties == false) return
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
        { entity: { eid: session }, session: {}, fixer: { bug: eid } },
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

  // Every open bug no fixer has started for: what a gate held back.
  let retry = async () => {
    for (let bug of await g.read(and(...open, absent('claim')))) {
      await fix(bug.entity.eid)
    }
  }

  // File a failure: count it on the open bug for its fault, or open one.
  let file = async (eid: string) => {
    let row = await one(g, eid)
    let x = comp(row, 'exception')
    if (!row || !x) return // cleared before this ran
    let message = str(x.message || comp(row, 'content')?.body).trim()
    if (!message || !actionable(message)) return
    let kind = g.vocab.kindOf(row)
    let fault = faultKey(kind, message, str(x.stack))
    let at = new Date().toISOString()
    let [found] = await g.read(
      and(...open, eq('bug.fault', fault), want('doc')),
    )
    if (found) {
      // Already counted: this handler ran for this failure before.
      if (comp(await one(g, edgeEid(found.entity.eid, 'about', eid)), 'edge')) {
        return
      }
      let hits = Number(comp(found, 'bug')?.hits ?? 1) + 1
      let body = str(comp(found, 'doc')?.body)
      await g.apply([
        {
          entity: { eid: found.entity.eid },
          bug: { hits, last: at },
          doc: { body: recurred(body, hits, at) },
        },
        link(found.entity.eid, 'about', eid),
      ], { trusted: true })
      return fix(found.entity.eid)
    }
    let who = human(g.vocab)(row)
    let project = await owner(row)
    let quoted = message.split('\n').map((l) => `> ${l}`).join('\n')
    let bug = uuid()
    await g.apply([
      {
        entity: { eid: bug },
        doc: {
          title: `${kind} exception: ${message.split('\n')[0]}`.slice(0, 100),
          body: `Filed by @yaks/heal.\n\n**${who}** (${kind}) raised:\n\n` +
            `${quoted}\n` +
            (x.stack ? `\n\`\`\`\n${x.stack}\n\`\`\`\n` : '') +
            `\nBroken entity: ${who} · caught ${str(x.at) || at}`,
        },
        task: {},
        filed: { priority: severity(message), ...(project ? { project } : {}) },
        bug: { fault, hits: 1, last: at },
      },
      link(bug, 'about', eid),
    ], { trusted: true })
  }

  return [{
    comp: 'exception',
    created: (e) => file(e.entity.eid),
    doc: 'file an unexpected failure as a task, one per fault',
  }, {
    comp: 'bug',
    created: (e) => fix(e.entity.eid),
    // Idempotent: a bug that has a fixer, or is held, starts nothing.
    sweep: { pending: '.bug !completed !cancelled !claim' },
    doc: 'start a fixer on a new bug, behind the gates',
  }, {
    comp: 'exit',
    // A fixer's process ended: its slot is free for a bug the cap held back.
    created: async (e) => {
      if (comp(await one(g, e.entity.eid), 'fixer')) await retry()
    },
    doc: 'when a fixer exits, try the bugs the gates held back',
  }]
}
