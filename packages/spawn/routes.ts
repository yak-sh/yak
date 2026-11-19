// The routes facet, exported as `@yaks/spawn/routes`: where another host asks
// this machine to run an agent, `POST /session/spawn` with a brief, and to
// stop one it asked for, `POST /session/stop` with its session. The brief
// is filed as a task (`task_new`) and an agent is started on it
// (`session_spawn`), both called as whoever the host says is asking, the way a
// door calls any tool: through a tunnel, that is the persona the tunnel's
// config names, through the session standing for the conversation the request
// came from (@yaks/tunnel/routes `arrived`). So the run's final report knocks
// that session (./completion.ts), and the knock goes back to the conversation
// the way any news for it does (@yaks/tunnel/effects). A stop is
// `session_stop`, called the same way, on a run the session it comes through
// started: a host stops only what it asked for.
//
// The route says nothing of who may ask, as @yaks/harness's `/model/step`
// says nothing: a machine opens it the way it opens any path, such as
// @yaks/tunnel's `callers.operator.routes`. A request nobody is named for is
// refused.

import type { Authenticate, Route } from '@yaks/api'
import type { Actor, Bundle, Comp, Graph } from '@yaks/graph'
import { mint } from '@yaks/graph/identity'
import { human } from '@yaks/id'
import type { Runner } from '@yaks/tools'
import { answerOf, faultOf, toolEid } from '@yaks/tools/result'

/** Where another host asks this machine for an agent. */
export const PATH = '/session/spawn'

/** Where another host asks this machine to stop an agent it asked for. */
export const STOP = '/session/stop'

/** What a config file can set for this facet. */
export type Options = {
  /** the provider a run asked for here uses, by name (default `claude`) */
  provider?: string
}

/** What another host sends: what the agent is to do, a short name for it, and
 * the model, by a name this machine knows, where it is not the provider's
 * own. */
export type Asked = { brief: string; title?: string; model?: string }

/** What this machine answers: the task it filed the brief as and the session
 * running it, each by eid and short id. */
export type Spawned = {
  task: string
  session: string
  names: { task: string; session: string }
}

/** What another host sends to stop a run: its session, by eid here. */
export type Stopping = { session: string }

/** What this facet reads off the host: the graph, who a request is from, and
 * the runner its tools are called through. */
export type Hosting = { graph: Graph; who: Authenticate; runner?: Runner }

let refused = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

let str = (v: unknown) => typeof v == 'string' ? v.trim() : ''

/** `POST /session/spawn`: the brief filed as a task and an agent started on
 * it, answered at once with both ({@link Spawned}). `POST /session/stop`: the
 * run of a session the caller started, asked to stop, answered with it. */
export let routes = (host: Hosting, options: Options = {}): Route[] => [{
  method: 'POST',
  path: PATH,
  handle: asking(host, async (call, asked: Partial<Asked>) => {
    let brief = str(asked.brief)
    if (!brief) return refused(400, 'arguments', 'give the agent a brief')
    return Response.json(
      await spawn(host.graph, call, {
        brief,
        title: str(asked.title) || brief.split('\n')[0].slice(0, 120),
        model: str(asked.model),
      }, options.provider ?? 'claude'),
    )
  }),
}, {
  method: 'POST',
  path: STOP,
  handle: asking(host, async (call, asked: Partial<Stopping>, actor) => {
    let session = str(asked.session)
    let [row] = session ? await host.graph.get([session], ['spawned']) : []
    let parent = (row?.spawned as Comp | undefined)?.parent
    if (!parent || parent != actor.via) {
      return refused(404, 'missing', `no run ${session} was asked for here`)
    }
    await call('session_stop', { session })
    return Response.json({ session })
  }),
}]

class Fault extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

// A tool called as whoever asked, answered with what it wrote.
type Call = (tool: string, args: Record<string, unknown>) => Promise<Bundle[]>

// A request answered with what it sent, its tools called as whoever the host
// says asks; a tool's refusal is the request's.
let asking = <T>(
  host: Hosting,
  answer: (call: Call, asked: Partial<T>, actor: Actor) => Promise<Response>,
) =>
async (request: Request) => {
  let actor = await host.who(request)
  if (!actor?.by && !actor?.via) {
    return refused(403, 'nobody', 'an agent is run for somebody')
  }
  let asked = await request.json().catch(() => ({})) as Partial<T>
  if (!host.runner) return refused(503, 'tools', 'this host runs no tools')
  try {
    return await answer(caller(host.runner, actor), asked, actor)
  } catch (e) {
    if (!(e instanceof Fault)) throw e
    return refused(422, e.code, e.message)
  }
}

// A tool called through `runner` as `actor`, answered with what it wrote, or
// a {@link Fault} saying why it refused.
let caller = (runner: Runner, actor: Actor): Call => async (tool, args) => {
  await runner.ensure([tool])
  let id = mint()
  let landed = await runner.call({
    entity: { eid: id },
    call: { to: toolEid(tool), args },
    $actor: { ...actor },
  })
  let fault = faultOf(landed, id)
  if (fault) {
    throw new Fault(
      String((fault.refusal as Comp | undefined)?.code ?? tool),
      String((fault.content as Comp | undefined)?.body ?? tool),
    )
  }
  return answerOf(landed, id)
}

let spawn = async (
  graph: Graph,
  call: Call,
  asked: Required<Asked>,
  provider: string,
): Promise<Spawned> => {
  let made = await call('task_new', { title: asked.title, body: asked.brief })
  let task = made.find((b) => b.task)?.entity.eid
  if (!task) throw new Error('task_new answered no task')
  await call('session_spawn', {
    task,
    provider,
    ...asked.model ? { model: asked.model } : {},
  })
  let [row] = await graph.get([task], ['claim'])
  let session = String((row?.claim as Comp | undefined)?.session ?? '')
  if (!session) throw new Error(`session_spawn left ${task} unclaimed`)
  let name = human(graph.vocab)
  let rows = new Map<string, Bundle>(
    (await graph.get([task, session])).map((b) => [b.entity.eid, b]),
  )
  return {
    task,
    session,
    names: { task: name(rows.get(task)!), session: name(rows.get(session)!) },
  }
}
