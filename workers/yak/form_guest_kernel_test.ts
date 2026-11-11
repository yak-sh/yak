// A sign-up's people are the app's to read, not a visitor's, in a public app.
import { equal, test } from '@yaks/testing'
import { connector, kernel, signIn } from './probe.ts'

let k = await kernel(), owner = await signIn(k)
let agent = connector(k, owner.cookie)
let host = `${owner.email.split('@')[0]}.${k.host}`
let app = `people${crypto.randomUUID().slice(0, 6)}`
await agent.answer('app_new', { slug: app, title: 'People', access: 'public' })
let write = (path: string, content: string) =>
  agent.tool('app_files', { app, op: 'write', path, content })
let text = { type: 'string' }
let kept = { ...text, ref: 'entity', death: 'keep' }
await write('index.html', '<h1>People</h1>')
await write(
  'vocab.json',
  JSON.stringify({
    $defs: {
      individual: {
        properties: { first: text, phone: text, status: text },
      },
      relation: { properties: { kind: text, a: kept, b: kept } },
    },
  }),
)
await agent.tool('app_deploy', { app })
let [form, name, phone, kids, kid, ours] = Array.from(
  { length: 6 },
  () => crypto.randomUUID(),
)
let ask = (eid: string, question: object) => ({
  entity: { eid },
  question: { form, ...question },
})
await agent.tool('graph_apply', {
  app,
  entities: [
    { entity: { eid: form }, alias: { name: 'join' }, form: {} },
    ask(name, { kind: 'line', label: 'Name', fills: 'individual.first' }),
    ask(phone, {
      kind: 'phone',
      label: 'Phone',
      fills: 'individual.phone',
      order: 1,
    }),
    ask(kids, { kind: 'repeat', label: 'Kids', order: 2, relates: 'child' }),
    ask(kid, {
      kind: 'line',
      label: 'Kid',
      fills: 'individual.first',
      within: kids,
    }),
    {
      entity: { eid: ours },
      individual: { first: 'Ann', status: 'member' },
      phone: { number: '+12695550142' },
    },
  ],
})
let join = (answers: object) =>
  k.at(host, `/${app}/api/form/join`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  })
let signed = await join({
  [name]: 'Zed',
  [phone]: '+12695550199',
  [kids]: [{ [kid]: 'Sam' }],
})
let matching = await join({ [name]: 'Ann', [phone]: '+12695550142' })
await k.settled()
let asked = async (q: string, cookie?: string) => {
  let r = await k.at(host, `/${app}/api/query?${new URLSearchParams({ q })}`, {
    headers: cookie ? { cookie } : {},
  })
  return [r.status, await r.text()] as const
}
let count = (q: string, cookie?: string) => asked(`${q} .count`, cookie)

test("a sign-up is taken, and one that matches the app's own person too", () => {
  equal([signed.status, matching.status], [204, 204])
})

test('a visitor reads none of the people or relations a sign-up created', async () => {
  for (
    let q of ['.individual&.form_guest', '.phone&.form_guest', '.relation']
  ) {
    equal(await count(q), [200, '{"count":0}'], q)
  }
  equal(await count('.individual&!form_guest'), [200, '{"count":1}'])
  equal(await count('.phone&!form_guest'), [200, '{"count":1}'])
})

test("an editor reads them, and a visitor still reads the app's own person", async () => {
  equal(await count('.individual&.form_guest', owner.cookie), [
    200,
    '{"count":2}',
  ])
  equal(await count('.phone&.form_guest', owner.cookie), [200, '{"count":1}'])
  equal(await count('.relation', owner.cookie), [200, '{"count":1}'])
  equal(await count('.individual', owner.cookie), [200, '{"count":3}'])
  equal(await count('.phone&.individual&!form_guest'), [200, '{"count":1}'])
})
