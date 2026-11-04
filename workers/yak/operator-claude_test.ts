import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Item, Model, Request } from '@yaks/model'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
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
