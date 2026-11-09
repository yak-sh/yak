import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { type Item, type Model, ModelError, type Request } from '@yaks/model'
import { parseHTML } from 'linkedom'
import { renderToString } from 'preact-render-to-string'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { conversationOf, frameOf } from './operator-host.ts'
import { reply } from './operator-draw.ts'
import { rowsOf } from './operator-rows.ts'
import { transcript } from '@yaks/session'
import { PART } from '@yaks/persona'

// On Claude the Operator runs on Sonnet and hands code to Opus in a child
// session: each ask is priced at its own model's price.
let SONNET = 'claude-sonnet-5-5'
let OPUS = 'claude-opus-5-5'
let price = (name: string) => ({ input: name == OPUS ? 4 : 2, output: 0 })
let asked: Request[] = []
// The child's answer comes back as words given to the session that asked.
let said = (r: Request) =>
  r.items.some((i) => i.kind == 'user' && i.text.endsWith('settled\nFixed.'))
let model: Model = Object.assign(
  (req: Request) => {
    asked.push(req)
    let items: Item[] = req.model == OPUS
      ? [{ kind: 'assistant', text: 'Fixed.' }]
      : said(req)
      ? [{ kind: 'assistant', text: 'Opus fixed the page.' }]
      : req.items.some((i) => i.kind == 'result')
      ? [{ kind: 'assistant', text: 'Opus is on it.' }]
      : [{
        kind: 'call',
        id: crypto.randomUUID(),
        name: 'spawn',
        args: JSON.stringify({ prompt: 'Fix the page', model: OPUS }),
      }]
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items,
      usage: { input_tokens: 1000, output_tokens: 0 },
    })
  },
  {
    info: (name: string) =>
      Promise.resolve({ name, price: price(name), context: 10_000 }),
  },
)

let owner = crypto.randomUUID()
// The platform holds Anthropic's key, so the Operator is on Claude.
let { env } = platform('operator-claude', { ANTHROPIC_API_KEY: 'probe' })
let dir = directoryOf(env.STORE)
let id = await dir.mint(owner, 'claude', 'Claude', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let space = (await dir.at(id))!
let store = operatorMemory()
let out = await operating(store, env, { model, name: SONNET })
  .run({ person: owner }, space, {
    say: 'The page is broken; fix it.',
  })
await drain(store)
let [child] = await store.g.read('.spawned&*')
let entries = async (session: string) =>
  (await transcript(store.g, session)).flatMap((b) =>
    b.cost ? [(b.cost as { dollars: number }).dollars] : []
  )

test('on Claude the Operator hands code to Opus, which works for its space at its own price', async () => {
  assertEquals(
    child.operator_session,
    (await store.g.get([out.session]))[0].operator_session,
  )
  let on = (name: string) => asked.filter((r) => r.model == name)
  let [opus] = on(OPUS)
  assertEquals(on(OPUS).length, 1)
  // Told where spawn is given, which the helper on Opus is not.
  assertStringIncludes(
    on(SONNET)[0].tools.find((t) => t.name == 'spawn')!.description,
    `spawn with model ${OPUS}`,
  )
  assertEquals(opus.tools.some((t) => t.name == 'spawn'), false)
  // The child's answer wakes the session that asked, once.
  assertEquals(on(SONNET).filter(said).length, 1)
  assertEquals(said(on(SONNET).at(-1)!), true)
  assertEquals(await entries(child.entity.eid), [0.004])
  assertEquals((await entries(out.session)).every((d) => d == 0.002), true)
})

// Everything the Operator and its helper were sent besides the conversation
// is one entry each, closed, opening on each layer of the system prompt and
// on the tools (each with its description and schema), the helper's inside
// the step that started it. What the page drew above is not drawn again.
test('the conversation shows the context the Operator and each helper were given, closed until opened', async () => {
  let { html } = await conversationOf(
    store,
    '/manage/claude/operator',
    out.task,
    undefined,
    undefined,
    space.operator,
  )
  let { document } = parseHTML(`<main>${html}</main>`)
  let named = (d: Element) => d.querySelector(':scope > summary')!.textContent
  let layers = (d: Element) => [...d.querySelectorAll(':scope > .Talk_Told')]
  let [operator, helper, ...more] = [
    ...document.querySelectorAll('.Talk_Told:not(.Talk_Told .Talk_Told)'),
  ]
  assertEquals(more, [])
  assertEquals(named(operator), `The context ${space.operator} was given`)
  assertEquals(named(helper), 'The context the helper was given')
  let first = (m: string) => asked.find((r) => r.model == m)!
  let shown = (at: Element) =>
    [...at.children].find((c) => c.classList.contains('Talk_Written'))
      ?.innerHTML ?? at.querySelector(':scope > p')?.textContent
  let drawn = (md: string) =>
    parseHTML(renderToString(reply(md))).document.querySelector('.Talk_Reply')!
      .innerHTML
  let whoOf = (m: string) =>
    first(m).instructions!.split(' Who you are\n')[1].split(PART)[0].trim()
  for (let [d, m] of [[operator, SONNET], [helper, OPUS]] as const) {
    let all = layers(d)
    assertEquals(
      [all[0], ...all.slice(-3)].map(named),
      [
        'yaks.app Operator',
        'Who you are',
        'Oracles',
        `${first(m).tools.length} tools`,
      ],
    )
    for (let l of [d, ...all]) assertEquals(l.hasAttribute('open'), false)
    // Every layer is its part of what the model received, in order: each
    // document under its heading, drawn as written unless drawn above.
    let said = first(m).instructions!
    let at = 0
    for (let l of all.slice(0, -1)) {
      let found = said.indexOf(` ${named(l)}\n`, at)
      assert(found >= at, named(l))
      at = found
    }
    let who = all.find((l) => named(l) == 'Who you are')!
    assertEquals(
      shown(who),
      d == helper && whoOf(m) == whoOf(SONNET)
        ? 'The same as above.'
        : drawn(whoOf(m)),
    )
  }
  // Each tool is drawn once on the page, where it was first offered.
  let offers = [SONNET, OPUS].flatMap((m) =>
    first(m).tools.map((t) => JSON.stringify(t))
  )
  assertEquals(
    document.querySelectorAll('.Talk_Told details > pre').length,
    new Set(offers).size,
  )
  // Each tool by its name, opening on its description and its schema.
  let spawn = first(SONNET).tools.find((t) => t.name == 'spawn')!
  let tool = [...layers(operator).at(-1)!.querySelectorAll('details')].find(
    (d) => named(d) == 'spawn',
  )!
  assertEquals(shown(tool), drawn(spawn.description))
  assertEquals(
    tool.querySelector('pre')!.textContent,
    JSON.stringify(spawn.parameters, null, 2),
  )
  // The helper's context sits inside the step that started it.
  let step = helper.closest('.Talk_Step')!
  assertEquals(named(step), 'Started a helper')
  let words = document.querySelectorAll('.Talk_You, .Talk_Reply, .Talk_Trouble')
  for (let w of words) assertEquals(w.querySelector('.Talk_Told'), null)
  let live = await frameOf(store, child.entity.eid)
  assertEquals(live!.frame.operator.task, out.task)
  // A helper's step brings the page that step, live, its context inside.
  let rows = rowsOf(live!.frame.operator.lines)
  assertEquals(rows.map((r) => `row-${r.id}`), [
    step.closest('[id^="row-"]')!.id,
  ])
  assertStringIncludes(rows[0].html, 'The context the helper was given')
})

// A helper's end reaches the conversation as one of the Operator's steps,
// never as words the person said: the one that settled and the one whose
// model was refused, as Opus was in Jeff's space for want of budget.
let REFUSED = 'What is left of claude’s model and voice budget is too little'
let talked = async (refused: boolean) => {
  let store = operatorMemory()
  let opus: Model = Object.assign(
    (req: Request) =>
      refused && req.model == OPUS
        ? Promise.reject(new ModelError('limit', REFUSED))
        : model(req),
    { info: model.info },
  )
  let { task } = await operating(store, env, { model: opus, name: SONNET })
    .run({ person: owner }, space, { say: 'The page is broken; fix it.' })
  await drain(store)
  let { html } = await conversationOf(store, '/manage/claude/operator', task)
  let { document } = parseHTML(`<main>${html}</main>`)
  let all = (s: string) =>
    [...document.querySelectorAll(s)].map((e) => e.textContent?.trim())
  return { all, document }
}

test("a helper's end is the Operator's step in the conversation, never the person's words", async () => {
  for (let refused of [false, true]) {
    let { all } = await talked(refused)
    assertEquals(all('.Talk_You'), ['The page is broken; fix it.'])
    assertEquals(
      all('.Talk_Step > summary').at(-1),
      refused ? 'A helper could not finish' : 'Heard back from a helper',
    )
    if (refused) {
      assertEquals(all('.Talk_Step-no .Talk_Trouble > p'), [
        'A helper the Operator started could not finish, so the Operator went on without it.',
      ])
      assertStringIncludes(all('.Talk_Trouble pre').join(), REFUSED)
    }
  }
})

// Helpers refused while the Operator prepares its next request are heard in
// that request, as Jeff's three were not: it said it had started them after
// their refusals were in, then that none had run (T-137585).
test('the Operator hears helpers refused while it prepares, and answers once', async () => {
  let store = operatorMemory()
  let parent: string | undefined
  let delivered = new Set<string>()
  let ready = Promise.withResolvers<void>()
  let read = store.g.read
  let apply = store.g.apply
  // Hold the parent's tool preparation until every helper's refusal is in
  // its transcript. Their preparation speed must not determine this race.
  store.g.read = async (query, options) => {
    let rows = await read(query, options)
    if (
      parent && typeof query == 'string' &&
      query.startsWith(`.entity.eid=${parent}&.fields=spawned.parent`)
    ) await ready.promise
    return rows
  }
  store.g.apply = async (bundles, options) => {
    let rows = await apply(bundles, options)
    for (let row of rows) {
      if (
        (row.entry as { session?: string } | undefined)?.session == parent &&
        (row.content as { body?: string } | undefined)?.body?.endsWith(REFUSED)
      ) delivered.add(row.entity.eid)
    }
    if (delivered.size == 3) ready.resolve()
    return rows
  }
  let heard = (r: Request) =>
    r.items.filter((i) => i.kind == 'user' && i.text.endsWith(REFUSED)).length
  let three: Model = Object.assign(
    (req: Request) => {
      if (req.model == OPUS) {
        return Promise.reject(new ModelError('limit', REFUSED))
      }
      parent = req.conversation
      let items: Item[] = req.items.some((i) => i.kind == 'result')
        ? [{ kind: 'assistant', text: `${heard(req)} of 3 were refused.` }]
        : [1, 2, 3].map(() => ({
          kind: 'call',
          id: crypto.randomUUID(),
          name: 'spawn',
          args: JSON.stringify({ prompt: 'Fix an app', model: OPUS }),
        }))
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items,
        usage: { input_tokens: 1000, output_tokens: 0 },
      })
    },
    { info: model.info },
  )
  let { session } = await operating(store, env, { model: three, name: SONNET })
    .run({ person: owner }, space, { say: 'Fix every app with errors.' })
  await drain(store)
  assertEquals(
    (await transcript(store.g, session)).flatMap((b) =>
      b.output ? [(b.content as { body: string }).body] : []
    ),
    ['3 of 3 were refused.'],
  )
})
