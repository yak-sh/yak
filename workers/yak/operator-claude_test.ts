import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { type Item, type Model, ModelError, type Request } from '@yaks/model'
import { parseHTML } from 'linkedom'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { conversationOf, frameOf } from './operator-host.ts'
import { reply } from './operator-view.ts'
import { transcript } from '@yaks/session'

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
let { env } = platform('operator-claude')
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
  assertStringIncludes(
    String(on(SONNET)[0].instructions),
    `spawn with model ${OPUS}`,
  )
  assertEquals(String(opus.instructions).includes('spawn with model'), false)
  // The child's answer wakes the session that asked, once.
  assertEquals(on(SONNET).filter(said).length, 1)
  assertEquals(said(on(SONNET).at(-1)!), true)
  assertEquals(await entries(child.entity.eid), [0.004])
  assertEquals((await entries(out.session)).every((d) => d == 0.002), true)
})

// Everything the Operator and its helper were sent besides the conversation
// (the system prompt, every tool with its description and schema) is an
// entry of its own, closed, holding what the model received, the helper's
// under the step that started it.
test('the conversation shows what the Operator and each helper were told and offered, closed until opened', async () => {
  let { html } = await conversationOf(
    store,
    '/manage/claude/operator',
    out.task,
  )
  let { document } = parseHTML(`<main>${html}</main>`)
  let told = [...document.querySelectorAll('.Talk_Told')]
  let first = (m: string) => asked.find((r) => r.model == m)!
  assertEquals(
    told.map((d) => d.querySelector('summary')!.textContent),
    [SONNET, OPUS].flatMap((m) => {
      let who = m == SONNET ? 'the Operator' : 'a helper'
      return [
        `What ${who} was told`,
        `The ${first(m).tools.length} tools ${who} was offered`,
      ]
    }),
  )
  for (let d of told) assertEquals(d.hasAttribute('open'), false)
  let helperSaid = told[2]
  // Each in full, as the model received it, its Markdown drawn as text.
  let shown = (at: Element) =>
    [...at.children].find((c) => c.classList.contains('Talk_Written'))!
      .innerHTML
  let drawn = (md: string) =>
    parseHTML(reply(md)).document.querySelector('.Talk_Reply')!.innerHTML
  for (let [i, m] of [[0, SONNET], [2, OPUS]] as const) {
    assertEquals(shown(told[i]), drawn(first(m).instructions!))
  }
  let spawn = first(SONNET).tools.find((t) => t.name == 'spawn')!
  let tool = [...told[1].querySelectorAll('details')].find((d) =>
    d.querySelector('summary')!.textContent == 'spawn'
  )!
  assertEquals(shown(tool), drawn(spawn.description))
  assertEquals(
    tool.querySelector('pre')!.textContent,
    JSON.stringify(spawn.parameters, null, 2),
  )
  // The helper's entry sits under the step that started it.
  assert(
    helperSaid.parentElement!.previousElementSibling!.querySelector(
      '.Talk_Step',
    ),
  )
  let words = document.querySelectorAll('.Talk_You, .Talk_Reply, .Talk_Trouble')
  for (let w of words) assertEquals(w.querySelector('.Talk_Told'), null)
  let live = await frameOf(store, child.entity.eid)
  assertEquals(live!.frame.operator.task, out.task)
  // A helper's step brings the page the same entry, live.
  let rows = live!.frame.operator.rows
  assertEquals(rows.map((r) => `row-${r.id}`), [helperSaid.parentElement!.id])
  assertStringIncludes(
    html,
    `<div id="row-${rows[0].id}">${rows[0].html}</div>`,
  )
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
  let heard = (r: Request) =>
    r.items.filter((i) => i.kind == 'user' && i.text.endsWith(REFUSED)).length
  let three: Model = Object.assign(
    (req: Request) => {
      if (req.model == OPUS) {
        return Promise.reject(new ModelError('limit', REFUSED))
      }
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
