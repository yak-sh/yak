// A managed Codex run is a session whose eid is its own, not its thread's,
// and the importer meets its subagents' rollouts beside its own. Whatever
// either writes is by the run's persona: through the `x-via` the run is
// started with, and as a subagent spawned by the run.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Actor, type Comp, graph, identityEid } from '@yaks/graph'
import { edgeDoc, edgeKeywords } from '@yaks/edge/vocab'
import { fileDoc } from '@yaks/file/vocab'
import { kernel, kernelDoc } from '@yaks/kernel'
import { machineDoc } from '@yaks/machine/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { ram } from '@yaks/ram'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import { authenticate, VIA } from './graph.ts'
import { sessions } from './plugin.ts'
import { look } from './service.ts'
import { speaking } from './who.ts'

let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  fileDoc,
  machineDoc,
  edgeDoc,
  kernelDoc,
], [edgeKeywords])
let g = graph({ vocab, storage: ram(vocab), plugins: [kernel(), sessions()] })

let persona = crypto.randomUUID(), locus = crypto.randomUUID()
let run = crypto.randomUUID(), thread = crypto.randomUUID()
let fork = crypto.randomUUID(), provider = identityEid('provider', ['codex'])
await g.apply([
  { entity: { eid: persona }, favorite: {} },
  { entity: { eid: locus }, session: { id: locus } },
  // What @yaks/spawn writes for a run: its session, and the request asking
  // the provider for it, which makes it managed.
  {
    entity: { eid: run },
    session: { id: thread, persona },
    spawned: { parent: locus },
  },
  { entity: { eid: provider }, provider: { name: 'codex' } },
  {
    entity: { eid: crypto.randomUUID() },
    entry: { session: run },
    using: { provider },
    content: { body: 'Work T-1' },
  },
  ...['by-header', 'by-fork'].map((eid) => ({ entity: { eid }, favorite: {} })),
], { trusted: true })

let home = Deno.makeTempDirSync()
let day = `${home}/sessions/2026/11/12`
Deno.mkdirSync(day, { recursive: true })
let rollout = (id: string, source: unknown) =>
  Deno.writeTextFileSync(
    `${day}/rollout-2026-11-12T16-09-16-${id}.jsonl`,
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-11-12T21:09:16.000Z',
      payload: { id, cwd: '/work', source },
    }) + '\n',
  )
rollout(thread, 'exec')
// A full-history fork names the run's thread as its parent.
rollout(fork, { subagent: { thread_spawn: { parent_thread_id: thread } } })
await look(g, [{ runner: 'codex', dir: home }], {
  tails: new Map(),
  done: new Set(),
}, { slice: Infinity, budget: Infinity })
Deno.removeSync(home, { recursive: true })

let complete = async (eid: string, $actor: Actor | null) => {
  await g.apply([{
    entity: { eid },
    completed: {},
    ...$actor ? { $actor } : {},
  }])
  return (await g.get([eid]))[0].completed as Comp
}
let header = await authenticate({ graph: g })(
  new Request('http://door/mcp', { headers: { [VIA]: run } }),
)
let [forked] = await g.get([fork])
let byHeader = await complete('by-header', header)
let byFork = await complete('by-fork', await speaking(g, forked))
let [minted] = await g.get([thread])

test("a Codex run's subagent is spawned by the run, not by a row minted from its thread id", () => {
  assertEquals((forked.spawned as Comp).parent, run)
  assertEquals(minted?.session, undefined)
})

test("a task completed through a Codex run or its fork is by the run's persona", () => {
  assertEquals(byHeader, { ...byHeader, by: persona, via: run })
  assertEquals(byFork, { ...byFork, by: persona, via: fork })
})
