import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { platform } from './testing.ts'
import { directoryOf } from './directory.ts'
import { connecting, ctxOf } from './connections.ts'
import { credential } from '@yaks/connections'
import { reveal } from '@yaks/secrets'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive, rootOf } from './operator-channels.ts'
import { conversationOf } from './operator-host.ts'
import { lineDoor, textedFor } from './operator-line.ts'

// A person connects their own voip.ms number, their Operator texts someone
// for them from it, and the text back comes into their one conversation
// (T-137987). voip.ms is faked at the fetch it is called through.
let { env } = platform('operator-line', {
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
})
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
await dir.apply({
  entities: [
    {
      entity: { eid: person },
      person: {},
      doc: { title: 'Jeff Peterson' },
      email: { address: 'jeff@example.com' },
    },
    { entity: { eid }, space: { slug: 'jeff', store: 'jeff' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, owner)
let space = (await dir.at(eid))!
let held = { person, role: 'owner' as const, space: eid }

// voip.ms, as an account with one number that texts and mails its texts.
let asked: URLSearchParams[] = []
let real = globalThis.fetch
globalThis.fetch = (input, init) => {
  let url = new URL(input instanceof Request ? input.url : String(input))
  if (url.host != 'voip.ms') return real(input, init)
  let q = url.searchParams
  asked.push(q)
  let ok = (more: object) =>
    Promise.resolve(Response.json({ status: 'success', ...more }))
  if (q.get('api_password') != 'pw') {
    return Promise.resolve(Response.json({ status: 'invalid_credentials' }))
  }
  let method = q.get('method')
  if (method == 'getDIDsInfo') {
    return ok({
      dids: [{
        did: '2695550100',
        sms_enabled: '1',
        sms_email: 'jeff@example.com',
        sms_email_enabled: '1',
        sms_forward_enabled: '0',
        sms_sipaccount: '4931',
        sms_sipaccount_enabled: '0',
        sms_url_callback_enabled: '0',
      }],
    })
  }
  if (method == 'setSMS') return ok({})
  return ok({ [method == 'sendSMS' ? 'sms' : 'mms']: 9000 + asked.length })
}
let of = (method: string) => asked.filter((q) => q.get('method') == method)

let page = (username: string, password: string) => {
  let form = new FormData()
  for (
    let [k, v] of Object.entries({
      do: 'add',
      integration: 'voipms',
      'key.username': username,
      'key.password': password,
    })
  ) {
    form.set(k, v)
  }
  return connecting(
    new Request('https://yaks.app/manage/connections?space=jeff'),
    env,
    space,
    { person, role: 'owner' },
    form,
  )
}
type Said = { say: string; no: boolean }
let unfilled = await page('jeff@example.com', '') as Said
let refused = await page('jeff@example.com', 'wrong') as Said
let connected = await page('jeff@example.com', 'pw') as Said
let [pointed] = of('setSMS')
let callback = pointed.get('url_callback')!

let reply = (text: string): Item[] => [{ kind: 'assistant', text }]
let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let said = (r: Request, words: RegExp) => {
  let last = r.items.at(-1)
  return last?.kind == 'user' && words.test(last.text)
}
let service = operatorService(
  env,
  held,
  operatorModel((req) => {
    let forked = JSON.stringify(req.items).includes('fork of the')
    let last = req.items.at(-1)
    let items = forked
      ? last?.kind == 'result'
        ? reply('Texted Dr Alvarez about Tuesday at 3.')
        : call('phone_send', {
          to: '(269) 555-0142',
          name: 'Dr Alvarez',
          text: 'Does Tuesday at 3 work for his checkup?',
        })
      : said(req, /By text from \+12695550142/)
      ? reply('Dr Alvarez says Tuesday at 3 works.')
      : said(req, /Texted Dr Alvarez/)
      ? reply('I texted Dr Alvarez; I will tell you what they say.')
      : last?.kind == 'result'
      ? reply('On it: texting Dr Alvarez.')
      : call('fork', { prompt: 'Text Dr Alvarez about Tuesday at 3' })
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items,
      cost: 0.001,
    })
  }),
)
env.BUILDER = service.binding
let { store } = service

await receive(
  store,
  { space: eid, person, channel: 'chat' },
  'Text Dr Alvarez at 269-555-0142 and ask if Tuesday at 3 works for my checkup',
)
await service.drain()
let [sent] = of('sendSMS').concat(of('sendMMS'))
let [kept] = await store.g.read('.operator_text&*')
let [fork] = await store.g.read(`.spawned.parent=${rootOf(eid, person)}`)
let ofFork = await conversationOf(store, '/at', fork.entity.eid)

// voip.ms calls back the way its SMS URL callback fills its variables in.
let texted = (id: string, from: string, message: string) =>
  lineDoor(
    new Request(
      callback.replace('{ID}', id).replace('{FROM}', from)
        .replace('{TO}', '2695550100')
        .replace('{MESSAGE}', encodeURIComponent(message)),
    ),
    env,
  )
let answered = await texted('77', '2695550142', 'Tuesday at 3 works for us.')
let stranger = await texted('78', '2695550199', 'Are we still on for golf?')
await service.drain()
let root = await conversationOf(store, '/at', rootOf(eid, person))
let forged = await lineDoor(
  new Request('https://yaks.app/voipms/e30.bm90LW91cnM?id=79&from=1&to=2'),
  env,
)

test('a voip.ms connection is checked, names the number, and points its callback here, keeping how texts reach the person', () => {
  assertEquals(unfilled, { say: 'Fill in API password first.', no: true })
  assertEquals(refused.no, true)
  assertStringIncludes(refused.say, 'username or API password')
  assertEquals(connected, {
    say:
      'Connected +12695550100. Your Operator can text from it, and replies to its texts come back to it.',
    no: false,
  })
  assert(callback.startsWith('https://yaks.app/voipms/'))
  assertStringIncludes(
    callback,
    '?id={ID}&from={FROM}&to={TO}&message={MESSAGE}',
  )
  assertEquals(
    Object.fromEntries(
      [
        'did',
        'email_enabled',
        'email_address',
        'sms_sipaccount',
        'url_callback_enable',
        'url_callback_retry',
      ]
        .map((k) => [k, pointed.get(k)]),
    ),
    {
      did: '2695550100',
      email_enabled: '1',
      email_address: 'jeff@example.com',
      sms_sipaccount: '4931',
      url_callback_enable: '1',
      url_callback_retry: '1',
    },
  )
})

test("a fork's text goes from the person's own number, signed as their assistant, and is kept", () => {
  assertEquals(sent.get('did'), '2695550100')
  assertEquals(sent.get('dst'), '2695550142')
  assertEquals(sent.get('api_username'), 'jeff@example.com')
  assertEquals(
    sent.get('message'),
    `Does Tuesday at 3 work for his checkup?\n\n${
      textedFor(space, 'Jeff Peterson')
    }`,
  )
  let text = kept.text as Record<string, unknown>
  assertEquals([
    (kept.operator_text as { person: string }).person,
    text.from,
    text.to,
  ], [
    person,
    '+12695550100',
    '+12695550142',
  ])
  assertStringIncludes(ofFork.html, 'Texted Dr Alvarez')
})

test("a text back comes into the person's conversation as its writer's words; anyone else's stays theirs", async () => {
  assertEquals([answered.status, await answered.text()], [200, 'ok'])
  assertEquals([stranger.status, await stranger.text()], [200, 'ok'])
  assertStringIncludes(
    root.html,
    'By text from +12695550142, replying to your text',
  )
  assertStringIncludes(root.html, 'Tuesday at 3 works for us.')
  assertStringIncludes(root.html, 'Dr Alvarez says Tuesday at 3 works.')
  assert(!root.html.includes('golf'))
  assertEquals(forged.status, 403)
})

test('a voip.ms key kept as its email and password joined by a colon is read as its fields, and kept as them', async () => {
  let c = ctxOf(env)
  let [line] = await c.graph.read(
    `.connection.integration=voipms&.connection.status=connected&*`,
  )
  let name = String((line.secret as Record<string, unknown>).name)
  await c.graph.apply([{
    entity: { eid: line.entity.eid },
    secret: { name, value: 'jeff@example.com:pw:with-colon' },
  }])
  assertEquals(
    await credential(c, line.entity.eid, 'username'),
    'jeff@example.com',
  )
  assertEquals(
    await credential(c, line.entity.eid, 'password'),
    'pw:with-colon',
  )
  assertEquals(
    JSON.parse((await reveal(c.vault, name, { env: () => undefined }))!),
    { username: 'jeff@example.com', password: 'pw:with-colon' },
  )
})
