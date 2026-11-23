// A workflow is builders reading each other's current outputs (D-467): each
// step's query matches the take of a step it requires, so a text that arrives
// runs every step to the chain's end, however many steps there are. The
// store's bound on effect generations (graph.ts `depth`) is never reached: the
// tool runner writes each answer as a request of its own (@yaks/tools
// runner.ts), at generation zero, so each step starts the count again. Steps
// that require none of each other run at once.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { toolEid } from '@yaks/tools'
import { parseTools } from '@yaks/tools/declared'
import type { Bundle, Comp } from '@yaks/graph'
import type { Dispatch } from './door.ts'
import { appStore, storeName } from './directory.ts'
import { appArrived } from './app-texts.ts'
import { ADA_OWNS, platform, seeded } from './serving-probe.ts'

let NUMBER = '+12695550100'
let words = {
  $defs: {
    step: {
      tool: true,
      description: 'One step of a workflow',
      worker: '/step',
      input: { binding: { type: 'object' }, template: { type: 'string' } },
    },
  },
}

type Binding = { entities: string[]; vars: { body: string } }
type Step = { slot: string; reads?: string }

// An app whose worker answers each step with `step(slot, body)`'s words in its
// step's slot, and whose builders are `steps`: one reading each text to
// NUMBER, or the current take in the slot it `reads`, joined to it by a
// `requires` edge.
let workflow = async (
  steps: Step[],
  step: (slot: string, body: string) => string | Promise<string>,
) => {
  let p = platform()
  let { env } = p
  let { space, app } = await seeded(env, 'private')
  env.DISPATCH = {
    get: () => ({
      fetch: async (req: Request) => {
        // Each step's builder names its slot as its template.
        let { binding, template: slot } = await req.json() as {
          binding: Binding
          template: string
        }
        return Response.json({
          outputs: [{
            slot,
            inputs: [binding.entities[0]],
            components: { doc: { body: await step(slot, binding.vars.body) } },
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
  // Each step builds as soon as what it reads exists (`immediate`).
  let eids = new Map(steps.map((s) => [s.slot, crypto.randomUUID()]))
  await send('/apply', [
    ...steps.map((s) => ({
      entity: { eid: eids.get(s.slot) },
      doc: { title: s.slot },
      content: { body: s.slot },
      builder: {
        query: s.reads
          ? `$o .built.slot=${s.reads}, built.current=true, doc.body=$body`
          : `$t .text.to=${NUMBER}, doc.body=$body`,
        to: toolEid('step'),
        immediate: true,
      },
    })),
    ...steps.filter((s) => s.reads).map((s) => ({
      entity: { eid: crypto.randomUUID() },
      edge: { from: eids.get(s.slot), to: eids.get(s.reads!) },
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
  // The words of the current takes in `slot`, once there are `n`.
  let takes = (slot: string, n: number) =>
    until(async () => {
      let found = await rows(`.built.slot=${slot}, built.current=true&*`)
      return found.length == n
        ? found.map((r) => (r.doc as Comp).body as string).sort()
        : null
    }, { label: `${slot}'s takes`, timeout: 10_000 })
  return {
    text,
    takes,
    rows,
    [Symbol.asyncDispose]: () => p[Symbol.asyncDispose](),
  }
}

test('a five-step chain of builders runs to its end', async () => {
  let steps = ['s1', 's2', 's3', 's4', 's5'].map((slot, i) => ({
    slot,
    reads: i ? `s${i}` : undefined,
  }))
  await using w = await workflow(
    steps,
    (slot, body) => `${body} ${slot.slice(1)}`,
  )
  await w.text('msg-1', 'go')
  assertEquals(await w.takes('s5', 1), ['go 1 2 3 4 5'])
  // Every text runs the whole chain, not only one there when it was made.
  await w.text('msg-2', 'again')
  assertEquals(await w.takes('s5', 2), ['again 1 2 3 4 5', 'go 1 2 3 4 5'])
  assertEquals((await w.rows('.requires&*')).length, steps.length - 1)
})

test('steps that require none of each other run at once', async () => {
  // Three steps read the first; each waits until all three are running, so
  // they finish together only when they started together.
  let wide = 3, running = 0, most = 0
  let all = Promise.withResolvers<void>()
  await using w = await workflow(
    [
      { slot: 'first' },
      ...Array.from({ length: wide }, (_, i) => ({
        slot: `side${i}`,
        reads: 'first',
      })),
    ],
    async (slot, body) => {
      if (slot == 'first') return body
      most = Math.max(most, ++running)
      if (running == wide) all.resolve()
      await Promise.race([
        all.promise,
        new Promise((go) => setTimeout(go, 1000)),
      ])
      running--
      return `${body} ${slot}`
    },
  )
  await w.text('msg-1', 'go')
  for (let i = 0; i < wide; i++) {
    assertEquals(await w.takes(`side${i}`, 1), [`go side${i}`])
  }
  assertEquals(most, wide)
})
