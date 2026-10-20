// The functions behind the harness's own tools, exported as
// `@yaks/harness/tools`: the facet a `yak` host takes from the harness when a
// config lists it as a plugin (@yaks/cli `compose`), beside every other
// package's.
//
// `session_new` and `session_send` write a line that asks a transcript for a
// turn, and wait for the reply: the entry the transcript settles on. Neither
// runs the transcript. The runner does, wherever the host's effects are
// worked (./effects.ts): a box's `yak serve`, or another process explicitly
// serving the effects role. Drawing the reply is the caller's: a line
// on a command line, the harness itself under `--tui` (./view.ts).
// `model_list` lists the OpenAI endpoint's catalog through the credential the
// harness uses. A tool answers, it does not write to a terminal.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { identityEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import type { Host } from '@yaks/host'

import { MODEL, PROVIDER } from '@yaks/model'
import { parse } from '@yaks/query'
import { transcript, usingBefore } from '@yaks/session'
import { changes } from '@yaks/session/wait'
import { begin, seed, through } from './agent.ts'
import { defaultUsing, selectedUsing } from './model_selection.ts'
import { openaiCredential } from './openai_auth.ts'
import { hosted } from './store.ts'
import { homeAt } from './session_machines.ts'
import { conversations } from './conversations.ts'
import { instructionsFor } from './instructions.ts'
import { sessionHome } from '@yaks/machine/targets'

type Args = Record<string, unknown>
let word = (args: Args, name: string): string | undefined => {
  let v = args[name]
  return typeof v == 'string' ? v : undefined
}

let nameOf = (row: Bundle | undefined, comp: string) =>
  (row?.[comp] as Comp | undefined)?.name as string | undefined

// The `using` a call asks for by provider and model name, its rows seeded. A
// model named alone is asked wherever it is served, and only one nothing
// serves yet goes to the default's provider (./model_selection.ts); a
// provider named alone takes the default model only where it is the
// default's.
let named = async (
  graph: Graph,
  provider?: string,
  model?: string,
): Promise<Comp> => {
  if (!provider && !model) return await defaultUsing(graph)
  if (!provider) {
    let eid = identityEid(MODEL, [model!])
    let served = await graph.read(`.serves .edge.to=${eid} .limit=1`)
    if (served.length) return { model: eid }
  }
  let fallback = provider && model ? undefined : await defaultUsing(graph)
  let [p, m] = fallback
    ? await graph.get([String(fallback.provider), String(fallback.model)])
    : []
  if (provider && !model && provider != nameOf(p, PROVIDER)) {
    throw new Refused(`Choose a model for ${provider}`)
  }
  provider ??= nameOf(p, PROVIDER)!
  model ??= nameOf(m, MODEL)!
  await graph.apply(seed({ provider, model }), { trusted: true })
  return {
    provider: identityEid(PROVIDER, [provider]),
    model: identityEid(MODEL, [model]),
  }
}

// What a session is doing while it is still working: owing a turn, owing a
// tool's answer, or waiting for a place to run.
let WORKING = ['pending', 'running', 'queued']

// Wait for the reply: once the session's own computed status (@yaks/session
// status.ts, one statement over the store) says it is no longer working, where
// it settled — the newest entry, which is the model's reply, or the error or
// stop it ended on. A host winding down stops waiting and answers the newest
// entry as it stands; the session goes on wherever it runs.
let settled = async (
  graph: Graph,
  s: Eid,
  stopping?: AbortSignal,
): Promise<Bundle[]> => {
  for await (let done of changes(graph, { signal: stopping })) {
    let [self] = await graph.get([s], ['session'])
    let status = (self?.session as Comp | undefined)?.status
    if (!WORKING.includes(String(status)) || done) {
      return (await transcript(graph, s)).slice(-1)
    }
  }
  throw new Error('wait ended without a final read')
}

// Who called: what they asked a session is theirs (@yaks/tools signs the call
// with its caller).
let caller = (call: Bundle): Eid | undefined => who(call)?.by

let text = (call: Bundle, body: string): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  content: { body },
  output: { source: call.entity.eid },
})

export let CODEX_CLIENT_VERSION = '0.157.1'
export { listing as modelCatalog } from '@yaks/openai'
import { listing as modelCatalog } from '@yaks/openai'
import type { Listed } from '@yaks/model'
export type { Listed } from '@yaks/model'

/** Give each listed model's row the window its catalog says, where the row
 * has none of its own: a window set by hand stands. Answers each listed
 * model with the window its row now has. */
export let windows = async (
  graph: Graph,
  models: Listed[],
): Promise<Listed[]> => {
  let eids = models.map((m) => identityEid(MODEL, [m.name]))
  let rows = new Map(
    (await graph.get(eids, [MODEL])).map((b) => [b.entity.eid, b[MODEL]]),
  )
  let own = (i: number) =>
    Number((rows.get(eids[i]) as Comp | undefined)?.context) || undefined
  let filled = models.flatMap((m, i) =>
    rows.get(eids[i]) && !own(i) && m.context
      ? [{ entity: { eid: eids[i] }, [MODEL]: { context: m.context } }]
      : []
  )
  if (filled.length) await graph.apply(filled, { trusted: true })
  return models.map((m, i) => ({ name: m.name, context: own(i) ?? m.context }))
}

/** The functions behind the tools the harness declares (./vocab.json). */
export let runs = (host?: Host): Runs => ({
  ...conversations(host),
  session_home: async (call, graph) => {
    let args = argsOf(call)
    return await sessionHome(
      graph,
      String(args.session),
      String(args.workspace),
      word(args, 'cwd'),
    )
  },
  session_list: (_, graph) => graph.read(parse('.session&*')),
  session_new: async (call, graph) => {
    let args = argsOf(call)
    let prompt = word(args, 'prompt')
    if (!prompt && args.tui !== true) {
      throw new Refused('session new needs a prompt without --tui')
    }
    let using = await named(graph, word(args, 'provider'), word(args, 'model'))
    let effort = word(args, 'effort')
    let persona = word(args, 'persona')
    let work = word(args, 'work')
    let home = args.workspace
      ? {
        workspace: String(args.workspace),
        ...args.cwd ? { cwd: String(args.cwd) } : {},
      }
      : homeAt(undefined, word(args, 'cwd'))
    let id = crypto.randomUUID()
    let files = await instructionsFor(
      graph,
      home,
      host?.workspaces,
      { persona, work },
    )
    let s = await begin(graph, prompt || undefined, {
      eid: id,
      home,
      files,
      work,
      ...persona ? { persona } : {},
      by: caller(call),
      via: who(call)?.via,
      using: { ...using, ...effort ? { effort } : {} },
    })
    return prompt
      ? await settled(graph, s, host?.stopping)
      : await graph.get([s])
  },
  session_send: async (call, graph) => {
    let args = argsOf(call)
    // The session arrives as its eid: @yaks/tools resolved what was typed (an
    // eid, `S-81`, a run's own id) and refused one that names no session.
    let s = String(args.session)
    let prior = usingBefore(await transcript(graph, s)) ??
      await selectedUsing(graph, s)
    let provider = word(args, 'provider')
    let model = word(args, 'model')
    let using = prior
    if (provider || model || !prior?.model) {
      // A provider named alone keeps the model in force.
      let [p, m] = await graph.get([
        String(prior?.provider ?? ''),
        String(prior?.model ?? ''),
      ])
      using = {
        ...prior?.effort ? { effort: prior.effort } : {},
        ...await named(
          graph,
          provider ?? (model ? undefined : nameOf(p, PROVIDER)),
          model ?? nameOf(m, MODEL),
        ),
      }
    }
    await graph.apply([{
      entity: { eid: crypto.randomUUID() },
      entry: { session: s },
      content: { body: String(args.text) },
      ...using ? { using } : {},
      $actor: through(s, caller(call)),
    }])
    return await settled(graph, s, host?.stopping)
  },
  model_list: async (call, graph) => {
    if (!host) throw new Error('model list needs a host')
    let auth = openaiCredential(hosted(host))
    let cred = await auth.credential()
    let models = await windows(
      graph,
      await modelCatalog(cred, fetch, auth.refresh),
    )
    return [text(
      call,
      [
        `models from ${cred.base}`,
        ...models.map(({ name, context }) =>
          `  ${name}` + (context ? `  ${context} tokens` : '')
        ),
      ].join('\n'),
    )]
  },
})
