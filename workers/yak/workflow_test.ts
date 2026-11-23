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
import { ADA, ADA_OWNS, platform, seeded } from './serving-probe.ts'
import { SPACE } from './build-door.ts'
import type { Update } from './operator-updates.ts'

let NUMBER = '+12695550100'
let words = {
  $defs: {
    step: {
      tool: true,
      title: 'Run a workflow step',
      worker: '/step',
      input: { binding: { type: 'object' }, template: { type: 'string' } },
    },
  },
}

type Comps = Record<string, Comp>
type Vars = { body: string; [name: string]: string }
type Binding = { entities: string[]; vars: Vars }
type Step = { slot: string; reads?: string; query?: string }

// An app whose worker answers each step with `step(slot, body)`'s words in its
// step's slot, or the components it gives, and whose builders are `steps`: one
// reading each text to NUMBER, or the current take in the slot it `reads`
// (by `query` where it gives one), joined to it by a `requires` edge.
let workflow = async (
  steps: Step[],
  step: (
    slot: string,
    body: string,
    vars: Vars,
  ) => string | Comps | Promise<string | Comps>,
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
        let said = await step(slot, binding.vars.body, binding.vars)
        return Response.json({
          outputs: [{
            slot,
            inputs: [binding.entities[0]],
            components: typeof said == 'string'
              ? { doc: { body: said } }
              : said,
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
        query: s.query ??
          (s.reads
            ? `$o .built.slot=${s.reads}, built.current=true, doc.body=$body`
            : `$t .text.to=${NUMBER}, doc.body=$body`),
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
  let operator = async <T>(path: string, args?: object): Promise<T> => {
    let res = await p.builder(space.eid).fetch(
      new Request('https://builder' + path, {
        headers: { ...ADA_OWNS, [SPACE]: space.eid },
        ...(args ? { method: 'POST', body: JSON.stringify(args) } : {}),
      }),
    )
    let body = await res.text()
    assertEquals(res.status, 200, body)
    return JSON.parse(body)
  }
  return {
    apply: (bundles: Bundle[]) => send('/apply', bundles),
    rows,
    takes,
    text,
    updating: (args: object = {}) =>
      operator<{ updates: Update[] }>('/operator/updates', args),
    questions: () => operator<Bundle[]>('/api/query?q=.app_decision%26*'),
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

// A person's step: the first step asks whoever set the workflow up with a
// decision among its outputs, which reaches their Updates through the
// space's Operator, and the next step builds once they answer.
let personStep = () =>
  workflow([
    { slot: 'ask' },
    {
      slot: 'reply',
      reads: 'ask',
      query:
        '$d .built.slot=ask, built.current=true, decided.choice=$choice, decision.question=$body',
    },
  ], (slot, body, vars) =>
    slot == 'reply' ? `${vars.choice}: ${body}` : {
      task: {},
      doc: { title: `Reply to “${body}”?` },
      decision: {
        question: `A text says “${body}”. Reply?`,
        choices: [
          { label: 'Reply', description: 'Text them back.' },
          { label: 'Ignore', description: 'Send nothing.' },
        ],
        recommended: 'Reply',
      },
    })
for (let from of ['Updates', 'the app']) {
  test(`a workflow decision answered in ${from} closes in Updates and the workflow continues`, async () => {
    await using w = await personStep()
    await w.text('msg-1', 'lunch?')
    let asked = await until(async () => {
      let [app] = await w.rows('.decision&*')
      let { updates } = await w.updating()
      let question = updates.find((u) => u.needs)
      return app && question ? { app, question } : null
    }, { label: 'the question in Updates' })
    assertEquals(asked.question.words, 'A text says “lunch?”. Reply?')
    assertEquals(await w.rows('.built.slot=reply'), [])

    if (from == 'Updates') {
      await w.updating({ choose: asked.question.eid, choice: 'Reply' })
    } else {
      await w.apply([{
        entity: asked.app.entity,
        decided: { choice: 'Reply' },
      }])
    }
    assertEquals(await w.takes('reply', 1), [
      'Reply: A text says “lunch?”. Reply?',
    ])
    let [row] = await w.rows(`.entity.eid=${asked.app.entity.eid}&.decided`)
    let { choice, by } = row.decided as Comp
    assertEquals([choice, by], ['Reply', ADA])
    let copies = await w.questions()
    assertEquals(copies.map((copy) => copy.entity.eid), [asked.question.eid])
    assertEquals(copies[0].decided, row.decided)
    let { updates } = await w.updating()
    assertEquals(updates.filter((u) => u.needs), [])
  })
}

test('a workflow decision given another person is asked of them', async () => {
  await using w = await personStep()
  await w.text('msg-1', 'lunch?')
  let [app] = await until(() => w.rows('.decision&*').then((r) => r[0] && r), {
    label: 'the decision',
  })
  let bo = crypto.randomUUID()
  await w.apply([{ entity: app.entity, filed: { assignee: bo } }])
  await until(async () => {
    let [copy] = await w.questions()
    return (copy?.filed as Comp | undefined)?.assignee == bo || null
  }, { label: 'the question asked of Bo' })
})
