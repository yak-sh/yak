import { ok, test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import type { Item, Request } from '@yaks/model'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { platform } from './testing.ts'
import { directoryOf } from './directory.ts'
import { connecting, ctxOf } from './connections.ts'
import { credential } from '@yaks/connections'
import { reveal } from '@yaks/secrets'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { signupTools } from './operator-signup.ts'
import { rootOf } from './operator-root.ts'
import { conversationOf, workOf } from './operator-host.ts'
import { listed as listing } from './operator-view.ts'
import { parseHTML } from 'linkedom'
import {
  answerText,
  chosen,
  lineDoor,
  numbersOf,
  owned,
  phoneNumbers,
  phoneSend,
  textedFor,
} from './operator-line.ts'
import type { Ctx } from './tool.ts'

// A person connects their own voip.ms account, which holds two numbers that
// text, tells their Operator to text from the church line, their Operator
// texts someone for them from it, and once the person sends that line's
// texts to their Operator too, the text back comes into their one
// conversation (T-137987, T-151703). voip.ms is faked at the fetch it is
// called through, as an account whose numbers keep what setSMS says.
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
      phone: { number: '+12695550177' },
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

// voip.ms, as an account with a home number that mails its texts, a church
// line whose texts go to a URL of the church's own, and a fax that does not
// text.
let church = 'https://example.org/sms'
let dids = [{
  did: '2695550100',
  description: 'Home',
  sms_enabled: '1',
  sms_email: 'jeff@example.com',
  sms_email_enabled: '1',
  sms_forward_enabled: '0',
  sms_sipaccount: '4931',
  sms_sipaccount_enabled: '0',
  sms_url_callback_enabled: '0',
  sms_url_callback: '',
}, {
  did: '2695550111',
  description: 'Church line',
  sms_enabled: '1',
  sms_email: 'office@example.org',
  sms_email_enabled: '1',
  sms_forward_enabled: '0',
  sms_sipaccount: '',
  sms_sipaccount_enabled: '0',
  sms_url_callback_enabled: '1',
  sms_url_callback: church,
}, {
  did: '2695550122',
  description: 'Fax',
  sms_enabled: '0',
}] as Record<string, string>[]
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
  if (method == 'getDIDsInfo') return ok({ dids })
  if (method == 'setSMS') {
    let did = dids.find((d) => d.did == q.get('did'))!
    did.sms_url_callback_enabled = q.get('url_callback_enable')!
    did.sms_url_callback = q.get('url_callback')!
    return ok({})
  }
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
let pointedOnSave = of('setSMS').length
let [connection] = await ctxOf(env).graph.read(
  `.connection.integration=voipms&.connection.status=connected&*`,
)
let numbers = await numbersOf(env, connection.entity.eid)

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
// What the writer of a text back is offered, in their own conversation.
let offered: Request['tools'] = []
let signupOffered: Request['tools'] = []
let memberOffered: Request['tools'] = []
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
      : said(req, /By text: Is the hall free/)
      ? (memberOffered = req.tools, reply('The hall is free Sunday.'))
      : said(req, /By text, signing up for a form:/)
      ? (signupOffered = req.tools, reply('Which form would you like?'))
      : said(req, /By text from \+12695550142/)
      ? (offered = req.tools, reply('Thank you; I will tell Jeff.'))
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

// The Operator's own tools, as its person's turn holds them.
let ctx = { env, dir, person } as unknown as Ctx
let numbered = phoneNumbers(env, ctx, space, store)
let setting = async (args: Record<string, unknown>) => {
  let listed = JSON.parse(await numbered.run(args) as string)
  await service.drain()
  return listed as Record<string, unknown>[]
}
let unchosen = await assertRejects(
  async () =>
    void await phoneSend(env, ctx, space, store).run({
      to: '2695550142',
      name: 'Dr Alvarez',
      text: 'Hi',
    }),
  Error,
)
let listedFirst = await setting({})
let outbound = await setting({ number: 'church line' })
let pointedOutbound = of('setSMS').length

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

// The church line's texts come to the Operator too.
let inbound = await setting({ number: '+12695550111', inbound: true })
let [pointed] = of('setSMS')
let callback = pointed.get('url_callback')!
let [keptChurch] = (await numbersOf(env, connection.entity.eid))
  .filter((n) => n.number == '+12695550111')

await setting({ number: 'Church line', inbound: false })

// voip.ms calls back the way its SMS URL callback fills its variables in.
let { voipms } = await owned(env)
let texted = (id: string, from: string, message: string) =>
  lineDoor(
    new Request(
      callback.replace('{ID}', id).replace('{FROM}', from)
        .replace('{TO}', '2695550111')
        .replace('{MESSAGE}', encodeURIComponent(message)),
    ),
    env,
    'voipms',
    voipms,
  )
let answered = await texted('77', '2695550142', 'Tuesday at 3 works for us.')
let stranger = await texted('78', '2695550199', 'Are we still on for golf?')
await service.drain()
await setting({ number: 'Church line', inbound: true })
await texted('new-signup', '2695550199', 'KIDS')
await service.drain()
let signupBack = of('sendSMS').find((t) =>
  t.get('message')?.startsWith('Which form')
)!
let beforeControl = (await store.g.read('.operator_request')).length
await texted('stop-signup', '2695550199', 'STOP')
await texted('stopped-signup', '2695550199', 'KIDS')
let whileStopped = (await store.g.read('.operator_request')).length
await texted('help-signup', '2695550199', 'HELP')
await texted('start-signup', '2695550199', 'START')
await texted('yes-signup', '2695550199', 'yes')
await service.drain()
let afterStart = (await store.g.read('.operator_request')).length
await texted('member', '2695550177', 'Is the hall free Sunday?')
await service.drain()
let memberBack = of('sendSMS').find((t) =>
  t.get('message')?.startsWith('The hall is free')
)!
let root = await conversationOf(store, '/at', rootOf(eid, person))
let writer = (await dir.phoned('+12695550142'))!
let theirs = await conversationOf(store, '/at', rootOf(eid, writer))
let answeredBack = of('sendSMS').find((t) =>
  t.get('message')?.startsWith('Thank you')
)!
let [update] = await store.g.read(`.deliver.to=${person}&*`)

// And no longer: its callback goes back to the church's own.
await setting({ number: 'Church line', inbound: false })
let [, restored] = of('setSMS')
let forged = await lineDoor(
  new Request('https://yaks.app/voipms/e30.bm90LW91cnM?id=79&from=1&to=2'),
  env,
  'voipms',
  voipms,
)

// A retained account-number connection can answer before own_number rows exist.
let local = ctxOf(env).graph
let retained = await local.read(
  `.own_number.connection=${connection.entity.eid}&*`,
)
let previousAccount = (connection.connection as { account: string }).account
await local.apply([
  { entity: connection.entity, connection: { account: '+12695550111' } },
  ...retained.map((row) => ({ entity: row.entity, own_number: null })),
])
await answerText(env, space, {
  address: '+12695550198',
  reply_to: '+12695550111',
}, 'Legacy signup answer')
let legacyAnswer = of('sendSMS').at(-1)!
await local.apply([
  {
    entity: connection.entity,
    connection: { account: previousAccount },
  },
  ...retained.map((row) => ({
    entity: row.entity,
    own_number: row.own_number,
  })),
])

test('a voip.ms connection is checked and lists every number on the account, changing none', () => {
  assertEquals(unfilled, { say: 'Fill in API password first.', no: true })
  assertEquals(refused.no, true)
  assertStringIncludes(refused.say, 'username or API password')
  assertEquals(connected, {
    say:
      'Connected +12695550100 (Home), +12695550111 (Church line). Tell your Operator which number to text from, and whether texts to it should come to your Operator. Nothing about a number changes until you do.',
    no: false,
  })
  assertEquals(pointedOnSave, 0)
  assertEquals(
    numbers.map((n) => [n.number, n.label, n.sms, n.callback]).sort(),
    [
      ['+12695550100', 'Home', true, undefined],
      ['+12695550111', 'Church line', true, church],
      ['+12695550122', 'Fax', false, undefined],
    ],
  )
})

test('the Operator texts from no number until one is chosen, and an outbound one keeps its callback', () => {
  assertStringIncludes(unchosen.message, 'not chosen which of their numbers')
  assertEquals(listedFirst.map((n) => [n.number, n.outbound, n.inbound]), [
    ['+12695550100', false, false],
    ['+12695550111', false, false],
    ['+12695550122', false, false],
  ])
  assertEquals(
    outbound.find((n) => n.number == '+12695550111'),
    {
      number: '+12695550111',
      label: 'Church line',
      sms: true,
      outbound: true,
      inbound: false,
    },
  )
  assertEquals(pointedOutbound, 0)
})

test('an inbound number has its callback pointed here, keeping how texts reach the person, and put back once it is not', () => {
  assertEquals(
    inbound.find((n) => n.number == '+12695550111')?.inbound,
    true,
  )
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
        'url_callback_enable',
        'url_callback_retry',
      ]
        .map((k) => [k, pointed.get(k)]),
    ),
    {
      did: '2695550111',
      email_enabled: '1',
      email_address: 'office@example.org',
      url_callback_enable: '1',
      url_callback_retry: '1',
    },
  )
  assertEquals(keptChurch.callback, church)
  assertEquals(
    [restored.get('did'), restored.get('url_callback_enable')],
    ['2695550111', '1'],
  )
  assertEquals(restored.get('url_callback'), church)
  assertEquals(of('setSMS').length, 4)
})

test('a connection saved before numbers were listed is used both ways on the number it took', async () => {
  let line = { entity: { eid: 'c' }, connection: { account: '+12695550100' } }
  assertEquals(await chosen({ read: () => Promise.resolve([]) }, line), [
    { connection: 'c', number: '+12695550100', outbound: true, inbound: true },
  ])
  assertEquals(
    await chosen({ read: () => Promise.resolve([]) }, {
      entity: { eid: 'c' },
      connection: { account: 'jeff@example.com' },
    }),
    [],
  )
})

test("a fork's text goes from the person's own number, signed as their assistant, and is kept", () => {
  assertEquals(sent.get('did'), '2695550111')
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
    '+12695550111',
    '+12695550142',
  ])
  assertStringIncludes(ofFork.html, 'Texted Dr Alvarez')
})

test('a helper is listed as one, and the step that started it opens its conversation where it is viewed', async () => {
  let helper = fork.entity.eid
  let listed = await workOf(store, eid, person, () => Promise.resolve('Jeff'))
  assertEquals(
    listed.filter((w) => w.from).map((w) => [w.open, w.from]),
    [[helper, 'Conversation with Jeff']],
  )
  assertStringIncludes(
    listing(listed, (w) => w.open),
    'Helper of the conversation with Jeff',
  )
  let link = (html: string) =>
    parseHTML(html).document
      .querySelector(`a[href$="/${helper}"]`)?.getAttribute('href')
  assertEquals(link(root.html), `/at/${helper}`)
  let admin = await conversationOf(
    store,
    '/at',
    rootOf(eid, person),
    undefined,
    undefined,
    undefined,
    '/admin/x/operator',
  )
  assertEquals(link(admin.html), `/admin/x/operator/${helper}`)
})

test("a text back is answered in its writer's own conversation, with only their permissions, and told to the person it was sent for; anyone else's stays theirs", async () => {
  assertEquals([answered.status, await answered.text()], [200, 'ok'])
  assertEquals([stranger.status, await stranger.text()], [200, 'ok'])
  assert(writer && writer != person)
  assertStringIncludes(theirs.html, 'Tuesday at 3 works for us.')
  assertStringIncludes(theirs.html, 'Thank you; I will tell Jeff.')
  let names = offered.map((t) => t.name)
  for (let door of ['phone_send', 'text_send', 'mail_send', 'memory_recall']) {
    assertEquals(names.includes(door), false, door)
  }
  // Its reads reach none of the Operator's own conversations.
  assert(!JSON.stringify(offered).includes('your conversations'))
  assertEquals(answeredBack.get('did'), '2695550111')
  assertEquals(answeredBack.get('dst'), '2695550142')
  assertEquals(
    answeredBack.get('message'),
    `Thank you; I will tell Jeff.\n\n${textedFor(space, 'Jeff Peterson')}`,
  )
  assertStringIncludes(root.html, 'A reply to a text: +12695550142 replied')
  assertStringIncludes(root.html, 'Tuesday at 3 works for us.')
  assertEquals(root.html.includes('Thank you; I will tell Jeff.'), false)
  assertStringIncludes(
    String((update.doc as { body: string }).body),
    '+12695550142 replied to the text you sent them: Tuesday at 3 works',
  )
  assert(!root.html.includes('golf') && !theirs.html.includes('golf'))
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

test('a fresh text to the chosen voip.ms inbound number reaches only sign-up tools, and keywords preserve its opt-out', () => {
  assertEquals(
    signupOffered.map((t) => t.name).sort(),
    signupTools(env, space, '', '').map((t) => t.name).sort(),
  )
  assertEquals(signupBack.get('did'), '2695550111')
  assertEquals(signupBack.get('dst'), '2695550199')
  assertEquals(whileStopped, beforeControl)
  assertEquals(afterStart, beforeControl + 1)
})

test('a legacy voip.ms account-number connection answers without own_number rows', () => {
  assertEquals(legacyAnswer.get('did'), '2695550111')
  assertEquals(legacyAnswer.get('dst'), '2695550198')
  assertStringIncludes(legacyAnswer.get('message')!, 'Legacy signup answer')
})

test("a member's text to the inbound number is their own Operator's, answered from that number", () => {
  ok(memberOffered.some((t) => t.name == 'phone_numbers'))
  ok(!memberOffered.some((t) => t.name.startsWith('signup_')))
  assertEquals(memberBack.get('did'), '2695550111')
  assertEquals(memberBack.get('dst'), '2695550177')
})
