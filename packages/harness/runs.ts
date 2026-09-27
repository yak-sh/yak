// The functions behind the harness's own tools, exported as
// `@yaks/harness/tools`: the facet a `yak` host takes from the harness when a
// config lists it as a plugin (@yaks/cli `compose`), beside every other
// package's.
//
// `session_new` and `session_send` write a line that asks a transcript for a
// turn, and wait for the reply: the entry the transcript settles on. Neither
// runs the transcript. The runner does, wherever the host's effects are
// worked (./effects.ts): a box's `yak serve`, or the command's own duty thread
// when nothing else holds that role. Drawing the reply is the caller's: a line
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
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import type { Host } from '@yaks/cli/host'
import { MODEL, PROVIDER } from '@yaks/model'
import { parse } from '@yaks/query'
import { CODEX, type Credential, type TransportCredential } from '@yaks/openai'
import { instructionFiles } from '@yaks/context/host'
import { statusOf, transcript, usingBefore } from '@yaks/session'
import { ASTRA, begin, seed, through } from './agent.ts'
import { selectedUsing } from './model_selection.ts'
import { openaiCredential } from './openai_auth.ts'
import { hosted } from './store.ts'
import { homeAt } from './workspace.ts'

type Args = Record<string, unknown>
let word = (args: Args, name: string): string | undefined => {
  let v = args[name]
  return typeof v == 'string' ? v : undefined
}

// Wait for the reply: once the transcript owes nothing, where it settled — the
// newest entry, which is the model's reply, or the error or stop it ended on.
let settled = async (graph: Graph, s: Eid): Promise<Bundle[]> => {
  for (;;) {
    let entries = await transcript(graph, s)
    let status = statusOf(entries)
    if (status != 'pending' && status != 'running') return entries.slice(-1)
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

// This is the Codex catalog protocol level the harness understands. The
// backend filters its models by client_version: the package release number
// would return an empty catalog even when the account can use those models.
export let CODEX_CLIENT_VERSION = '0.157.1'

/** Model names from the endpoint this credential serves. */
export let modelCatalog = async (
  cred: Credential,
  fetcher: typeof fetch = fetch,
  refresh?: (stale: TransportCredential) => Promise<Credential>,
): Promise<string[]> => {
  let url = new URL(cred.base.replace(/\/$/, '') + '/models')
  if (cred.base == CODEX) {
    url.searchParams.set('client_version', CODEX_CLIENT_VERSION)
  }
  let res = await fetcher(url, {
    headers: {
      authorization: `Bearer ${cred.token}`,
      ...(cred.account ? { 'chatgpt-account-id': cred.account } : {}),
    },
  })
  if (res.status == 401 && cred.base == CODEX && refresh) {
    await res.body?.cancel()
    return modelCatalog(await refresh(cred), fetcher)
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`${url.pathname} says ${res.status}`)
  }
  let body = await res.text()
  let listed = JSON.parse(body) as {
    data?: { id: string }[]
    models?: { slug: string }[]
  }
  if (cred.base == CODEX) {
    if (!Array.isArray(listed.models)) throw new Error('Invalid model catalog')
    let names = listed.models.map((m) => m.slug)
    if (names.some((name) => typeof name != 'string')) {
      throw new Error('Invalid model catalog')
    }
    return names
  }
  if (!Array.isArray(listed.data)) throw new Error('Invalid model catalog')
  let names = listed.data.map((m) => m.id)
  if (names.some((name) => typeof name != 'string')) {
    throw new Error('Invalid model catalog')
  }
  return names
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
    let model = word(args, 'model') ?? ASTRA
    await graph.apply(seed({ provider, model }), { trusted: true })
    let cwd = Deno.cwd()
    let effort = word(args, 'effort')
    let s = await begin(graph, prompt || undefined, {
      home: await homeAt(graph, cwd),
      files: await instructionFiles(cwd),
      by: caller(call),
      using: {
        provider: identityEid(PROVIDER, [provider]),
        model: identityEid(MODEL, [model]),
        ...effort ? { effort } : {},
      },
    })
    return prompt ? await settled(graph, s) : await graph.get([s])
  },
  session_send: async (call, graph) => {
    let args = argsOf(call)
    // The session arrives as its eid: @yaks/tools resolved what was typed (an
    // eid, `S-81`, a run's own id) and refused one that names no session.
    let s = String(args.session)
    let using = usingBefore(await transcript(graph, s)) ??
      await selectedUsing(graph, s)
    await graph.apply([{
      entity: { eid: crypto.randomUUID() },
      entry: { session: s },
      content: { body: String(args.text) },
      ...using ? { using } : {},
      $actor: through(s, caller(call)),
    }])
    return await settled(graph, s)
  },
  model_list: async (call) => {
    if (!host) throw new Error('model list needs a host')
    let auth = openaiCredential(hosted(host))
    let cred = await auth.credential()
    let names = await modelCatalog(cred, fetch, auth.refresh)
    return [text(
      call,
      [
        `models from ${cred.base}`,
        ...names.map((name) => `  ${name}`),
      ].join('\n'),
    )]
  },
})
