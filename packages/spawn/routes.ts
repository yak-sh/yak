// The routes facet, exported as `@yaks/spawn/routes`: where another host asks
// this machine to run an agent, `POST /session/spawn` with a brief. The brief
// is filed as a task (`task_new`) and an agent is started on it
// (`session_spawn`), both called as whoever the host says is asking, the way a
// door calls any tool: through a tunnel, that is the persona the tunnel's
// config names, through the session standing for the conversation the request
// came from (@yaks/tunnel/routes `arrived`). So the run's final report knocks
// that session (./completion.ts), and the knock goes back to the conversation
// the way any news for it does (@yaks/tunnel/effects).
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

/** What this facet reads off the host: the graph, who a request is from, and
 * the runner its tools are called through. */
export type Hosting = { graph: Graph; who: Authenticate; runner?: Runner }

let refused = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

let str = (v: unknown) => typeof v == 'string' ? v.trim() : ''

/** `POST /session/spawn`: the brief filed as a task and an agent started on
 * it, answered at once with both ({@link Spawned}). */
export let routes = (host: Hosting, options: Options = {}): Route[] => [{
  method: 'POST',
  path: PATH,
  handle: async (request) => {
    let actor = await host.who(request)
    if (!actor?.by && !actor?.via) {
      return refused(403, 'nobody', 'an agent is started for somebody')
    }
    let asked = await request.json().catch(() => ({})) as Partial<Asked>
    let brief = str(asked.brief)
    if (!brief) return refused(400, 'arguments', 'give the agent a brief')
    if (!host.runner) return refused(503, 'tools', 'this host runs no tools')
    try {
      let spawned = await spawn(host as Required<Hosting>, actor, {
        brief,
        title: str(asked.title) || brief.split('\n')[0].slice(0, 120),
        model: str(asked.model),
      }, options.provider ?? 'claude')
      return Response.json(spawned)
    } catch (e) {
      if (!(e instanceof Fault)) throw e
      return refused(422, e.code, e.message)
    }
  },
}]

class Fault extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

let spawn = async (
  host: Required<Hosting>,
  actor: Actor,
  asked: Required<Asked>,
  provider: string,
): Promise<Spawned> => {
  let call = async (tool: string, args: Record<string, unknown>) => {
    await host.runner.ensure([tool])
    let id = mint()
    let landed = await host.runner.call({
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
  let made = await call('task_new', { title: asked.title, body: asked.brief })
  let task = made.find((b) => b.task)?.entity.eid
  if (!task) throw new Error('task_new answered no task')
  await call('session_spawn', {
    task,
    provider,
    ...asked.model ? { model: asked.model } : {},
  })
  let [row] = await host.graph.get([task], ['claim'])
  let session = String((row?.claim as Comp | undefined)?.session ?? '')
  if (!session) throw new Error(`session_spawn left ${task} unclaimed`)
  let name = human(host.graph.vocab)
  let rows = new Map<string, Bundle>(
    (await host.graph.get([task, session])).map((b) => [b.entity.eid, b]),
  )
  return {
    task,
    session,
    names: { task: name(rows.get(task)!), session: name(rows.get(session)!) },
  }
}
