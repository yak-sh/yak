// A workflow is builders reading each other's current outputs (D-467): each
// step's query matches the step before's take, so a text that arrives runs
// every step to the chain's end, however many steps there are. The store's
// bound on effect generations (graph.ts `depth`) is never reached: the tool
// runner writes each answer as a request of its own (@yaks/tools runner.ts),
// at generation zero, so each step starts the count again.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { toolEid } from '@yaks/tools'
import { parseTools } from '@yaks/tools/declared'
import type { Bundle, Comp } from '@yaks/graph'
import type { Dispatch } from './door.ts'
import { appStore, storeName } from './directory.ts'
import { appArrived } from './app-texts.ts'
import { ADA_OWNS, platform, seeded } from './serving-probe.ts'

let NUMBER = '+12695550100', STEPS = 5
let words = {
  $defs: {
    step: {
      tool: true,
      description: 'One step of a workflow',
      worker: '/step',
      input: { binding: { type: 'object' } },
    },
  },
}

test('a five-step chain of builders runs to its end', async () => {
  await using p = platform()
  let { env } = p
  let { space, app } = await seeded(env, 'private')
  env.DISPATCH = {
    get: () => ({
      fetch: async (req: Request) => {
        let { binding } = await req.json() as {
          binding: { entities: string[]; vars: Record<string, string> }
        }
        // Each step adds its number to the words it was handed.
        let n = binding.vars.body.split(' ').length
        return Response.json({
          outputs: [{
            slot: `s${n}`,
            inputs: [binding.entities[0]],
            components: { doc: { body: `${binding.vars.body} ${n}` } },
          }],
        })
      },
    }),
  } as Dispatch
  let store = appStore(env.STORE, space, app)
  let send = async (path: string, body: unknown) => {
    let res = await store(path, {
      method: 'POST',
      body: JSON.stringify(body),
    }, ADA_OWNS)
    assertEquals(res.status, 200, await res.text())
  }
  let rows = async (q: string): Promise<Bundle[]> => {
    await p.object(storeName(space, app)).alarm()
    await p.settled()
    return await (await store(
      `/query?q=${encodeURIComponent(q)}`,
      {},
      ADA_OWNS,
    )).json()
  }
  await send('/tools', parseTools(words, ['doc']))
  // Each step reads the current take of the step before it, says so with a
  // `requires` edge, and builds as soon as that take exists (`immediate`).
  let steps = Array.from({ length: STEPS }, () => crypto.randomUUID())
  await send('/apply', [
    ...steps.map((eid, i) => ({
      entity: { eid },
      doc: { title: `Step ${i + 1}` },
      builder: {
        query: i == 0
          ? `$t .text.to=${NUMBER}, doc.body=$body`
          : `$o .built.slot=s${i}, built.current=true, doc.body=$body`,
        to: toolEid('step'),
        immediate: true,
      },
    })),
    ...steps.slice(1).map((eid, i) => ({
      entity: { eid: crypto.randomUUID() },
      edge: { from: eid, to: steps[i] },
      requires: {},
    })),
  ])
  let text = (id: string, words: string) =>
    appArrived(env, { space, app }, {
      id,
      from: '+12695550142',
      to: NUMBER,
      text: words,
      at: new Date().toISOString(),
      via: 'voipms',
      rcs: false,
      media: [],
    })
  let ends = (n: number) =>
    until(async () => {
      let found = await rows(`.built.slot=s${STEPS}, built.current=true&*`)
      return found.length == n ? found : null
    }, { label: `step ${STEPS}'s outputs` })
  let said = (rows: Bundle[]) => rows.map((r) => (r.doc as Comp).body).sort()
  await text('msg-1', 'go')
  assertEquals(said(await ends(1)), ['go 1 2 3 4 5'])
  // Every text runs the whole chain, not only one there when it was made.
  await text('msg-2', 'again')
  assertEquals(said(await ends(2)), ['again 1 2 3 4 5', 'go 1 2 3 4 5'])
  assertEquals(
    (await rows('.requires&*')).map((r) => r.edge).length,
    STEPS - 1,
  )
})
