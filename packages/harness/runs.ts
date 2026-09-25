// The functions behind the harness's own tools, exported as
// `@yaks/harness/tools`: the facet a `yak` host takes from the harness when a
// config lists it as a plugin (@yaks/cli `compose`), beside every other
// package's.
//
// `session_new` and `session_send` run a transcript on this machine, over the
// host's own graph (store.ts `hosted`), until it settles, and answer with the
// entry it settled on: the reply. Drawing it is the caller's: a line on a command line, the harness
// itself under `--tui` (./view.ts). `model_list` says which OpenAI credential
// this machine would send and what its endpoint lists. A step's own output is
// never printed here — a tool answers, it does not write to a terminal.

import {
  addressed,
  argsOf,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { parse } from '@yaks/query'
import { codexPaths, fromCodex, fromEnv } from '@yaks/openai'
import { type Local, local } from './local.ts'
import { hosted } from './store.ts'

// The host a `yak` config composed, as much of it as a harness runs over.
type Host = Parameters<typeof hosted>[0]

type Args = Record<string, unknown>
let word = (args: Args, name: string): string | undefined => {
  let v = args[name]
  return typeof v == 'string' ? v : undefined
}

// One harness per call, over the host's graph and closed with the call: the
// host outlives it and closes the graph itself.
let running = (host: Host, args: Args): Local =>
  local({
    h: hosted(host),
    name: word(args, 'model'),
    provider: word(args, 'provider'),
  })

/** The session a person typed: whatever the graph resolves (an eid, `S-81`,
 * a name), else its short id or the start of its eid. */
let sessionAt = async (
  graph: Graph,
  a: Local,
  id: string,
): Promise<Eid | undefined> => {
  let rows = await a.sessions()
  let [eid] = await addressed(graph, [id]).catch(() => [undefined])
  return (rows.find((b) => b.entity.eid == eid) ??
    rows.find((b) => String((b.session as Comp).id) == id) ??
    rows.find((b) => b.entity.eid.startsWith(id)))?.entity.eid
}

// Run until it settles, then answer with where it settled: the newest entry,
// which is the model's reply, or the error or stop the run ended on.
let settled = async (a: Local, s: Eid): Promise<Bundle[]> => {
  await a.idle(s)
  return (await a.transcript(s)).slice(-1)
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
export let runs = (host: Host): Runs => ({
  session_list: (_, graph) => graph.read(parse('.session&*')),
  session_new: async (call) => {
    let args = argsOf(call)
    let a = running(host, args)
    try {
      let s = await a.start(String(args.prompt ?? ''), {
        effort: word(args, 'effort'),
        by: caller(call),
      })
      return await settled(a, s)
    } finally {
      await a.close()
    }
  },
  session_send: async (call, graph) => {
    let args = argsOf(call)
    let a = running(host, args)
    try {
      let s = await sessionAt(graph, a, String(args.session))
      if (!s) throw new Error(`no such session: ${args.session}`)
      await a.send(s, String(args.text), caller(call))
      return await settled(a, s)
    } finally {
      await a.close()
    }
  },
  model_list: async (call) => {
    let got = await found()
    if (!got) {
      throw new Error('no credential: set OPENAI_API_KEY or sign in to Codex')
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
