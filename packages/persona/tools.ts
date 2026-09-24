// What an agent can ask for here, exported as `@yaks/persona/tools`: the
// implementations behind `persona_read` and `persona_sync` in ./vocab.json.
//
// `persona_read` returns text — a `content{body}` entity with `output{source}`
// naming the call it came from (@yaks/tools' components, the shape every
// transport already renders) — not a file and not a path. `persona_sync` is
// where that text becomes files: each project's personas in its checkout
// (./files.ts), and a line for each file that moved.

import { argsOf, type Bundle, type Graph, Refused } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { plan, sync } from '@yaks/mirror'
import { personaMirror, remembered } from './files.ts'
import { voice } from './voice.ts'
import { wear } from './worn.ts'

// The persona the caller typed, resolved to an eid: an eid resolves to itself,
// and a name resolves to whatever the graph addresses it to (@yaks/alias, when
// it is composed in) — the same resolution `graph_show` performs, so a persona
// is reachable here by every name it is reachable by there.
let at = async (graph: Graph, said: string): Promise<string> => {
  let found = await graph.address([said])
  return found.get(said) ?? said
}

let answer = (call: Bundle, body: string): Bundle[] => [{
  entity: { eid: '$voice' },
  content: { body },
  output: { source: call.entity.eid },
}]

let CURRENT = 'every persona file is current'

// What a sync did. A file that could not be written is not the caller's to
// fix, so it throws, and the call is recorded as failed.
let synced = async (graph: Graph, db?: string): Promise<string> => {
  let done = await sync((await personaMirror(graph, remembered(db))).binding)
  if (done.failed.length) throw new Error(done.failed.join('\n'))
  let lines = [
    ...done.wrote.map((p) => `wrote ${p}`),
    ...done.removed.map((p) => `removed ${p}`),
    ...done.conflicts.map((p) =>
      `left ${p}: edited by hand while the graph moved; delete it to take ` +
      "the graph's"
    ),
  ]
  return lines.join('\n') || CURRENT
}

// What a sync would do, without doing it.
let drift = async (graph: Graph, db?: string): Promise<string> =>
  (await plan((await personaMirror(graph, remembered(db))).binding))
    .filter((p) => p.act != 'same')
    .map((p) =>
      `${
        p.act == 'conflict' ? 'conflict' : p.text == null ? 'remove' : 'write'
      } ${p.path}`
    )
    .join('\n') || CURRENT

/** The implementations behind the tools ./vocab.json declares. The host's
 * config names the database, beside which `persona_sync` remembers what each
 * file last agreed on. */
export let runs = (host?: { config?: { db?: string } }): Runs => {
  let db = host?.config?.db ?? Deno.env.get('DB_PATH')
  return {
    persona_read: async (call, graph): Promise<Bundle[]> => {
      let said = String(argsOf(call).persona ?? '').trim()
      if (!said) throw new Refused('persona_read needs a persona')
      let worn = await wear(graph.storage, graph.vocab)(
        await at(graph, said),
      )
      // An entity that is not a persona is refused rather than rendered as an
      // empty document: a caller that named a task would otherwise read the
      // task's own body as instructions.
      if (!worn) throw new Refused(`no persona called ${said}`)
      return answer(call, voice(graph.vocab)(worn))
    },
    persona_sync: async (call, graph): Promise<Bundle[]> =>
      answer(
        call,
        argsOf(call).check == true
          ? await drift(graph, db)
          : await synced(graph, db),
      ),
  }
}
