// What a session asks of a command-line run, read from the graph alone: the
// request, the provider and the model it names, and what a run that carries on
// is given. It touches no disk and no process, so a host that runs nothing
// itself (yaks.app, handing a run to its developer's machine, ./machines.ts)
// reads a request the way ./run.ts does.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { edgeEid } from '@yaks/edge'
import { firstInput, firstRequest, SESSION } from '@yaks/session'
import { EXIT, PROCESS } from '@yaks/process/vocab'
import type { Process } from '@yaks/process'
import type { Job } from './adapters.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.get([eid]))[0]

export let proc = (row: Bundle | undefined) =>
  comp(row, PROCESS) as Process | undefined

// A run going: launched (it has a pid, or the command line of a wrapper that
// never reported one) and not over.
/** A run going: launched and not over. */
export let going = (row: Bundle | undefined): boolean => {
  let p = proc(row)
  return !!p && row![EXIT] == null && (p.pid != null || p.command != null)
}

/** What a session was asked for, as the graph holds it. */
export type Asked = Job & {
  /** the provider's name */
  provider: string
  /** the CLI it speaks, which is what names an adapter: its `provider.api`,
   * else its own name */
  speaks: string
  /** the program it is run as, where its row names one (`provider.command`)
   * in place of the adapter's own */
  command?: string
  /** its runs play recordings (`provider.recorded`): how one ends is chosen,
   * so no ending of one is a failure */
  recorded?: true
  /** the ask a turn of this run answers (@yaks/session `ask`): the model
   * entity, and the request entry it was asked through */
  ask: Comp
  /** the account its CLI signs in with (@yaks/model `account`), where the
   * request names one or a first run was given one ({@link accountFor}) */
  account?: Account
}

/** An account a run signs in with: its row, and its directory. */
export type Account = { eid: string; home: string }

// The efforts a model accepts, space- or comma-separated. An empty list allows
// anything: a provider with no effort setting cannot reject one.
let levels = (efforts: unknown): string[] =>
  String(efforts ?? '').split(/[\s,]+/).filter(Boolean)

/** What `provider` calls `model`: the name on its `serves` edge, or nothing
 * when the provider does not serve that model. */
export let spelling = async (
  g: Graph,
  provider: string,
  model: string,
): Promise<string | undefined> => {
  let [edge] = await g.get([edgeEid(provider, 'serves', model)])
  let name = comp(edge, 'serves')?.name
  return name == null ? undefined : String(name)
}

/** An entry that asks for a managed turn. Imported selections and served
 * asks describe history; neither requests another process. */
export let requestOf = (b: Bundle | undefined): Bundle | undefined =>
  b?.entry && b.using && !b.lines && !b.ask ? b : undefined

/**
 * Read a session's request out of its transcript: the `using` component on the
 * first entry that has one, and the instruction text stored with it. A request
 * that names a provider alone runs the model on the provider's own
 * `using{model}`, so the run is told its model and its asks name it; a CLI
 * left to its own default reports no model to price.
 *
 * ```ts
 * import { asked } from '@yaks/spawn'
 *
 * // let job = await asked(graph, 'S-1…')
 * ```
 *
 * `null` when nothing asked for a provider — an ordinary transcript somebody
 * else is driving.
 */
export let asked = async (
  g: Graph,
  session: string,
): Promise<Asked | null> => {
  let [owner] = await g.get([session])
  if (owner?.native) return null
  let request = await firstRequest(g, session)
  if (!request) return null
  let using = comp(request, 'using')!
  if (!using.provider) return null
  let [provider] = await g.get([String(using.provider)])
  let row = comp(provider, 'provider')
  if (row?.transport == 'http' || row?.transport == 'machine') return null
  let name = String(row?.name ?? '')
  if (!name) return null
  let chosen = String(using.model ?? comp(provider, 'using')?.model ?? '')
  let [model] = chosen ? await g.get([chosen]) : []
  let served = comp(model, 'model')
  let spelled = served
    ? await spelling(g, String(using.provider), chosen)
    : undefined
  // A request and a provider that name no model leave it to the CLI's own
  // default: on a developer's machine, the model they chose for it.
  if (chosen && (!served || spelled == null)) {
    throw new Error(`${name} has no served model: ${chosen}`)
  }
  let effort = String(using.effort ?? served?.effort ?? '')
  let admits = levels(served?.efforts)
  if (effort && admits.length && !admits.includes(effort)) {
    throw new Error(
      `unknown effort: ${effort} — ${name} serves ${admits.join(', ')}`,
    )
  }
  // The instruction is the prose the request came with; a request stated on an
  // entry of its own takes the transcript's first input instead.
  let said = comp(request, 'content') ??
    comp(await firstInput(g, session), 'content')
  // `sending{tools}` names exactly the tools a turn is offered (@yaks/session),
  // and a list naming none offers none.
  let tools = comp(request, 'sending')?.tools
  let account = using.account
    ? await accountOf(g, String(using.account))
    : undefined
  return {
    provider: name,
    speaks: String(row?.api ?? name),
    ...row?.command ? { command: String(row.command) } : {},
    ...row?.recorded ? { recorded: true as const } : {},
    session,
    ...spelled ? { model: spelled } : {},
    effort: effort || undefined,
    ...Array.isArray(tools) && !tools.length ? { bare: true } : {},
    instruction: String(said?.body ?? ''),
    ask: {
      ...chosen ? { to: chosen } : {},
      through: request.entity.eid,
    },
    ...account ? { account } : {},
  }
}

// The account a request names, which must still be one offered to runs: the
// box's default login is never one.
let accountOf = async (g: Graph, eid: string): Promise<Account> => {
  let a = comp(await one(g, eid), 'account')
  if (!a?.home) throw new Error(`${eid} names no account`)
  if (a.offered !== true) throw new Error(`${a.home} is not offered to runs`)
  return { eid, home: String(a.home) }
}

/**
 * The accounts of a CLI's provider offered to runs (`account{offered}`), the
 * only ones a spawn signs in with: one never falls back to the box's default
 * login.
 *
 * ```ts
 * import { offeredTo } from '@yaks/spawn'
 *
 * // let rows = await offeredTo(graph, 'claude')
 * ```
 */
export let offeredTo = async (g: Graph, runner: string): Promise<Bundle[]> => {
  let provider = identityEid('provider', [runner])
  return (await g.read('.account *')).filter((b) => {
    let a = comp(b, 'account')
    return a?.offered === true && a.provider == provider && a.home
  })
}

/** Carry a session's job onto its next run: on the same provider thread,
 * given what it was told since its last run (@yaks/session `unanswered`); or,
 * for a session whose provider never began a thread, as a first run given
 * everything it was told (@yaks/session `told`). The caller supplies the
 * current session and that transcript. A run still going carries nothing;
 * starting the command must still take the session before it launches. */
export let carry = (
  row: Bundle,
  job: Asked,
  said: Bundle[],
): Asked | null => {
  let thread = comp(row, SESSION)?.id
  if (row.stop || going(row) || !said.some(requestOf)) return null
  return {
    ...job,
    ...since(said, job),
    ...thread == null ? {} : { thread: String(thread) },
  }
}

// What a run that carries on is given: everything said to the session since
// its last run was (@yaks/session `unanswered`), and the newest of it as the
// request its turns answer.
let since = (
  said: Bundle[],
  job: Asked,
): Pick<Asked, 'instruction' | 'ask'> => {
  return {
    instruction: said.map((b) => String(comp(b, 'content')?.body ?? ''))
      .join('\n\n'),
    ask: { ...job.ask, through: said.at(-1)!.entity.eid },
  }
}
