// A developer's own machine runs the sessions its space asks of it (D-470).
//
// The space keeps the machine, and a provider for each CLI the machine lends:
// `provider{name, transport: 'process', api, machine}`. A session asked of one
// is what `session_spawn` writes for any provider, so anyone who can spawn can
// ask the machine. The machine's runner (./runner.ts) dials out to the space:
// it takes the next session asked of it (`session_take`), runs it with its own
// CLI, and hands back what the CLI prints, line by line (`session_log`). The
// space reads those lines into the transcript as the importer reads a log
// (@yaks/session `imported`), and writes the run's ending and its report as
// ./run.ts and ./completion.ts do on a host that runs the CLI itself.
//
// A machine is its owner's: its eid is derived from who registered it and the
// name they gave it, so a caller names only machines of their own, and a
// session's lines are taken only from the owner of the machine it was asked
// of. Nothing here reads a disk or starts a process, so a Worker imports it.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph/identity'
import { argsOf, who } from '@yaks/graph/call'
import { Stale } from '@yaks/graph/errors'
import { signed } from '@yaks/graph/provenance'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { line } from '@yaks/query'
import { token } from '@yaks/graph/sha256'
import {
  firstRequest,
  imported,
  latestRequest,
  readers,
  requested,
  SESSION,
  told,
  unanswered,
} from '@yaks/session'
import { EXIT, PROCESS } from '@yaks/process/vocab'
import { CallError } from '@yaks/tools/errors'
import { adapters } from './adapters.ts'
import { type Asked, asked, carry, going, proc } from './asked.ts'
import { continuing } from './brief.ts'
import { complete } from './completion.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let str = (v: unknown): string => v == null ? '' : String(v)
let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.get([eid]))[0]

/** The machine `person` registered under `name`.
 *
 * ```ts
 * import { machineOf } from '@yaks/spawn/machines'
 * import { equal } from '@yaks/testing'
 *
 * equal(machineOf('U-1', 'mbp'), machineOf('U-1', 'mbp'))
 * equal(machineOf('U-1', 'mbp') == machineOf('U-2', 'mbp'), false)
 * ```
 */
export let machineOf = (person: string, name: string): string =>
  derivedEid(`machine ${person} ${name}`)

/** What a provider a machine lends is called: its CLI, on the machine.
 *
 * ```ts
 * import { lent } from '@yaks/spawn/machines'
 * import { equal } from '@yaks/testing'
 *
 * equal(lent('claude', 'mbp'), 'claude on mbp')
 * ```
 */
export let lent = (cli: string, machine: string): string =>
  `${cli} on ${machine}`

/** What a machine is handed to run: the job its CLI's command line is built
 * from (./adapters.ts `Job`), and the CLI that runs it. */
export type Handed =
  & Pick<
    Asked,
    'session' | 'model' | 'effort' | 'instruction' | 'thread' | 'bare'
  >
  & {
    /** the CLI, which names its adapter */
    cli: string
    /** the session, by its short id */
    name: string
  }

/**
 * Register `name` as a machine of `person`, lending `clis`: the machine row
 * and a provider for each CLI. Registering again changes nothing; a CLI it no
 * longer lends keeps its provider, which nothing new is asked of while the
 * runner does not take it.
 */
export let register = (
  person: string,
  name: string,
  clis: string[],
): Bundle[] => {
  let machine = machineOf(person, name)
  return [
    { entity: { eid: machine }, machine: {}, doc: { title: name } },
    ...clis.map((cli) => ({
      entity: { eid: identityEid('provider', [lent(cli, name)]) },
      provider: {
        name: lent(cli, name),
        transport: 'process',
        api: cli,
        machine,
      },
    })),
  ]
}

// The sessions asked of a machine's providers, each once, in the order the
// store keeps their requests.
let askedOf = async (g: Graph, machine: string): Promise<string[]> => {
  let providers = await g.read(
    line`.provider.machine=${machine}&.fields=entity.eid`,
  )
  let seen = new Set<string>()
  for (let p of providers) {
    let entries = await g.read(
      line`.entry&.using.provider=${p.entity.eid}&!ask&!lines&.fields=entry`,
    )
    for (let e of entries) seen.add(str(comp(e, 'entry')?.session))
  }
  seen.delete('')
  return [...seen]
}

// What a session asks of its machine now, or null: nothing new asked, a run
// still going, a stop, or a CLI no adapter speaks.
let owed = async (g: Graph, session: string): Promise<Asked | null> => {
  let row = await one(g, session)
  if (!row || row.stop || going(row)) return null
  let job = await asked(g, session)
  if (!job || !adapters[job.speaks]) return null
  if (!row[PROCESS]) return job
  // A session that ran before carries on its CLI's thread, given what it was
  // told since; one whose CLI never began a thread, given everything.
  if (!await requested(g, session)) return null
  let thread = comp(row, SESSION)?.id
  let said = thread == null
    ? await told(g, session)
    : await unanswered(g, session)
  let carried = carry(row, job, said)
  if (!carried) return null
  let briefs = await continuing(g, session)
  return {
    ...carried,
    instruction: [...briefs, carried.instruction].join('\n\n'),
  }
}

/**
 * Take the oldest session asked of `machine` and not yet run: mark it taken,
 * as a run launched by its CLI (`process{command}`), and answer what to run.
 * Undefined when nothing is asked of it.
 */
export let take = async (
  g: Graph,
  machine: string,
  actor: { by: string; via?: string },
): Promise<Handed | undefined> => {
  for (let session of await askedOf(g, machine)) {
    let job = await owed(g, session).catch(() => null)
    if (!job) continue
    let row = await one(g, session)
    let was = proc(row)
    try {
      await g.apply(signed([{
        entity: { eid: session },
        [PROCESS]: { pid: null, command: job.speaks, cwd: null },
        [EXIT]: null,
        brief: null,
        $was: {
          [EXIT]: { code: token(comp(row, EXIT)?.code) },
          [PROCESS]: { command: token(was?.command) },
        },
      }], actor))
    } catch (e) {
      if (e instanceof Stale) continue
      throw e
    }
    return {
      session,
      name: human(g.vocab)(row!),
      cli: job.speaks,
      instruction: job.instruction,
      ...job.model ? { model: job.model } : {},
      ...job.effort ? { effort: job.effort } : {},
      ...job.thread ? { thread: job.thread } : {},
      ...job.bare ? { bare: true } : {},
    }
  }
}

// The CLI a session's run speaks, where it was asked of `machine`.
let speaker = async (
  g: Graph,
  session: string,
  machine: string,
): Promise<string | undefined> => {
  let request = await firstRequest(g, session)
  let provider = comp(
    await one(g, str(comp(request, 'using')?.provider)),
    'provider',
  )
  if (!provider || provider.machine != machine) return
  return str(provider.api ?? provider.name)
}

/** What a machine hands back of a run: its CLI's output lines from `from`,
 * its pid once launched, and its exit code once it ended (`null` for an end
 * whose code was not seen). */
export type Logged = {
  lines?: string[]
  from?: number
  pid?: number
  exit?: number | null
}

/**
 * Read what a machine hands back of a session's run into the transcript, and
 * on its exit, end the run as ./run.ts does: the exit, an ending entry after
 * the request it answered (failed, where the CLI exited other than 0), and
 * its report on the task it holds (./completion.ts). A line that is not JSON,
 * or that the CLI's reader makes nothing of, writes nothing.
 */
export let log = async (
  g: Graph,
  machine: string,
  session: string,
  got: Logged,
  actor: { by: string; via?: string },
): Promise<void> => {
  let cli = await speaker(g, session, machine)
  if (!cli) {
    throw new CallError('session', `${session} was not asked of this machine`)
  }
  let read = readers[cli]
  let from = got.from ?? 0
  let rows = (got.lines ?? []).flatMap((text, i) => {
    let event: unknown
    try {
      event = JSON.parse(text)
    } catch {
      return []
    }
    if (!event || typeof event != 'object') return []
    return imported(read(event as Record<string, unknown>), {
      session,
      line: from + i,
    }).filter((b) => !b.rate_limit)
  })
  if (got.pid != null) {
    rows.push({ entity: { eid: session }, [PROCESS]: { pid: got.pid } })
  }
  if (rows.length) await g.apply(signed(rows, actor), { trusted: true })
  if (got.exit === undefined) return
  let code = got.exit
  let request = await latestRequest(g, session)
  await g.apply(
    signed([
      {
        entity: { eid: session },
        [EXIT]: code == null ? {} : { code },
      },
      {
        entity: {
          eid: derivedEid(
            `spawn ending ${session} ${request?.entity.eid ?? ''}`,
          ),
        },
        entry: { session },
        ...request ? { ask: { through: request.entity.eid } } : {},
        stop: {},
        ...code === 0 ? {} : {
          failed: {
            reason: code == null
              ? 'Provider exit was not observed'
              : `Provider exited ${code}`,
          },
          content: {
            body: code == null
              ? 'the runner lost the provider before it saw its exit'
              : `the provider exited ${code}`,
          },
          output: { source: session },
        },
      },
    ], actor),
    { trusted: true },
  )
  await complete(g, session)
}

let said = (call: Bundle, body: string): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  content: { body },
  output: { source: call.entity.eid },
})

// Whose machine a call names: the person it is signed by.
let caller = (call: Bundle): { by: string; via?: string } => {
  let actor = who(call)
  if (!actor?.by) {
    throw new CallError('actor', 'a machine is its owner’s: sign in')
  }
  return {
    by: String(actor.by),
    ...actor.via ? { via: String(actor.via) } : {},
  }
}

let named = (args: Record<string, unknown>): string => {
  let name = str(args.machine).trim()
  if (!name) throw new CallError('machine', 'name the machine')
  return name
}

/** The tools a machine's runner calls, each as the person whose machine it
 * is. */
export let runs = (): Runs => ({
  machine_register: async (call, graph) => {
    let args = argsOf(call)
    let actor = caller(call)
    let name = named(args)
    let clis = (Array.isArray(args.clis) ? args.clis : []).map(str)
    let unknown = clis.filter((c) => !adapters[c])
    if (unknown.length) {
      throw new CallError(
        'clis',
        `no adapter runs ${unknown.join(', ')}: a machine lends ` +
          Object.keys(adapters).join(' or '),
      )
    }
    let rows = register(actor.by, name, clis)
    // A provider's name is the space's: one another person's machine holds
    // under this name is theirs.
    let held = await graph.get(rows.slice(1).map((b) => b.entity.eid))
    let theirs = held.find((b) =>
      b && comp(b, 'provider')?.machine != rows[0].entity.eid
    )
    if (theirs) {
      throw new CallError(
        'machine',
        `${str(comp(theirs, 'provider')?.name)} is another machine's: ` +
          'name this one differently',
      )
    }
    await graph.apply(signed(rows, actor))
    return [said(
      call,
      JSON.stringify({
        machine: rows[0].entity.eid,
        providers: Object.fromEntries(
          clis.map((c, i) => [c, rows[i + 1].entity.eid]),
        ),
      }),
    )]
  },

  session_take: async (call, graph) => {
    let actor = caller(call)
    let machine = machineOf(actor.by, named(argsOf(call)))
    let handed = await take(graph, machine, actor)
    return [said(call, handed ? JSON.stringify(handed) : '')]
  },

  session_log: async (call, graph) => {
    let args = argsOf(call)
    let actor = caller(call)
    let machine = machineOf(actor.by, named(args))
    let session = str(args.session)
    let exit = args.exit === undefined
      ? undefined
      : args.exit == null
      ? null
      : Number(args.exit)
    await log(graph, machine, session, {
      lines: Array.isArray(args.lines) ? args.lines.map(str) : [],
      from: Number(args.from ?? 0),
      ...args.pid == null ? {} : { pid: Number(args.pid) },
      ...exit === undefined ? {} : { exit },
    }, actor)
    return [said(call, exit === undefined ? 'logged' : 'ended')]
  },
})
