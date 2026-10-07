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

import {
  argsOf,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  identityEid,
  Refused,
  who,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import type { Host } from '@yaks/host'

import { MODEL, PROVIDER } from '@yaks/model'
import { parse } from '@yaks/query'
import { transcript, usingBefore } from '@yaks/session'
import { begin, seed, through } from './agent.ts'
import { defaultUsing, selectedUsing } from './model_selection.ts'
import { openaiCredential } from './openai_auth.ts'
import { hosted } from './store.ts'
import { homeAt, owing } from './session_machines.ts'
import { instructionsFor } from './instructions.ts'

type Args = Record<string, unknown>
let word = (args: Args, name: string): string | undefined => {
  let v = args[name]
  return typeof v == 'string' ? v : undefined
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
  for (;;) {
    let [self] = await graph.get([s], ['session'])
    let status = (self?.session as Comp | undefined)?.status
    if (!WORKING.includes(String(status)) || stopping?.aborted) {
      return (await transcript(graph, s)).slice(-1)
    }
    await new Promise((go) => setTimeout(go, 100))
  }
}

// Who called: what they asked a session is theirs (@yaks/tools signs the call
// with its caller).
let caller = (call: Bundle): Eid | undefined => {
  let by = (call.created as Comp | undefined)?.by
  return typeof by == 'string' ? by : undefined
}

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
  session_list: (_, graph) => graph.read(parse('.session&*')),
  session_new: async (call, graph) => {
    let args = argsOf(call)
    let prompt = word(args, 'prompt')
    if (!prompt && args.tui !== true) {
      throw new Refused('session new needs a prompt without --tui')
    }
    let provider = word(args, 'provider') ?? 'openai'
    let selected = word(args, 'model')
      ? undefined
      : await defaultUsing(graph, provider)
    let [row] = selected ? await graph.get([String(selected.model)]) : []
    let model = word(args, 'model') ?? String((row?.model as Comp)?.name)
    await graph.apply(seed({ provider, model }), { trusted: true })
    let effort = word(args, 'effort')
    let persona = word(args, 'persona')
    let home = homeAt(word(args, 'machine'), word(args, 'cwd'))
    let files = await instructionsFor(graph, host?.machines, home)
    let s = await begin(graph, prompt || undefined, {
      home,
      files: [...files, ...await owing(graph, home, files, persona)],
      ...persona ? { persona } : {},
      by: caller(call),
      via: who(call)?.via,
      using: {
        provider: identityEid(PROVIDER, [provider]),
        model: identityEid(MODEL, [model]),
        ...effort ? { effort } : {},
      },
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
      let [p, m] = await graph.get([
        String(prior?.provider ?? ''),
        String(prior?.model ?? ''),
      ])
      provider ??= model
        ? 'openai'
        : String((p?.provider as Comp | undefined)?.name ?? 'openai')
      model ??= String((m?.model as Comp | undefined)?.name ?? '')
      if (!model) throw new Refused('Choose a model')
      await graph.apply(seed({ provider, model }), { trusted: true })
      using = {
        ...prior,
        provider: identityEid(PROVIDER, [provider]),
        model: identityEid(MODEL, [model]),
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
