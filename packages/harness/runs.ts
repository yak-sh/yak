// The functions behind the harness's own tools, exported as
// `@yaks/harness/tools`: the facet a `yak` host takes from the harness when a
// config lists it as a plugin (@yaks/cli `compose`), beside every other
// package's.
//
// `session_new` and `session_send` write a line that asks a transcript for a
// turn, and wait for the reply: the entry the transcript settles on. Neither
// runs the transcript. A session whose run goes on outside the graph gives no
// reply until that run ends, so a send to it knocks instead, and it hears the
// knock at its next tool call (@yaks/session's bus); a send that starts such a
// run again answers once it has started. The runner does, wherever the host's effects are
// worked (./effects.ts): a box's `yak serve`, or another process explicitly
// serving the effects role. Drawing the reply is the caller's: a line
// on a command line, the harness itself under `--tui` (./view.ts).
// `model_list` lists a configured provider's catalog, signed in as the
// harness signs in to it. A tool answers, it does not write to a terminal.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { identityEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import { edgeEid } from '@yaks/edge'
import { BEST, type Runs } from '@yaks/graph/tools'
import type { Host } from '@yaks/host'

import { MODEL, PROVIDER } from '@yaks/model'
import { and, conjoin, parse, stringify } from '@yaks/query'
import { newestOf, usingOf } from '@yaks/session'
import { changes } from '@yaks/session/wait'
import { begin, seed, through } from './agent.ts'
import { defaultUsing } from './default.ts'
import { selectedUsing } from './model_selection.ts'
import { configured, lending } from './providers.ts'
import { signins } from '@yaks/connections'
import * as systemProcess from '@yaks/process/system'
import { hosted } from './store.ts'
import { homeAt } from './session_machines.ts'
import { conversations } from './conversations.ts'
import { openingFor } from './instructions.ts'
import { ORACLE } from '@yaks/topic'
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
// serves yet goes to the default's provider (./default.ts); a
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

// The `using` a follow-up asks with: the one in force, changed only by what
// the send names. A provider named alone keeps the model in force, and a model
// named alone keeps the provider in force while it serves that model, so a
// session spawned on a command line goes on there.
let following = async (
  graph: Graph,
  prior: Comp | undefined,
  provider?: string,
  model?: string,
): Promise<Comp> => {
  if (!prior) return await named(graph, provider, model)
  let [p, m] = await graph.get([
    String(prior.provider ?? ''),
    String(prior.model ?? ''),
  ])
  let held = nameOf(p, PROVIDER)
  if (!model && (!provider || provider == held)) return prior
  if (model && !provider && prior.provider) {
    let edge = edgeEid(
      String(prior.provider),
      'serves',
      identityEid(MODEL, [model]),
    )
    let [served] = await graph.get([edge], ['serves'])
    if (served?.serves) provider = held
  }
  return await named(graph, provider, model ?? nameOf(m, MODEL))
}

// What a session is doing while it is still working: owing a turn, owing a
// tool's answer, or waiting for a place to run.
let WORKING = ['pending', 'running', 'queued']

// A transcript's newest entry, read alone: a reply to a long transcript never
// reads the rest of it.
let newest = async (graph: Graph, s: Eid): Promise<Bundle[]> => {
  let last = await newestOf(graph, s)
  return last ? [last] : []
}

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
      return await newest(graph, s)
    }
  }
  throw new Error('wait ended without a final read')
}

// Wait for the run a send asked a command to start: once its process is
// launched (@yaks/spawn stamps a pid and clears the last run's exit), the
// session as it stands, for that run gives no reply until it ends; one that
// failed to launch answers where it settled.
let begun = async (
  graph: Graph,
  s: Eid,
  stopping?: AbortSignal,
): Promise<Bundle[]> => {
  let comps = ['process', 'exit', 'session'].filter((c) => graph.vocab.comp(c))
  for await (let done of changes(graph, { signal: stopping })) {
    let [row] = await graph.get([s], comps)
    let status = (row?.session as Comp | undefined)?.status
    if ((row?.process as Comp | undefined)?.pid != null && !row?.exit) {
      return await graph.get([s])
    }
    if (!WORKING.includes(String(status)) || done) {
      return await newest(graph, s)
    }
  }
  throw new Error('wait ended without a final read')
}

// Whether a provider is a command its runs are processes of (@yaks/spawn).
let commanded = async (graph: Graph, using?: Comp): Promise<boolean> => {
  if (!using?.provider) return false
  let [p] = await graph.get([String(using.provider)], [PROVIDER])
  return (p?.[PROVIDER] as Comp | undefined)?.transport == 'process'
}

// A transcript's statuses once its run is over.
let OVER = ['stopped', 'failed']

// Whether a session's run goes on outside the graph: a command its provider
// runs (@yaks/spawn), started or about to be, or a harness that reads its own
// file. One that has ended is asked for its next run instead.
let outside = async (
  graph: Graph,
  s: Eid,
  using?: Comp,
): Promise<boolean> => {
  if (!graph.vocab.comp('knock')) return false
  let comps = ['native', 'process', 'exit', 'session']
  let [row] = await graph.get([s], comps.filter((c) => graph.vocab.comp(c)))
  let self = row?.session as Comp | undefined
  if (
    !row || row.native || row.exit || self?.ended == true ||
    OVER.includes(String(self?.status))
  ) return false
  return !!row.process || !!self?.transcript || await commanded(graph, using)
}

// Who called: what they asked a session is theirs (@yaks/tools signs the call
// with its caller).
let caller = (call: Bundle): Eid | undefined => who(call)?.by

let text = (call: Bundle, body: string): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  content: { body },
  output: { source: call.entity.eid },
})

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

// The sessions not over, the ones a caller most likely means: a graph holds
// tens of thousands of finished ones, more than one answer may hold. The mark
// answers this without reading an entry (@yaks/session/ended).
let LIVE = '.session !session.ended'
// What a row of the page carries: the session, its status among it, when and by
// whom it began, what it was spawned under, its title and how its process
// exited. Its command line and the sizes of its context are kilobytes each, so
// they are read from the session itself (`graph_show`), or by a query naming
// `*`.
let SHOWN = '?created ?spawned ?doc ?exit'

// One page of sessions, newest first unless the query orders them, and a last
// row saying how to read on when more match. The page reads one row past its
// size to learn that; a query with a `.limit` of its own has chosen its window
// and comes back as it asked.
let sessionList: Runs[string] = async (call, graph) => {
  let args = argsOf(call)
  let query = String(args.query ?? '').trim() || LIVE
  let size = Number(args.limit) > 0 ? Math.floor(Number(args.limit)) : BEST
  let rows = await graph.read(
    conjoin(
      '.session',
      query,
      '.order=-created.at',
      `.limit=${size + 1}`,
      SHOWN,
    ),
  )
  if (rows.length <= size) return rows
  let page = rows.slice(0, size)
  // The first `.after` of a query is the one it reads from, so the next page's
  // query replaces the cursor this one arrived with.
  let rest = parse(query).clauses.filter((c) => c.kind != 'after')
  let next = conjoin(
    stringify(and(...rest)),
    `.after=${page[size - 1].entity.eid}`,
  )
  return [...page, {
    entity: { eid: '$said' },
    content: {
      body: `More sessions match than this page of ${size}. Query ` +
        `\`${next}\` reads the next page, a larger limit a longer one, and ` +
        `query \`.session\` every status.`,
    },
    output: { source: call.entity.eid },
  }]
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
  session_list: sessionList,
  session_new: async (call, graph) => {
    let args = argsOf(call)
    let prompt = word(args, 'prompt')
    if (!prompt && args.tui !== true) {
      throw new Refused('session new needs a prompt without --tui')
    }
    let using = await named(graph, word(args, 'provider'), word(args, 'model'))
    let effort = word(args, 'effort')
    // A session opened on a topic wears the oracle unless it names another.
    let topic = word(args, 'topic')
    let persona = word(args, 'persona') ?? (topic ? ORACLE : undefined)
    let work = word(args, 'work')
    let home = args.workspace
      ? {
        workspace: String(args.workspace),
        ...args.cwd ? { cwd: String(args.cwd) } : {},
      }
      : homeAt(undefined, word(args, 'cwd'))
    let id = crypto.randomUUID()
    let via = who(call)?.via
    let opened = await openingFor(
      graph,
      home,
      host?.workspaces,
      { persona, work, topic, starter: via },
    )
    let s = await begin(graph, prompt || undefined, {
      eid: id,
      home,
      ...opened,
      work,
      ...topic ? { topic } : {},
      by: caller(call),
      via,
      using: { ...using, ...effort ? { effort } : {} },
    })
    return prompt && args.wait !== false
      ? await settled(graph, s, host?.stopping)
      : await graph.get([s])
  },
  session_send: async (call, graph) => {
    let args = argsOf(call)
    // The session arrives as its eid: @yaks/tools resolved what was typed (an
    // eid, `S-81`, a run's own id) and refused one that names no session.
    let s = String(args.session)
    let prior = await usingOf(graph, s) ?? await selectedUsing(graph, s)
    // A knock needs no model: the run going on chose its own.
    let actor = who(call)
    if (await outside(graph, s, prior)) {
      return await graph.apply([{
        entity: { eid: crypto.randomUUID() },
        doc: { body: String(args.text) },
        knock: { target: s },
        ...actor ? { $actor: actor } : {},
      }])
    }
    let provider = word(args, 'provider')
    let model = word(args, 'model')
    let using = prior
    if (provider || model || !prior) {
      using = {
        ...prior?.effort ? { effort: prior.effort } : {},
        ...await following(graph, prior, provider, model),
      }
    }
    await graph.apply([{
      entity: { eid: crypto.randomUUID() },
      entry: { session: s },
      content: { body: String(args.text) },
      ...using ? { using } : {},
      $actor: through(s, caller(call)),
    }])
    if (args.wait === false) return await graph.get([s])
    return await commanded(graph, using)
      ? await begun(graph, s, host?.stopping)
      : await settled(graph, s, host?.stopping)
  },
  model_list: async (call, graph) => {
    if (!host) throw new Error('model list needs a host')
    let provider = word(argsOf(call), 'provider') ??
      nameOf(
        (await graph.get([String((await defaultUsing(graph)).provider)]))[0],
        PROVIDER,
      )
    let h = hosted(host)
    let served = await configured(
      h.plugins,
      lending(h, signins(h), fetch, systemProcess.env.get),
    )
    let model = provider ? served[provider] : undefined
    if (!model?.list) {
      throw new Refused(
        `${provider ?? 'The default provider'} is not a provider this ` +
          `config names: ${Object.keys(served).join(', ') || 'none'}`,
      )
    }
    let models = await windows(graph, await model.list())
    return [text(
      call,
      [
        `models from ${provider}`,
        ...models.map(({ name, context }) =>
          `  ${name}` + (context ? `  ${context} tokens` : '')
        ),
      ].join('\n'),
    )]
  },
})
