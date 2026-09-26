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
// `model_list` says which OpenAI credential this machine would send and what
// its endpoint lists. A tool answers, it does not write to a terminal.

import {
  addressed,
  argsOf,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  identityEid,
  Refused,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { MODEL, PROVIDER } from '@yaks/model'
import { parse } from '@yaks/query'
import { codexPaths, fromCodex, fromEnv } from '@yaks/openai'
import { instructionFiles } from '@yaks/context/host'
import { statusOf, transcript, usingBefore } from '@yaks/session'
import { ASTRA, begin, seed, through } from './agent.ts'
import { homeAt } from './workspace.ts'

type Args = Record<string, unknown>
let word = (args: Args, name: string): string | undefined => {
  let v = args[name]
  return typeof v == 'string' ? v : undefined
}

/** The session a person typed: whatever the graph resolves (an eid, `S-81`,
 * a name), else its short id or the start of its eid. */
let sessionAt = async (
  graph: Graph,
  id: string,
): Promise<Eid | undefined> => {
  let [eid] = await addressed(graph, [id]).catch(() => [undefined])
  if (eid) return eid
  let rows = await graph.read(parse('.session&*'))
  return (rows.find((b) => String((b.session as Comp).id) == id) ??
    rows.find((b) => b.entity.eid.startsWith(id)))?.entity.eid
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

/** The OpenAI credential this machine would send, and where it was found. The
 * token itself never leaves this function's caller. */
let found = async () => {
  let key = fromEnv(Deno.env.get)
  if (key) return { at: 'OPENAI_API_KEY', cred: key }
  for (let path of codexPaths(Deno.env.get)) {
    let cred = await Deno.readTextFile(path).then(fromCodex, () => undefined)
    if (cred) return { at: path, cred }
  }
}

/** The functions behind the tools the harness declares (./vocab.json). */
export let runs = (): Runs => ({
  session_list: (_, graph) => graph.read(parse('.session&*')),
  session_new: async (call, graph) => {
    let args = argsOf(call)
    let provider = word(args, 'provider') ?? 'openai'
    let model = word(args, 'model') ?? ASTRA
    await graph.apply(seed({ provider, model }), { trusted: true })
    let cwd = Deno.cwd()
    let effort = word(args, 'effort')
    let s = await begin(graph, String(args.prompt ?? ''), {
      home: await homeAt(graph, cwd),
      files: await instructionFiles(cwd),
      by: caller(call),
      using: {
        provider: identityEid(PROVIDER, [provider]),
        model: identityEid(MODEL, [model]),
        ...effort ? { effort } : {},
      },
    })
    return await settled(graph, s)
  },
  session_send: async (call, graph) => {
    let args = argsOf(call)
    let s = await sessionAt(graph, String(args.session))
    if (!s) throw new Refused(`no such session: ${args.session}`)
    let using = usingBefore(await transcript(graph, s))
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
    let got = await found()
    if (!got) {
      // Missing is the caller's to fix, so it is their no, not our fault.
      throw new Refused('no credential: set OPENAI_API_KEY or sign in to Codex')
    }
    let head = `credential from ${got.at} → ${got.cred.base}`
    let res = await fetch(`${got.cred.base}/models`, {
      headers: {
        authorization: `Bearer ${got.cred.token}`,
        ...got.cred.account ? { 'chatgpt-account-id': got.cred.account } : {},
      },
    })
    let body = await res.text()
    if (!res.ok) {
      return [text(
        call,
        `${head}\n${got.cred.base}/models says ${res.status}: ` +
          `${body.slice(0, 200)}\nthe backend may not list models; ` +
          'ask for one by name with --model',
      )]
    }
    let listed = JSON.parse(body) as { data?: { id: string }[] }
    return [text(
      call,
      [head, ...(listed.data ?? []).map((m) => `  ${m.id}`)].join('\n'),
    )]
  },
})
